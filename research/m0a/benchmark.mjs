import {readFileSync,writeFileSync,mkdirSync,copyFileSync,statSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {randomUUID,randomInt} from 'node:crypto';
import {parseCanonicalJson,createSchemaValidator,canonical,digest,safePath,targets} from '../../packages/contracts/index.mjs';
import {sha256File} from '../../apps/renderer/src/browser-bundle.mjs';
import {latestCosts} from '../../apps/agent-runner/src/costs.mjs';
import {reviewSubject} from '../../apps/agent-runner/src/runner.mjs';
import {summarizeM0aEconomics} from '../../scripts/m0a-economics.mjs';

const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'},text={type:'string',minLength:1,maxLength:4096};
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const hash={type:'string',pattern:'^[a-f0-9]{64}$'},file=object({path:text,sha256:hash});
const modelIdentity=object({provider:id,id:text,settingsHash:hash});
const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'https://promobento.com/m0a-benchmark/1',$defs:{
  arm:object({kind:{const:'m0a_arm_result'},caseId:id,modelKey:id,arm:{enum:['promobento','huashu-motion']},durationSeconds:{enum:[15,30]},
    projectInputHash:hash,model:modelIdentity,operationBudgetMicros:{type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER},
    operationDirectory:text,studyFile:text,operationIds:{type:'array',minItems:1,maxItems:512,uniqueItems:true,items:id},
    stage:{enum:['initial','patch']},revision:{anyOf:[{type:'null'},object({baseArtifactSha256:hash,commentsHash:hash,baseOperationId:id})]},
    status:{enum:['failed','rendered']},error:{anyOf:[{type:'null'},text]},costEvents:{type:'array',maxItems:10000,items:{type:'object'}},
    artifact:{anyOf:[{type:'null'},file]},report:{anyOf:[{type:'null'},file]},productionEligible:{const:false}}),
  manifest:object({kind:{const:'m0a_benchmark'},version:{const:1},caseSetFile:text,selectedModelKey:id,
    modelCandidates:{type:'array',minItems:2,maxItems:8,items:object({key:id,provider:id,id:text,settingsHash:{type:'string',pattern:'^[a-f0-9]{64}$'}})},
    producerIds:{type:'array',minItems:1,uniqueItems:true,items:id},
    runs:{type:'array',maxItems:192,items:object({caseId:id,modelKey:id,arm:{enum:['promobento','huashu-motion']},file:text})},
    blindReview:{anyOf:[{type:'null'},object({mappingFile:text,registryFile:text,ballotsFile:text})]},
    economicsFiles:{type:'array',maxItems:16,uniqueItems:true,items:text}}),
  registry:object({kind:{const:'m0a_independent_reviewers'},recruitment:text,biases:{type:'array',minItems:1,items:text},
    reviewers:{type:'array',minItems:1,maxItems:1000,items:object({reviewerId:id,kind:{const:'human'},role:{const:'target_user'},
      audiences:{type:'array',minItems:1,uniqueItems:true,items:{enum:['software','course']}},participatedInProduction:{const:false},verificationEvidenceRef:text})}}),
  ballot:object({reviewerId:id,packId:id,caseId:id,slot:{enum:['A','B']},wouldPublish:{type:'boolean'},
    watchedAtNormalSpeed:{const:true},reviewedAt:{type:'string',format:'date-time'},evidenceRef:text}),
}};
const validate=createSchemaValidator(schema);
const legalTargets=targets(parseCanonicalJson(readFileSync(new URL('../../config/platform-presets.json',import.meta.url))));
const assert=(value,kind)=>{const errors=validate(value,schema.$defs[kind]);if(errors.length)throw Object.assign(Error('M0A_'+kind.toUpperCase()+'_INVALID'),{details:errors});return value;};
export function readJson(path) {
  if(statSync(path).size>16*1024*1024)throw Error('M0A_INPUT_TOO_LARGE');
  return parseCanonicalJson(readFileSync(path));
}
const relativeFile=(base,path)=>resolve(dirname(base),path);
const sum=values=>{const total=values.reduce((a,b)=>a+BigInt(b),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))throw Error('M0A_COST_OVERFLOW');return Number(total);};

export function expectedCases(caseSet) {
  if(!caseSet||!Array.isArray(caseSet.cards)||caseSet.cards.length!==6||canonical(caseSet.durationsSeconds)!=='[15,30]'
    ||new Set(caseSet.cards.map(card=>card.id)).size!==6||caseSet.cards.filter(card=>card.audience==='software').length!==3
    ||caseSet.cards.filter(card=>card.audience==='course').length!==3)throw Error('M0A_REQUIRES_THREE_PLUS_THREE');
  return caseSet.cards.flatMap(card=>[15,30].map(durationSeconds=>({caseId:card.id+'-'+durationSeconds,topicId:card.id,
    name:card.name,audience:card.audience,durationSeconds})));
}

export function summarizeCosts(events) {
  const latest=latestCosts(events);
  return {usdMicros:sum(latest.map(event=>event.usdMicros)),events:events.length,charges:latest.length,
    settled:latest.length>0&&latest.every(event=>event.status!=='estimated'&&!event.exampleOnly&&event.usage.every(usage=>usage.quantity!==null)),
    providers:[...new Set(latest.map(event=>event.provider))],
    modelCalls:latest.filter(event=>event.model!==null&&event.providerRequestId!==null).length};
}

function loadArm(file,expected,model) {
  const result=assert(readJson(file),'arm');
  if(result.kind!=='m0a_arm_result'||result.caseId!==expected.caseId||result.durationSeconds!==expected.durationSeconds
    ||result.modelKey!==model.key||canonical(result.model)!==canonical({provider:model.provider,id:model.id,settingsHash:model.settingsHash})
    ||!['promobento','huashu-motion'].includes(result.arm)||! /^[a-f0-9]{64}$/u.test(result.projectInputHash)
    ||!Number.isSafeInteger(result.operationBudgetMicros)||result.operationBudgetMicros<=0)throw Error('M0A_RUN_IDENTITY');
  const costs=summarizeCosts(result.costEvents);
  const studyFilePath=relativeFile(file,result.studyFile),study=readJson(studyFilePath);
  const registered=study.operations.filter(op=>op.caseId===result.caseId&&op.modelKey===result.modelKey&&op.arm===result.arm);
  if(canonical(registered.map(op=>op.id))!==canonical(result.operationIds)||registered.some(op=>canonical(op.model)!==canonical(result.model)))throw Error('M0A_OMITTED_STUDY_ATTEMPT');
  const operationDirectory=relativeFile(file,result.operationDirectory);
  const operations=result.operationIds.map(id=>{
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(id))throw Error('M0A_OPERATION_ID');
    return readJson(join(operationDirectory,'operations',id,'run.json'));
  });
  if(!operations.length||operations.some(operation=>operation.caseId!==expected.caseId||operation.projectInputHash!==result.projectInputHash
    ||canonical(operation.model)!==canonical(result.model)))throw Error('M0A_OPERATION_IDENTITY');
  const actualEvents=readFileSync(join(operationDirectory,'cost-events.jsonl'),'utf8').split('\n').filter(Boolean).map(parseCanonicalJson)
    .filter(event=>result.operationIds.includes(event.operationId));
  if(canonical(actualEvents)!==canonical(result.costEvents))throw Error('M0A_COST_LEDGER_MISMATCH');
  const returnedModels=[];
  for(const operation of operations) {
    const actual=(operation.returnedModels??[]).map(({provider,id})=>({provider,id}));
    const modelCalls=latestCosts(actualEvents.filter(event=>event.operationId===operation.id)).filter(event=>event.model!==null&&event.providerRequestId!==null);
    if(modelCalls.length&&!actual.length||actual.some(model=>typeof model.provider!=='string'||typeof model.id!=='string'||!model.provider||!model.id))throw Error('M0A_RETURNED_MODEL_MISSING');
    returnedModels.push(...actual);
  }
  const returnedModelKeys=[...new Set(returnedModels.map(canonical))];
  if(returnedModelKeys.length>1)throw Error('M0A_RETURNED_MODEL_DRIFT');
  const returnedModel=returnedModelKeys.length?parseCanonicalJson(returnedModelKeys[0]):null;
  const byOperation=new Map();for(const event of latestCosts(result.costEvents))byOperation.set(event.operationId,(byOperation.get(event.operationId)??0)+event.usdMicros);
  const withinBudget=[...byOperation.values()].every(value=>value<=result.operationBudgetMicros);
  if(result.status==='failed')return {...result,operationDirectoryPath:operationDirectory,studyFilePath,returnedModel,costs,withinBudget,technicalPassed:false,reviewAllowed:false};
  if(result.status!=='rendered'||!result.artifact||!result.report)throw Error('M0A_RUN_STATUS');
  const artifact=relativeFile(file,result.artifact.path),reportPath=relativeFile(file,result.report.path);
  if(sha256File(artifact)!==result.artifact.sha256||sha256File(reportPath)!==result.report.sha256)throw Error('M0A_ARTIFACT_MISMATCH');
  const latest=operations.at(-1),base=result.revision?operations.find(operation=>operation.id===result.revision.baseOperationId):null;
  if(!safePath(latest.projectId))throw Error('M0A_PROJECT_IDENTITY');
  const project=readJson(join(operationDirectory,'projects',latest.projectId+'.json'));
  if(project.inputHash!==result.projectInputHash||digest(project.input)!==project.inputHash||project.input.durationSeconds!==expected.durationSeconds||project.input.targetIds.length!==1)throw Error('M0A_PROJECT_IDENTITY');
  const report=readJson(reportPath);
  const targetOf=operation=>{
    const candidate=operation.candidates?.find(candidate=>candidate.id===operation.selectedCandidateId)
      ??(operation.candidates?.length===1&&!operation.selectedCandidateId?operation.candidates[0]:null);
    if(!candidate||Object.keys(candidate.targets??{}).length!==1)throw Error('M0A_REVIEWED_CANDIDATE_REQUIRED');
    const [[targetId,target]]=Object.entries(candidate.targets);return {candidate,targetId,target};
  };
  const storedPath=path=>{if(!safePath(path))throw Error('M0A_STORED_PATH');return resolve(operationDirectory,path);};
  let targetId,technicalPassed;
  if(result.arm==='promobento') {
    const selected=targetOf(latest);targetId=selected.targetId;const target=selected.target;
    if(artifact!==storedPath(target.media)||reportPath!==storedPath(target.report)||report.kind!=='m0a_admission_result'
      ||report.sourceHash!==target.sourceHash||report.qaInputHash!==target.qaInputHash||report.capture?.targetId!==targetId
      ||report.capture.video?.sha256!==result.artifact.sha256||report.capture.frameCount!==expected.durationSeconds*30
      ||report.capture.durationSeconds!==expected.durationSeconds)throw Error('M0A_REVIEWED_ARTIFACT_MISMATCH');
    technicalPassed=report.status==='passed';
  } else {
    const reviewed=latest.researchArtifact;
    if(!reviewed||report.kind!=='m0a_baseline_render'||report.artifactSha256!==result.artifact.sha256||reviewed.artifactSha256!==result.artifact.sha256
      ||report.sourceHash!==reviewed.sourceHash||reviewed.reportHash!==digest(report)||report.durationSeconds!==expected.durationSeconds
      ||report.frames!==expected.durationSeconds*30)throw Error('M0A_REVIEWED_ARTIFACT_MISMATCH');
    [targetId]=project.input.targetIds;technicalPassed=report.status==='passed'&&report.determinism?.status==='passed';
  }
  const layout=legalTargets.find(item=>item.targetId===targetId)?.layout;
  const dimensions=result.arm==='promobento'?report.capture:report;
  if(!layout||targetId!==project.input.targetIds[0]||dimensions.width!==layout.width||dimensions.height!==layout.height)throw Error('M0A_OUTPUT_TARGET_MISMATCH');
  const approved=operation=>operation?.outputStatus==='allowed'&&operation.review?.decision==='allowed'&&operation.review.subjectHash===reviewSubject(operation);
  if(base&&result.revision) {
    const baseHash=result.arm==='promobento'?sha256File(storedPath(targetOf(base).target.media)):base.researchArtifact?.artifactSha256;
    if(baseHash!==result.revision.baseArtifactSha256)throw Error('M0A_PATCH_BASE_ARTIFACT_MISMATCH');
  }
  const revisionComplete=result.stage==='patch'&&base&&result.revision.baseArtifactSha256!==result.artifact.sha256
    &&/^[a-f0-9]{64}$/u.test(result.revision.commentsHash)&&registered.at(-1).commentsHash===result.revision.commentsHash;
  const reviewAllowed=approved(latest)&&(result.stage!=='patch'||approved(base));
  return {...result,artifactPath:artifact,reportPath,operationDirectoryPath:operationDirectory,studyFilePath,targetId,returnedModel,costs,withinBudget,technicalPassed,revisionComplete:Boolean(revisionComplete),reviewAllowed};
}

/** Strict pairing never fills a missing arm or an unknown price with zero. */
export function readBenchmark(manifestFile) {
  const manifest=assert(readJson(manifestFile),'manifest'),caseSet=readJson(relativeFile(manifestFile,manifest.caseSetFile)),cases=expectedCases(caseSet);
  if(new Set(manifest.modelCandidates.map(model=>model.key)).size!==manifest.modelCandidates.length
    ||new Set(manifest.modelCandidates.map(({provider,id,settingsHash})=>canonical({provider,id,settingsHash}))).size!==manifest.modelCandidates.length
    ||!manifest.modelCandidates.some(model=>model.key===manifest.selectedModelKey))throw Error('M0A_MODEL_CANDIDATES_INVALID');
  const runs=new Map();
  for(const ref of manifest.runs) {
    const expected=cases.find(row=>row.caseId===ref.caseId),model=manifest.modelCandidates.find(row=>row.key===ref.modelKey);
    const key=ref.caseId+'/'+ref.modelKey+'/'+ref.arm;
    if(!expected||!model||runs.has(key))throw Error('M0A_DUPLICATE_OR_UNKNOWN_RUN');
    const result=loadArm(relativeFile(manifestFile,ref.file),expected,model);
    if(result.costEvents.some(event=>event.actorUserId&&!manifest.producerIds.includes(event.actorUserId)))throw Error('M0A_PRODUCER_INVENTORY_INCOMPLETE');
    if(result.arm!==ref.arm)throw Error('M0A_ARM_MISMATCH');runs.set(key,result);
  }
  if(new Set([...runs.values()].map(run=>run.studyFilePath)).size>1||new Set([...runs.values()].map(run=>run.operationDirectoryPath)).size>1)
    throw Error('M0A_MULTIPLE_STUDY_LEDGERS');
  const pairs=cases.flatMap(expected=>manifest.modelCandidates.map(model=>{
    const a=runs.get(expected.caseId+'/'+model.key+'/promobento'),b=runs.get(expected.caseId+'/'+model.key+'/huashu-motion');
    if(a&&b&&(a.projectInputHash!==b.projectInputHash||a.operationBudgetMicros!==b.operationBudgetMicros))throw Error('M0A_UNFAIR_PAIR');
    if(a&&b&&(a.stage!==b.stage||a.revision?.commentsHash!==b.revision?.commentsHash))throw Error('M0A_UNFAIR_PATCH_SCOPE');
    return {...expected,modelKey:model.key,promobento:a??null,baseline:b??null};
  }));
  for(const expected of cases) {
    const compared=pairs.filter(pair=>pair.caseId===expected.caseId).flatMap(pair=>[pair.promobento,pair.baseline].filter(Boolean));
    if(new Set(compared.map(run=>run.projectInputHash)).size>1||new Set(compared.map(run=>run.operationBudgetMicros)).size>1)throw Error('M0A_UNFAIR_MODEL_COMPARISON');
  }
  for(const model of manifest.modelCandidates) {
    const actual=[...runs.values()].filter(run=>run.modelKey===model.key&&run.returnedModel).map(run=>canonical(run.returnedModel));
    if(new Set(actual).size>1)throw Error('M0A_RETURNED_MODEL_DRIFT');
  }
  return {manifest,caseSet,cases,pairs,runs};
}

export function summarizeBlindReview({mapping,registry,ballots,manifest,cases}) {
  assert(registry,'registry');
  if(!mapping||mapping.kind!=='m0a_blind_mapping'||mapping.selectedModelKey!==manifest.selectedModelKey||mapping.pairs?.length!==12)throw Error('M0A_BLIND_MAPPING_INVALID');
  const reviewers=new Map();
  for(const reviewer of registry.reviewers) {
    if(reviewers.has(reviewer.reviewerId)||manifest.producerIds.includes(reviewer.reviewerId)||manifest.modelCandidates.some(model=>[model.id,model.key].includes(reviewer.reviewerId)))throw Error('M0A_NONINDEPENDENT_REVIEWER');
    reviewers.set(reviewer.reviewerId,reviewer);
  }
  const seen=new Set(),groups=[];
  for(const ballot of ballots) {
    assert(ballot,'ballot');const reviewer=reviewers.get(ballot.reviewerId),row=cases.find(row=>row.caseId===ballot.caseId);
    const key=ballot.reviewerId+'/'+ballot.caseId+'/'+ballot.slot;
    if(!reviewer||!row||!reviewer.audiences.includes(row.audience)||ballot.packId!==mapping.packId||seen.has(key)||Date.parse(ballot.reviewedAt)>Date.now())throw Error('M0A_BALLOT_IDENTITY');
    seen.add(key);
  }
  for(const row of cases) {
    const pair=mapping.pairs.find(pair=>pair.caseId===row.caseId);
    if(!pair||!['promobento','huashu-motion'].includes(pair.A?.arm)||!['promobento','huashu-motion'].includes(pair.B?.arm)||pair.A.arm===pair.B.arm)throw Error('M0A_BLIND_PAIR_INVALID');
    const votes=ballots.filter(ballot=>ballot.caseId===row.caseId);
    const ids=[...new Set(votes.map(ballot=>ballot.reviewerId))];
    if(ids.some(id=>votes.filter(vote=>vote.reviewerId===id).length!==2))throw Error('M0A_INCOMPLETE_REVIEW_PAIR');
    const score=arm=>votes.filter(vote=>pair[vote.slot].arm===arm&&vote.wouldPublish).length;
    groups.push({caseId:row.caseId,reviewers:ids.length,promobentoYes:score('promobento'),baselineYes:score('huashu-motion'),
      promobentoApproved:ids.length>0&&score('promobento')>ids.length/2,baselineApproved:ids.length>0&&score('huashu-motion')>ids.length/2});
  }
  const pb=groups.filter(row=>row.promobentoApproved).length,base=groups.filter(row=>row.baselineApproved).length;
  const yes=arm=>groups.reduce((sum,row)=>sum+row[arm+'Yes'],0),voters=groups.reduce((sum,row)=>sum+row.reviewers,0);
  return {independentReviewers:reviewers.size,ballots:ballots.length,groups,promobentoApprovedGroups:pb,baselineApprovedGroups:base,
    promobentoApprovalRate:voters?yes('promobento')/voters:null,baselineApprovalRate:voters?yes('baseline')/voters:null,
    passed:groups.every(row=>row.reviewers>0)&&pb>=8&&yes('promobento')>=yes('baseline'),recruitment:registry.recruitment,biases:registry.biases};
}

/** Unit measurements must name the actual operations in this study, including
 * failed attempts. Embedded media/encoding costs stay in their parent operation;
 * absent separately attributable asset/delivery measurements stay incomplete. */
export function benchmarkEconomics(data,manifestFile) {
  const {manifest,runs}=data,selected=manifest.modelCandidates.find(model=>model.key===manifest.selectedModelKey);
  const policy=readJson(new URL('../../config/agent-policy.json',import.meta.url));
  const stores=[...new Set([...runs.values()].filter(run=>run.operationDirectoryPath).map(run=>run.operationDirectoryPath))];
  const operations=[];
  for(const store of stores) {
    const events=readFileSync(join(store,'cost-events.jsonl'),'utf8').split('\n').filter(Boolean).map(parseCanonicalJson);
    const files=readdirSync(join(store,'operations'));if(files.length>10000)throw Error('M0A_OPERATION_LIMIT');
    for(const name of files) {
      if(!safePath(name))throw Error('M0A_OPERATION_ID');
      const operation=readJson(join(store,'operations',name,'run.json'));
      if(canonical(operation.model)!==canonical({provider:selected.provider,id:selected.id,settingsHash:selected.settingsHash}))continue;
      if(!safePath(operation.projectId))throw Error('M0A_PROJECT_IDENTITY');
      const project=readJson(join(store,'projects',operation.projectId+'.json'));
      if(project.inputHash!==operation.projectInputHash||!data.cases.some(row=>row.caseId===operation.caseId))throw Error('M0A_ECONOMICS_PROJECT_MISMATCH');
      operations.push({operation,project:project.input,events:events.filter(event=>event.operationId===operation.id),store});
    }
  }
  const kinds={creations:'creative_generate',patchRounds:'agent_patch',assetSegments:'asset_processing',targetBatches:'prepare_targets',deliveryBatches:'render_release'};
  const summaries=[],groups=new Set();
  for(const file of manifest.economicsFiles) {
    const input=readJson(relativeFile(manifestFile,file)),summary=summarizeM0aEconomics(input,policy),group=input.group;
    const normalizedGroup={...group,targetIds:[...group.targetIds].sort()},key=canonical(normalizedGroup);
    if(groups.has(key)||group.modelSettingId!==selected.key)throw Error('M0A_ECONOMICS_GROUP_MISMATCH');groups.add(key);
    const matching=operations.filter(({project})=>project.durationSeconds===group.durationSeconds&&project.targetIds.every(target=>group.targetIds.includes(target)));
    if(!matching.length)throw Error('M0A_ECONOMICS_GROUP_UNOBSERVED');
    for(const [unit,kind] of Object.entries(kinds)) {
      const measurement=input.unitCosts[unit];if(measurement===null)continue;
      const expected=matching.filter(({operation})=>{
        if(operation.kind!==kind)return false;
        if(kind==='prepare_targets') {
          if(!Array.isArray(operation.preparedTargetIds))throw Error('M0A_ECONOMICS_TARGET_BATCH_IDENTITY');
          if(canonical([...operation.preparedTargetIds].sort())!==canonical(normalizedGroup.targetIds))return false;
          if(operation.state==='succeeded') {
            const candidate=operation.candidates.find(candidate=>candidate.id===operation.selectedCandidateId);
            if(!candidate||canonical(Object.keys(candidate.targets).sort())!==canonical(normalizedGroup.targetIds))throw Error('M0A_ECONOMICS_TARGET_BATCH_IDENTITY');
          }
        }
        if(kind==='render_release') {
          // Frozen delivery is not implemented by the local runner yet. A future
          // measurement must carry its actual complete delivered target set.
          if(!Array.isArray(operation.deliveredTargetIds))throw Error('M0A_ECONOMICS_DELIVERY_IDENTITY');
          return canonical([...operation.deliveredTargetIds].sort())===canonical(normalizedGroup.targetIds);
        }
        return true;
      });
      if(!expected.length)throw Error('M0A_ECONOMICS_UNIT_UNOBSERVED: '+unit);
      const refs=expected.map(({operation})=>'operation:'+operation.id).sort();
      if(canonical([...measurement.evidenceRefs].sort())!==canonical(refs))throw Error('M0A_ECONOMICS_EVIDENCE_MISMATCH: '+unit);
      const ledger=latestCosts(expected.flatMap(row=>row.events));
      const chargeRefs=ledger.map(event=>'operation:'+event.operationId+'/charge:'+event.chargeId).sort();
      if(canonical([...(measurement.chargeRefs??[])].sort())!==canonical(chargeRefs))throw Error('M0A_ECONOMICS_CHARGE_REFS_MISMATCH: '+unit);
      if(ledger.some(event=>event.exampleOnly||event.usage.some(usage=>usage.quantity===null)&&event.status!=='estimated'))throw Error('M0A_ECONOMICS_ACTUAL_USAGE_REQUIRED');
      const total=sum(ledger.map(event=>event.usdMicros)),unsettled=sum(ledger.filter(event=>event.status==='estimated').map(event=>event.usdMicros));
      const attempts=expected.reduce((count,{operation})=>count+Math.max(1,operation.attempt??1),0);
      const usable=expected.filter(({operation})=>operation.state==='succeeded'&&operation.outputStatus==='allowed'&&operation.review?.subjectHash===reviewSubject(operation)).length;
      if(measurement.totalCostMicros!==total||measurement.unsettledCostMicros!==unsettled||measurement.attempts!==attempts||measurement.usableResults!==usable)
        throw Error('M0A_ECONOMICS_MEASUREMENT_MISMATCH: '+unit);
    }
    summaries.push(summary);
  }
  const allTargetIds=legalTargets.map(target=>target.targetId).sort();
  const expectedGroups=[15,30].map(durationSeconds=>canonical({modelSettingId:selected.key,durationSeconds,targetIds:allTargetIds}));
  const missingGroups=expectedGroups.filter(key=>!groups.has(key)).map(parseCanonicalJson);
  const bothDurations=[15,30].every(duration=>summaries.some(summary=>summary.group.durationSeconds===duration));
  return {status:summaries.length&&bothDurations&&!missingGroups.length&&summaries.every(summary=>summary.status==='calculated')?'calculated':'incomplete',
    groups:summaries,missingGroups,requiresDurations:[15,30],requiresTargetIds:allTargetIds,unitEvidence:'actual_study_operations_including_failed_attempts'};
}

export function summarizeBenchmark(manifestFile) {
  const data=readBenchmark(manifestFile),{manifest,cases,pairs,caseSet}=data;
  const missing=pairs.filter(pair=>!pair.promobento||!pair.baseline).map(pair=>pair.caseId+'/'+pair.modelKey);
  const results=[...data.runs.values()];
  let blindReview=null;
  if(manifest.blindReview) {
    const read=key=>readJson(relativeFile(manifestFile,manifest.blindReview[key]));
    const mapping=read('mappingFile');
    for(const pair of mapping.pairs??[])for(const slot of ['A','B']) {
      const arm=data.runs.get(pair.caseId+'/'+manifest.selectedModelKey+'/'+pair[slot]?.arm);
      if(!arm||!arm.reviewAllowed||arm.artifact?.sha256!==pair[slot].artifactSha256)throw Error('M0A_BLIND_ARTIFACT_STALE');
    }
    blindReview=summarizeBlindReview({mapping,registry:read('registryFile'),ballots:read('ballotsFile'),manifest,cases});
  }
  const economics=manifest.economicsFiles.length?benchmarkEconomics(data,manifestFile):null;
  const blockers=[];
  if(caseSet.kind==='fictional_engineering_cases')blockers.push('fictional_engineering_inputs');
  if(missing.length)blockers.push('paired_model_runs_missing');
  if(results.some(result=>!result.technicalPassed))blockers.push('technical_checks_failed');
  if(results.some(result=>!result.costs.settled||!result.costs.modelCalls))blockers.push('actual_costs_unsettled');
  if(results.some(result=>!result.withinBudget))blockers.push('budget_exceeded');
  if(!results.length||results.some(result=>!result.revisionComplete))blockers.push('paired_revision_missing_or_unchanged');
  if(!results.length||results.some(result=>!result.reviewAllowed))blockers.push('owner_audiovisual_review_missing');
  if(!blindReview?.passed)blockers.push('independent_target_user_blind_review_missing_or_below_threshold');
  if(economics?.status!=='calculated')blockers.push('economics_not_calibrated');
  return {kind:'m0a_benchmark_summary',productionEligible:false,caseGroups:12,modelCandidates:manifest.modelCandidates.length,
    selectedModelKey:manifest.selectedModelKey,pairedRuns:pairs.length-missing.length,missingPairs:missing,
    actualAndReservedUsdMicros:sum(results.map(result=>result.costs.usdMicros)),
    arms:results.map(result=>({caseId:result.caseId,modelKey:result.modelKey,arm:result.arm,returnedModel:result.returnedModel,status:result.status,costs:result.costs,withinBudget:result.withinBudget,technicalPassed:result.technicalPassed,revisionComplete:result.revisionComplete,reviewAllowed:result.reviewAllowed})),
    blindReview,economics,blockers,benchmarkPassed:blockers.length===0};
}

const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function createBlindPack(manifestFile,outputDirectory) {
  const {manifest,cases,pairs}=readBenchmark(manifestFile),selected=pairs.filter(pair=>pair.modelKey===manifest.selectedModelKey);
  if(selected.some(pair=>!pair.promobento?.reviewAllowed||!pair.baseline?.reviewAllowed||!pair.promobento.technicalPassed||!pair.baseline.technicalPassed))throw Error('M0A_BLIND_PACK_REQUIRES_REVIEWED_PAIRS');
  const directory=resolve(outputDirectory);mkdirSync(directory,{recursive:false});
  const order=[...selected];for(let i=order.length-1;i>0;i--){const j=randomInt(i+1);[order[i],order[j]]=[order[j],order[i]];}
  const mapping={kind:'m0a_blind_mapping',packId:'blind-'+randomUUID(),selectedModelKey:manifest.selectedModelKey,pairs:[]};
  let html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Video publication review</title><style>body{font:18px system-ui;max-width:1100px;margin:3rem auto;padding:1rem;background:#f4f1e9;color:#172329}section{margin:3rem 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:2rem}video{width:100%;max-height:500px;background:#111}label{display:block;margin:.7rem 0}button{font:inherit;padding:.7rem}input[type=text]{font:inherit}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Would you publish this video?</h1><p>Watch both versions at normal speed with sound, then check whether the core message is understandable without sound. Judge each video independently. Do not guess who made it.</p><label>Reviewer ID <input id="reviewer" type="text" required></label>';
  for(let i=0;i<order.length;i++) {
    const pair=order[i],a=i%2===0?pair.promobento:pair.baseline,b=i%2===0?pair.baseline:pair.promobento;
    const row={caseId:pair.caseId};html+='<section><h2>'+escape(pair.name)+' · '+pair.durationSeconds+' seconds</h2><div class="pair">';
    for(const [slot,arm] of [['A',a],['B',b]]) {
      const filename=randomUUID()+'.mp4';copyFileSync(arm.artifactPath,join(directory,filename));
      row[slot]={arm:arm.arm,artifactSha256:arm.artifact.sha256,file:filename};
      html+='<div><h3>'+slot+'</h3><video controls preload="metadata" src="'+filename+'"></video><p>Would you publicly publish this version?</p><label><input type="radio" name="'+pair.caseId+'_'+slot+'" value="yes"> Yes</label><label><input type="radio" name="'+pair.caseId+'_'+slot+'" value="no"> No</label></div>';
    }
    mapping.pairs.push(row);html+='</div></section>';
  }
  html+='<label><input id="normal" type="checkbox"> I watched all versions at normal speed.</label><button id="save">Download my responses</button><p id="message" role="status"></p><script>const packId='+JSON.stringify(mapping.packId)+',cases='+JSON.stringify(cases.map(row=>row.caseId))+';document.getElementById("save").onclick=()=>{const reviewerId=document.getElementById("reviewer").value.trim();if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(reviewerId)||!document.getElementById("normal").checked){document.getElementById("message").textContent="Enter your reviewer ID and confirm normal-speed viewing.";return}const ballots=[];for(const caseId of cases)for(const slot of ["A","B"]){const value=document.querySelector(`input[name="${caseId}_${slot}"]:checked`);if(!value){document.getElementById("message").textContent="Please answer every version.";return}ballots.push({reviewerId,packId,caseId,slot,wouldPublish:value.value==="yes",watchedAtNormalSpeed:true,reviewedAt:new Date().toISOString(),evidenceRef:"reviewer-submission:"+reviewerId+":"+packId})}const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(ballots,null,2)],{type:"application/json"}));a.download="responses-"+reviewerId+".json";a.click();URL.revokeObjectURL(a.href)};</script></html>';
  writeFileSync(join(directory,'index.html'),html);
  const privateFile=directory+'-organizer-private.json';writeFileSync(privateFile,JSON.stringify(mapping,null,2)+'\n',{flag:'wx',mode:0o600});
  return {packId:mapping.packId,directory,privateMapping:privateFile};
}
