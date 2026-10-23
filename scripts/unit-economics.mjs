import {readFileSync} from 'node:fs';
import {createSchemaValidator,parseCanonicalJson,targets} from '../packages/contracts/index.mjs';

const schema=parseCanonicalJson(readFileSync(new URL('../contracts/unit-economics.schema.json',import.meta.url)));
const validate=createSchemaValidator(schema);
const presets=parseCanonicalJson(readFileSync(new URL('../config/platform-presets.json',import.meta.url)));
const keys=['creations','patchRounds','assetSegments','targetBatches','deliveryBatches'];
const initialSkus=new Set(['single_export','project_pack']);
const rounded=value=>{
  const result=Math.ceil(value);
  if(!Number.isSafeInteger(result))throw Error('UNIT_ECONOMICS_AMOUNT_OVERFLOW');
  return result;
};
const sum=values=>values.reduce((total,value)=>rounded(total+value),0);

/** All attempts, including failures, divided by usable outcomes; no invented zero cost. */
export function summarizeUnitEconomics(input,agentPolicy) {
  const errors=validate(input);
  if(errors.length)throw Error('UNIT_ECONOMICS_INPUT: '+errors.join('; '));
  const legalTargets=new Set(targets(presets).map(target=>target.targetId));
  if(input.group.targetIds.some(id=>!legalTargets.has(id)))throw Error('UNIT_ECONOMICS_TARGET');
  if(new Set(input.scenarios.map(item=>item.id)).size!==input.scenarios.length)throw Error('UNIT_ECONOMICS_DUPLICATE_SCENARIO');
  const missing=[],unitCosts={},allocatedCharges=new Set();
  for(const key of keys) {
    const observation=input.unitCosts[key];
    for(const ref of observation?.chargeRefs??[]) {
      if(allocatedCharges.has(ref))throw Error('UNIT_ECONOMICS_DUPLICATE_CHARGE: '+ref);
      allocatedCharges.add(ref);
    }
    if(observation&&observation.usableResults>observation.attempts)throw Error('UNIT_ECONOMICS_COUNTS: '+key);
    if(observation&&observation.attempts===0&&(observation.totalCostMicros||observation.unsettledCostMicros))
      throw Error('UNIT_ECONOMICS_EMPTY_ATTEMPTS: '+key);
    const ready=observation&&observation.usableResults>0&&observation.unsettledCostMicros===0;
    unitCosts[key]={...observation,averageCostMicros:ready?rounded(observation.totalCostMicros/observation.usableResults):null};
    if(!ready)missing.push('unitCosts.'+key);
  }
  let cohort=null;
  if(input.cohort) {
    const c=input.cohort;
    if(c.firstPurchasers>c.costStartedTrials||(!c.costStartedTrials&&(c.allTrialCostMicros||c.unsettledTrialCostMicros))
      ||(!c.firstPurchasers&&(c.netFirstPurchaseReceiptsMicros||c.paidProductionCostMicros)))throw Error('UNIT_ECONOMICS_COHORT_COUNTS');
    const attributedCosts=sum([c.allTrialCostMicros,c.paidProductionCostMicros,c.otherAttributedCostMicros]);
    cohort={...c,status:c.unsettledTrialCostMicros?'unsettled':'observed',
      conversionRate:c.costStartedTrials?c.firstPurchasers/c.costStartedTrials:null,
      allocatedTrialCostPerPurchaserMicros:c.firstPurchasers?rounded(c.allTrialCostMicros/c.firstPurchasers):null,
      knownContributionMicros:c.netFirstPurchaseReceiptsMicros-attributedCosts,
      contributionRate:c.netFirstPurchaseReceiptsMicros?1-attributedCosts/c.netFirstPurchaseReceiptsMicros:null};
  }
  const scenarios=input.scenarios.map(scenario=>{
    const quota=agentPolicy?.quota?.[scenario.sku];
    if(!quota)throw Error('UNIT_ECONOMICS_CATALOG_REQUIRED');
    const initial=initialSkus.has(scenario.sku),gaps=[];
    if(!initial&&(scenario.initialTargetPreparationIncludedInTrial||scenario.averageTrialCostMicros!==null||scenario.trialConversionRate!==null))
      throw Error('UNIT_ECONOMICS_INCREMENTAL_TRIAL_ALLOCATION');
    const fullUse={creations:quota.creative_generate,patchRounds:quota.agent_patch,assetSegments:quota.assetProcessingSegments,
      targetBatches:quota.versionUnits-(scenario.initialTargetPreparationIncludedInTrial?1:0),deliveryBatches:quota.versionUnits};
    if(keys.some(key=>!Number.isSafeInteger(fullUse[key])||fullUse[key]<0)||!Number.isSafeInteger(quota.priceMinor))
      throw Error('UNIT_ECONOMICS_CATALOG_INVALID');
    if(keys.some(key=>scenario.expectedUse[key]>fullUse[key]))throw Error('UNIT_ECONOMICS_USAGE_EXCEEDS_ENTITLEMENT: '+scenario.id);
    const trialCost=initial?(scenario.averageTrialCostMicros!==null&&scenario.trialConversionRate>0
      ?rounded(scenario.averageTrialCostMicros/scenario.trialConversionRate):null):0;
    if(initial&&trialCost===null)gaps.push('trial_acquisition_cost');
    if(scenario.netReceiptMicros===null)gaps.push('net_receipt');
    if(scenario.otherCostMicros===null)gaps.push('other_attributed_cost');
    const estimate=use=>{
      const absent=keys.filter(key=>use[key]>0&&unitCosts[key].averageCostMicros===null);
      const productionCostMicros=absent.length?null:sum(keys.map(key=>rounded(use[key]*(unitCosts[key].averageCostMicros??0))));
      const totalCostMicros=productionCostMicros===null||trialCost===null||scenario.otherCostMicros===null?null
        :sum([productionCostMicros,trialCost,scenario.otherCostMicros]);
      return {use,productionCostMicros,totalCostMicros,
        contributionMicros:totalCostMicros===null||scenario.netReceiptMicros===null?null:scenario.netReceiptMicros-totalCostMicros,
        contributionRate:totalCostMicros===null||!scenario.netReceiptMicros?null:1-totalCostMicros/scenario.netReceiptMicros,
        missing:absent.map(key=>'unitCosts.'+key)};
    };
    const typical=estimate(scenario.expectedUse),allEntitlements=estimate(fullUse);
    const scenarioMissing=[...new Set([...gaps,...typical.missing,...allEntitlements.missing])];
    if(scenarioMissing.length)missing.push('scenario.'+scenario.id);
    return {id:scenario.id,sku:scenario.sku,basis:scenario.basis,status:scenarioMissing.length?'incomplete':'estimated',
      catalogPriceMicros:rounded(quota.priceMinor*10000),netReceiptMicros:scenario.netReceiptMicros,
      acquisitionAllocation:initial?'first_purchase':'incremental_no_repeat_trial_allocation',
      trialCostPerPurchaserMicros:trialCost,typical,allEntitlements,missing:scenarioMissing,evidenceRefs:scenario.evidenceRefs};
  });
  if(!scenarios.length)missing.push('scenarios');
  return {kind:'unit_economics_summary',group:input.group,unit:'usd_micros',rounding:'costs_up_to_integer_micros',
    status:missing.length?'incomplete':'calculated',unitCosts,cohortStatus:cohort?.status??'not_observed',cohort,scenarios,missing,
    scope:'cost_projection_not_market_validation',productionPolicyChanged:false};
}
