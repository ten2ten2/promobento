import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '../packages/contracts/index.mjs';
import {summarizeUnitEconomics} from './unit-economics.mjs';

const policy=parseCanonicalJson(readFileSync(new URL('../config/agent-policy.json',import.meta.url)));
const usage=(values={})=>({creations:0,patchRounds:0,assetSegments:0,targetBatches:0,deliveryBatches:0,...values});
const fixture=()=>({schemaVersion:'3.0.0',kind:'unit_economics_input',
  group:{modelSettingId:'synthetic-test-setting',durationSeconds:30,targetIds:['tiktok:portrait']},
  unitCosts:Object.fromEntries(Object.keys(usage()).map(key=>[key,{totalCostMicros:1000000,unsettledCostMicros:0,
    attempts:4,usableResults:2,chargeRefs:['synthetic-ledger:charge-'+key],evidenceRefs:['synthetic-cost-ledger']} ])),
  cohort:{costStartedTrials:10,firstPurchasers:2,allTrialCostMicros:10000000,unsettledTrialCostMicros:0,
    netFirstPurchaseReceiptsMicros:76000000,paidProductionCostMicros:6000000,otherAttributedCostMicros:2000000,evidenceRefs:['synthetic-cohort']},
  scenarios:[{id:'typical-test',sku:'project_pack',expectedUse:usage({creations:1,patchRounds:2,deliveryBatches:1}),
    initialTargetPreparationIncludedInTrial:true,averageTrialCostMicros:1000000,trialConversionRate:0.2,
    netReceiptMicros:38000000,otherCostMicros:1000000,basis:'hypothesis',evidenceRefs:['synthetic-scenario']}]});

test('cost means include failed attempts and exclude no part of the trial cohort',()=>{
  const result=summarizeUnitEconomics(fixture(),policy);
  assert.equal(result.status,'calculated');assert.equal(result.unitCosts.creations.averageCostMicros,500000);
  assert.equal(result.cohort.allocatedTrialCostPerPurchaserMicros,5000000);
  assert.equal(result.cohort.knownContributionMicros,58000000);
  assert.equal(result.cohort.contributionRate,1-18000000/76000000);
  assert.equal(result.scenarios[0].typical.totalCostMicros,8000000);
  assert.equal(result.scenarios[0].typical.contributionMicros,30000000);
});

test('full use reads catalog entitlements and never reallocates the first trial target batch',()=>{
  const result=summarizeUnitEconomics(fixture(),policy).scenarios[0];
  assert.deepEqual(result.allEntitlements.use,{creations:5,patchRounds:15,assetSegments:20,targetBatches:2,deliveryBatches:3});
  assert.equal(result.allEntitlements.productionCostMicros,22500000);
  assert.equal(result.catalogPriceMicros,39000000);
  assert.equal(result.status,'estimated');
});

test('projections can be calculated before a market cohort is observed or settled',()=>{
  const input=fixture();input.cohort=null;
  const result=summarizeUnitEconomics(input,policy);
  assert.equal(result.status,'calculated');assert.equal(result.cohortStatus,'not_observed');
  assert.equal(result.cohort,null);assert.equal(result.scenarios[0].basis,'hypothesis');
  input.cohort=fixture().cohort;input.cohort.unsettledTrialCostMicros=1000000;
  const unsettled=summarizeUnitEconomics(input,policy);
  assert.equal(unsettled.status,'calculated');assert.equal(unsettled.cohortStatus,'unsettled');
});

test('zero first purchasers reports spending and null allocation rather than zero acquisition cost',()=>{
  const input=fixture();Object.assign(input.cohort,{firstPurchasers:0,netFirstPurchaseReceiptsMicros:0,paidProductionCostMicros:0});
  const result=summarizeUnitEconomics(input,policy);
  assert.equal(result.cohort.allocatedTrialCostPerPurchaserMicros,null);
  assert.equal(result.cohort.contributionRate,null);assert.equal(result.cohort.knownContributionMicros,-12000000);
});

test('missing observations and unresolved charges cannot become free unit costs',()=>{
  const input=fixture();input.unitCosts.creations=null;input.unitCosts.patchRounds.unsettledCostMicros=90000;
  const result=summarizeUnitEconomics(input,policy);
  assert.equal(result.status,'incomplete');assert.equal(result.unitCosts.creations.averageCostMicros,null);
  assert.equal(result.unitCosts.patchRounds.averageCostMicros,null);
  assert.equal(result.scenarios[0].typical.totalCostMicros,null);
});

test('one charge cannot be counted in creation and again in target or delivery costs',()=>{
  for(const key of ['targetBatches','deliveryBatches','assetSegments','patchRounds']) {
    const input=fixture();input.unitCosts[key].chargeRefs=[...input.unitCosts.creations.chargeRefs];
    assert.throws(()=>summarizeUnitEconomics(input,policy),/UNIT_ECONOMICS_DUPLICATE_CHARGE/);
  }
});

test('all failed attempts preserve spent money but cannot estimate a usable result price',()=>{
  const input=fixture();input.unitCosts.creations.usableResults=0;
  const result=summarizeUnitEconomics(input,policy);
  assert.equal(result.unitCosts.creations.totalCostMicros,1000000);
  assert.equal(result.unitCosts.creations.averageCostMicros,null);
});

test('unknown receipts, other costs and conversion rates stay explicit',()=>{
  for(const key of ['netReceiptMicros','otherCostMicros','trialConversionRate','averageTrialCostMicros']) {
    const input=fixture();input.scenarios[0][key]=null;
    const result=summarizeUnitEconomics(input,policy).scenarios[0];
    assert.equal(result.status,'incomplete');assert.equal(result.typical.contributionMicros,null);
  }
  const input=fixture();input.scenarios[0].trialConversionRate=0;
  assert.equal(summarizeUnitEconomics(input,policy).scenarios[0].trialCostPerPurchaserMicros,null);
});

test('an incremental purchase does not amortize the original trial a second time',()=>{
  const input=fixture();Object.assign(input.scenarios[0],{sku:'extra_pack',initialTargetPreparationIncludedInTrial:false,
    averageTrialCostMicros:null,trialConversionRate:null});
  const result=summarizeUnitEconomics(input,policy).scenarios[0];
  assert.equal(result.trialCostPerPurchaserMicros,0);
  assert.equal(result.acquisitionAllocation,'incremental_no_repeat_trial_allocation');
  input.scenarios[0].averageTrialCostMicros=1;
  assert.throws(()=>summarizeUnitEconomics(input,policy),/INCREMENTAL_TRIAL_ALLOCATION/);
});

test('fractions are permitted only for expected use, and monetary totals round upward',()=>{
  const input=fixture();input.unitCosts.creations.totalCostMicros=3;
  input.scenarios[0].expectedUse=usage({creations:0.25});
  const result=summarizeUnitEconomics(input,policy);
  assert.equal(result.unitCosts.creations.averageCostMicros,2);
  assert.equal(result.scenarios[0].typical.productionCostMicros,1);
  input.unitCosts.creations.totalCostMicros=0.5;
  assert.throws(()=>summarizeUnitEconomics(input,policy),/UNIT_ECONOMICS_INPUT/);
});

test('invalid cohort, count and entitlement claims fail rather than changing assumptions',()=>{
  for(const mutate of [
    value=>{value.cohort.firstPurchasers=11;},
    value=>{value.unitCosts.creations.usableResults=5;},
    value=>{value.unitCosts.creations.attempts=0;value.unitCosts.creations.usableResults=0;},
    value=>{value.scenarios[0].expectedUse.creations=6;},
    value=>{value.group.targetIds=['invented:target'];},
    value=>{value.scenarios.push(structuredClone(value.scenarios[0]));}
  ]) {const input=fixture();mutate(input);assert.throws(()=>summarizeUnitEconomics(input,policy),/UNIT_ECONOMICS_/);}
});

test('large sums fail instead of silently losing integer currency precision',()=>{
  const input=fixture();input.cohort.allTrialCostMicros=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>summarizeUnitEconomics(input,policy),/AMOUNT_OVERFLOW/);
});

test('calculations cannot enable execution or modify catalog prices and entitlements',()=>{
  const before=structuredClone(policy),input=fixture(),original=structuredClone(input);
  const result=summarizeUnitEconomics(input,policy);
  assert.equal(result.productionPolicyChanged,false);assert.deepEqual(policy,before);assert.deepEqual(input,original);
});
