import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCanonicalJson,canonical,targets} from '../../../packages/contracts/index.mjs';
import {presets} from '../src/schema.mjs';
import {initializeProject,createWork,getOperation,recordReview,selectCandidate,acceptCandidate,prepareTargets,generateResearchArtifact,runResearchRender,reconcileCharge} from '../src/runner.mjs';
import {latestCosts} from '../src/costs.mjs';
import {project,config,plan,provider,mockRender,mockMethod,mockCapture} from './fixtures.mjs';

function temp(t){const path=mkdtempSync(join(tmpdir(),'agent-runner-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
const raw=(directory,id)=>parseCanonicalJson(readFileSync(join(directory,'operations',id,'run.json')));
const events=directory=>readFileSync(join(directory,'cost-events.jsonl'),'utf8').trim().split('\n').map(parseCanonicalJson);
const receipt=subjectHash=>({reviewerId:'human-test-operator',reviewedAt:new Date().toISOString(),subjectHash,decision:'allowed',policyVersion:'m0a-local-human-review-v1',
  evidenceRef:'Mock test record, not an actual human acceptance.',checks:{facts:true,rights:true,contentSafety:true,normalSpeedAudiovisual:true,silentReadability:true}});
async function create(t,{input=project(),api=provider(),render=mockRender}={}) {
  const directory=temp(t);await initializeProject({directory,project:input});
  const result=await createWork({directory,projectId:input.id,config:config(),operationId:'op-create',provider:api,render,capture:mockCapture,method:mockMethod});
  return {directory,result};
}
async function accept(directory,result) {
  await recordReview({directory,operationId:result.operationId,receipt:receipt(result.subjectHash)});
  const candidateId=raw(directory,result.operationId).candidates[0].id;
  await selectCandidate({directory,operationId:result.operationId,candidateId});
  await acceptCandidate({directory,operationId:result.operationId,expectedRevisionId:null});return candidateId;
}
test('mock workflow preserves source as inert data, withholds output until exact review and explicit acceptance',async t=>{
  const p=plan();p.source.code="throw Error('HOST_EXECUTION_MUST_NEVER_HAPPEN'); export default {};";
  const {directory,result}=await create(t,{api:provider({plans:[p]})});
  assert.equal(result.outputStatus,'withheld');assert.ok(!('plans'in result));assert.equal(result.productionEligible,false);
  await assert.rejects(acceptCandidate({directory,operationId:'op-create',expectedRevisionId:null}),/REVIEW_REQUIRED/);
  await assert.rejects(recordReview({directory,operationId:'op-create',receipt:receipt('a'.repeat(64))}),/REVIEW_IDENTITY/);
  const candidateId=await accept(directory,result);
  assert.equal((await getOperation({directory,operationId:'op-create'})).state,'succeeded');
  const stored=raw(directory,'op-create');assert.equal(stored.candidates[0].id,candidateId);
  assert.equal(stored.usage.costMicros,120);assert.equal(latestCosts(events(directory)).length,2);
});
test('mock exploration renders three actual callbacks before any directions are exposed',async t=>{
  const input=project();input.direct=false;let renders=0;
  const plans=['fit','amplify','unexpected'].map(id=>({...plan(),direction:{id,label:id,logline:'Mock direction '+id}}));
  const {directory,result}=await create(t,{input,api:provider({plans}),render:async args=>{renders++;return mockRender(args);}});
  assert.equal(renders,3);assert.equal(raw(directory,'op-create').plans.length,3);assert.equal(result.selectedCandidateId,null);
  const visible=await recordReview({directory,operationId:'op-create',receipt:receipt(result.subjectHash)});
  assert.equal(visible.plans.length,3);assert.ok(visible.plans.every(plan=>plan.direction.keyframeIds.length===1));
});
test('mock review records real failing checks with reasons while refusing false-check approval',async t=>{
  const {directory,result}=await create(t),rejected={...receipt(result.subjectHash),checks:{...receipt(result.subjectHash).checks,facts:false,normalSpeedAudiovisual:false}};
  await assert.rejects(recordReview({directory,operationId:'op-create',receipt:rejected}),/REVIEW_INVALID/);
  rejected.decision='withheld';
  await assert.rejects(recordReview({directory,operationId:'op-create',receipt:rejected}),/REVIEW_INVALID/);
  rejected.notes='The product claim has no source and the audio is clipped.';
  const status=await recordReview({directory,operationId:'op-create',receipt:rejected});
  assert.equal(status.outputStatus,'withheld');assert.equal(status.state,'failed');assert.ok(!('plans'in status));
  const saved=raw(directory,'op-create');assert.equal(saved.review.checks.facts,false);assert.equal(saved.review.notes,rejected.notes);
  const runResult=parseCanonicalJson(readFileSync(join(directory,'operations','op-create','run-result.json')));
  assert.ok(!('directions'in runResult));assert.ok(!('agentInterpretation'in runResult));
});
test('mock repair uses the same operation ledger, max two repairs and no source execution on host',async t=>{
  let attempts=0;const api=provider();const good=api.generate;
  api.generate=async args=>{attempts++;return attempts<3?{...(await good(args)),text:canonical({plans:[]})}:good(args);};
  const {directory}=await create(t,{api});const operation=raw(directory,'op-create');
  assert.equal(operation.attempt,3);assert.equal(operation.internalRepairs,2);assert.equal(operation.usage.costMicros,360);
  assert.equal(new Set(events(directory).map(event=>event.operationId)).size,1);
});
test('mock request replay returns the same result without another paid call',async t=>{
  const {directory,result}=await create(t);const before=events(directory).length;
  const replay=await createWork({directory,projectId:project().id,config:config(),operationId:'op-create',provider:{id:'mock',generate:async()=>{throw Error('MUST_NOT_CALL');}}});
  assert.equal(replay.subjectHash,result.subjectHash);assert.equal(events(directory).length,before);
  await assert.rejects(createWork({directory,projectId:project().id,config:config(),operationId:'op-create',kind:'agent_patch',comments:[]}),/REPLAY_MISMATCH/);
});
test('mock patch is one round, rejects oversized comments before calls and never changes accepted base automatically',async t=>{
  const {directory,result}=await create(t);const revision=await accept(directory,result);
  const args={directory,projectId:project().id,config:config(),kind:'agent_patch',provider:provider(),render:mockRender,capture:mockCapture,method:mockMethod};
  const comment={targetId:'tiktok:portrait',frameIndex:100,comment:'Change accent color only.',editScope:'shot'};
  await assert.rejects(createWork({...args,comments:[{...comment,comment:'😀'.repeat(4001)}]}),/COMMENTS_INVALID/);
  const patch=await createWork({...args,operationId:'op-patch',comments:[comment]});
  assert.equal(raw(directory,'op-patch').baseRevisionId,revision);
  assert.equal(parseCanonicalJson(readFileSync(join(directory,'projects','project-test.json'))).current.revisionId,revision);
  await recordReview({directory,operationId:'op-patch',receipt:receipt(patch.subjectHash)});
  await assert.rejects(acceptCandidate({directory,operationId:'op-patch',expectedRevisionId:null}),/BASE_CONFLICT/);
  await acceptCandidate({directory,operationId:'op-patch',expectedRevisionId:revision});
});
test('mock prepare expands a single-target project to all seven legal targets, reuses evidence and replays without charges',async t=>{
  const input=project();input.targetIds=['tiktok:portrait'];
  const {directory,result}=await create(t,{input}),revision=await accept(directory,result),calls=[];
  const original=raw(directory,'op-create').candidates[0].targets['tiktok:portrait'];
  const prepared=await prepareTargets({directory,projectId:input.id,config:config(),operationId:'op-targets',render:async args=>{
    calls.push(parseCanonicalJson(readFileSync(join(args.sourceDirectory,'candidate.json'))).targetId);return mockRender(args);
  }});
  const all=targets(presets).map(target=>target.targetId),operation=raw(directory,'op-targets');
  assert.equal(all.length,7);assert.deepEqual(calls,all.filter(target=>'tiktok:portrait'!==target));
  assert.deepEqual(Object.keys(operation.candidates[0].targets).toSorted(),all.toSorted());
  assert.deepEqual(operation.candidates[0].targets['tiktok:portrait'],original);
  assert.deepEqual(operation.preparedTargetIds,all);assert.equal(operation.targetRulesVersion,presets.rulesVersion);
  assert.equal(operation.baseRevisionId,revision);assert.equal(prepared.outputStatus,'withheld');
  assert.equal(latestCosts(events(directory)).filter(event=>event.operationId==='op-targets').length,6);
  const before=events(directory).length;
  const replay=await prepareTargets({directory,projectId:input.id,config:config(),operationId:'op-targets',render:async()=>{throw Error('MUST_NOT_RENDER');}});
  assert.equal(replay.subjectHash,prepared.subjectHash);assert.equal(events(directory).length,before);
  await assert.rejects(prepareTargets({directory,projectId:input.id,config:config(),operationId:'op-create'}),/REPLAY_MISMATCH/);
});
test('mock all-target preparation failure after partial progress never replaces the accepted revision',async t=>{
  const input=project();input.targetIds=['tiktok:portrait'];
  const {directory,result}=await create(t,{input}),revision=await accept(directory,result);let calls=0;
  const current=()=>parseCanonicalJson(readFileSync(join(directory,'projects','project-test.json'))).current;
  const accepted=current();
  await assert.rejects(prepareTargets({directory,projectId:input.id,config:config(),operationId:'op-fail',render:async args=>{
    if(++calls===3)throw Error('ADMISSION_FAULT');return mockRender(args);
  }}),/ADMISSION_FAULT/);
  assert.equal(calls,3);assert.equal(current().revisionId,revision);assert.deepEqual(current(),accepted);
  const failed=raw(directory,'op-fail');assert.equal(failed.state,'failed');assert.deepEqual(failed.candidates,[]);
  await assert.rejects(acceptCandidate({directory,operationId:'op-fail',expectedRevisionId:revision}),/REVIEW_REQUIRED/);
});
test('mock patch after preparation renders newly prepared comment targets and invalidates unrendered shared-source targets',async t=>{
  const input=project();input.targetIds=['tiktok:portrait'];
  const {directory,result}=await create(t,{input}),originalRevision=await accept(directory,result);
  const prepared=await prepareTargets({directory,projectId:input.id,config:config(),operationId:'op-prepare',render:mockRender});
  await recordReview({directory,operationId:'op-prepare',receipt:receipt(prepared.subjectHash)});
  await acceptCandidate({directory,operationId:'op-prepare',expectedRevisionId:originalRevision});
  const preparedRevision=raw(directory,'op-prepare').selectedCandidateId,all=targets(presets).map(target=>target.targetId),calls=[];
  const comment=targetId=>({targetId,frameIndex:100,comment:'Change headline placement.',editScope:'variant'});
  let methodTargets;
  const patch=await createWork({directory,projectId:input.id,config:config(),operationId:'op-new-target-patch',kind:'agent_patch',
    comments:[comment('youtube:landscape'),comment('instagram_feed:square')],provider:provider(),capture:mockCapture,method:async data=>{methodTargets=data.targetIds;return mockMethod();},
    render:async args=>{calls.push(parseCanonicalJson(readFileSync(join(args.sourceDirectory,'candidate.json'))).targetId);return mockRender(args);}});
  assert.deepEqual(calls,['youtube:landscape','instagram_feed:square']);assert.deepEqual(methodTargets,calls);
  const candidate=raw(directory,'op-new-target-patch').candidates[0];
  assert.deepEqual(Object.keys(candidate.targets).toSorted(),calls.toSorted());
  assert.deepEqual(candidate.invalidatedTargetIds.toSorted(),all.filter(target=>!calls.includes(target)).toSorted());
  const current=()=>parseCanonicalJson(readFileSync(join(directory,'projects','project-test.json'))).current;
  assert.equal(current().revisionId,preparedRevision);assert.equal(Object.keys(raw(directory,'op-prepare').candidates[0].targets).length,7);
  await recordReview({directory,operationId:'op-new-target-patch',receipt:receipt(patch.subjectHash)});
  await acceptCandidate({directory,operationId:'op-new-target-patch',expectedRevisionId:preparedRevision});
  assert.equal(current().revisionId,candidate.id);
  await assert.rejects(createWork({directory,projectId:input.id,config:config(),operationId:'op-unready-target',kind:'agent_patch',
    comments:[comment('tiktok:portrait')],provider:provider(),capture:mockCapture,method:mockMethod,render:mockRender}),/COMMENTS_INVALID/);
});
test('mock all-variants patch validates every prepared target and any render failure preserves the old revision',async t=>{
  const {directory,result}=await create(t),originalRevision=await accept(directory,result);
  const prepared=await prepareTargets({directory,projectId:project().id,config:config(),operationId:'op-prepare',render:mockRender});
  await recordReview({directory,operationId:'op-prepare',receipt:receipt(prepared.subjectHash)});
  await acceptCandidate({directory,operationId:'op-prepare',expectedRevisionId:originalRevision});
  const revision=raw(directory,'op-prepare').selectedCandidateId,calls=[];
  const args={directory,projectId:project().id,config:config(),kind:'agent_patch',provider:provider(),capture:mockCapture,method:mockMethod,
    comments:[{targetId:'youtube:landscape',frameIndex:30,comment:'Update accent on every target.',editScope:'all-variants'}]};
  await createWork({...args,operationId:'op-global-patch',render:async options=>{calls.push(parseCanonicalJson(readFileSync(join(options.sourceDirectory,'candidate.json'))).targetId);return mockRender(options);}});
  assert.deepEqual(calls.toSorted(),targets(presets).map(target=>target.targetId).toSorted());
  assert.deepEqual(raw(directory,'op-global-patch').candidates[0].invalidatedTargetIds,[]);
  await assert.rejects(createWork({...args,operationId:'op-failed-patch',render:async()=>{throw Error('ADMISSION_IMAGE_UNAVAILABLE');}}),/ADMISSION_IMAGE_UNAVAILABLE/);
  assert.equal(parseCanonicalJson(readFileSync(join(directory,'projects','project-test.json'))).current.revisionId,revision);
  assert.deepEqual(raw(directory,'op-failed-patch').candidates,[]);
});
test('mock cancellation settles a late provider response but never publishes a candidate',async t=>{
  const directory=temp(t);await initializeProject({directory,project:project()});const controller=new AbortController();
  const api=provider();const generate=api.generate;api.generate=async args=>{const result=await generate(args);controller.abort(Error('LOCAL_AGENT_CANCELLED'));return result;};
  await assert.rejects(createWork({directory,projectId:project().id,config:config(),operationId:'op-cancel',provider:api,render:mockRender,capture:mockCapture,method:mockMethod,signal:controller.signal}),/CANCELLED/);
  const operation=raw(directory,'op-cancel');assert.equal(operation.state,'cancelled');assert.equal(operation.usage.costMicros,120);assert.deepEqual(operation.candidates,[]);
});
test('mock unknown usage retains worst case; evidence-bound reconciliation does not erase history',async t=>{
  const directory=temp(t);await initializeProject({directory,project:project()});const api={id:'mock',generate:async()=>{throw Error('network unavailable');}};
  await assert.rejects(createWork({directory,projectId:project().id,config:config(),operationId:'op-unknown',provider:api,render:mockRender,capture:mockCapture,method:mockMethod}),/network unavailable/);
  const prior=latestCosts(events(directory))[0];assert.equal(prior.status,'estimated');assert.equal(prior.usdMicros,14000);
  assert.equal(raw(directory,'op-unknown').model.provider,'mock');assert.equal(raw(directory,'op-unknown').model.id,'mock-model');
  assert.match(raw(directory,'op-unknown').model.settingsHash,/^[a-f0-9]{64}$/);
  await assert.rejects(reconcileCharge({directory,projectId:project().id,config:config(),operationId:'op-unknown',chargeId:prior.chargeId,receipt:{usdMicros:0,usage:[]}}),/EVIDENCE_REQUIRED/);
  await reconcileCharge({directory,projectId:project().id,config:config(),operationId:'op-unknown',chargeId:prior.chargeId,
    receipt:{usdMicros:120,usage:[],evidenceRef:'mock invoice',reconciledBy:'test-operator'}});
  assert.equal(events(directory).length,2);assert.equal(latestCosts(events(directory))[0].status,'reconciled');
});
test('mock baseline source and renderer share one operation budget and ledger',async t=>{
  const directory=temp(t);await initializeProject({directory,project:project()});
  const generated=await generateResearchArtifact({directory,projectId:project().id,config:config(),operationId:'op-baseline',instructions:'Return JSON.',input:{arm:'baseline'},provider:provider({html:'<p>mock</p>'})});
  assert.equal(generated.model.provider,'mock');assert.equal(generated.productionEligible,false);
  assert.equal(raw(directory,'op-baseline').state,'active');assert.equal(raw(directory,'op-baseline').phase,'awaiting_render');
  assert.equal(parseCanonicalJson(readFileSync(join(directory,'operations','op-baseline','run-result.json'))).state,'active');
  const rendered=await runResearchRender({directory,projectId:project().id,config:config(),operationId:'op-baseline',render:async()=>({status:'passed',artifactSha256:'a'.repeat(64),sourceHash:'b'.repeat(64)})});
  assert.equal(rendered.result.status,'passed');assert.equal(latestCosts(rendered.costEvents).length,2);
  assert.equal(new Set(rendered.costEvents.map(event=>event.operationId)).size,1);
  const status=await getOperation({directory,operationId:'op-baseline'});assert.equal(status.phase,'output_review');assert.ok(status.subjectHash);
  await recordReview({directory,operationId:'op-baseline',receipt:receipt(status.subjectHash)});
  assert.equal((await getOperation({directory,operationId:'op-baseline'})).outputStatus,'allowed');
});
test('mock unauthorized media never reaches the renderer and cannot be self-granted by source',async t=>{
  const directory=temp(t);await initializeProject({directory,project:project()});const p=plan();p.source.resources.resourceIds=['screen-still'];let renders=0;
  await assert.rejects(createWork({directory,projectId:project().id,config:config(),operationId:'op-rights',provider:provider({plans:[p]}),capture:mockCapture,method:mockMethod,
    render:async()=>{renders++;return mockRender();}}),/RESOURCE_RIGHTS_REQUIRED/);assert.equal(renders,0);
});
