import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {initializeProject,generateResearchArtifact,repairResearchArtifact,runResearchRender,getOperation,recordReview,isResearchRepairableError} from '../src/runner.mjs';
import {latestCosts} from '../src/costs.mjs';
import {project,config,provider} from './fixtures.mjs';
const read=(directory,path)=>parseCanonicalJson(readFileSync(join(directory,path)));
const raw=directory=>read(directory,'operations/baseline/run.json');
async function setup(t,{settings=config(),api=provider({html:'first'})}={}) {
  const directory=mkdtempSync(join(tmpdir(),'research-repair-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  await initializeProject({directory,project:project()});
  const args={directory,projectId:project().id,config:settings,operationId:'baseline',instructions:'Return inert JSON.',input:{arm:'baseline'},provider:api};
  const generated=await generateResearchArtifact(args);return {args,generated,directory};
}
const validReport=()=>({status:'passed',artifactSha256:'a'.repeat(64),sourceHash:'b'.repeat(64)});
test('mock baseline gets at most 3 model attempts under one operation ledger, preserving paid responses and renderer failure',async t=>{
  const {args,generated,directory}=await setup(t);let sent;
  const second=provider({html:'second'}),generate=second.generate;second.generate=async input=>{sent=parseCanonicalJson(input.input);return generate(input);};
  const repaired=await repairResearchArtifact({...args,provider:second,previousValue:generated.value,error:Error('M0A_BASELINE_RESPONSE_INVALID: real schema error')});
  assert.equal(sent.repair.previousValue.html,'first');assert.match(sent.repair.error.message,/real schema error/);
  assert.equal(repaired.operationId,'baseline');assert.equal(repaired.attempt,2);
  const failure=Error('BASELINE_PAGE_ERRORS: actual isolated page syntax error');
  await assert.rejects(runResearchRender({...args,render:async()=>{throw failure;}}),/BASELINE_PAGE_ERRORS/);
  await assert.rejects(repairResearchArtifact({...args,previousValue:repaired.value,error:Error('BASELINE_PAGE_ERRORS: invented replacement')}),/ERROR_MISMATCH/);
  const third=await repairResearchArtifact({...args,previousValue:repaired.value,error:failure,provider:provider({html:'third'})});
  assert.equal(third.attempt,3);assert.equal(raw(directory).internalRepairs,2);assert.equal(raw(directory).usage.costMicros,360);
  assert.equal(read(directory,'operations/baseline/attempts/1/response.json').html,'first');
  assert.equal(read(directory,'operations/baseline/attempts/2/response.json').html,'second');
  assert.match(read(directory,'operations/baseline/attempts/2/render-error.json').message,/actual isolated/);
  assert.equal(read(directory,'operations/baseline/attempts/3/response.json').html,'third');
  const latest=latestCosts(third.costEvents);assert.equal(new Set(latest.map(event=>event.operationId)).size,1);
  assert.equal(new Set(latest.map(event=>event.attemptId)).size,3);assert.equal(latest.length,4);
  await assert.rejects(repairResearchArtifact({...args,previousValue:third.value,error:Error('M0A_BASELINE_RESPONSE_INVALID')}),/REPAIR_LIMIT/);
  await runResearchRender({...args,render:async()=>validReport()});
  assert.deepEqual(read(directory,'operations/baseline/attempts/3/renderer-report.json'),validReport());
  assert.equal(raw(directory).state,'awaiting_user');assert.equal(raw(directory).error,null);
});
test('mock baseline repair binds original request, project, full config, provider and previous response before any new charge',async t=>{
  const {args,generated,directory}=await setup(t);
  const repair={...args,previousValue:generated.value,error:Error('M0A_BASELINE_RESPONSE_INVALID')};
  for(const changed of [{input:{arm:'different'}},{instructions:'different'},
    {config:{...args.config,model:'another'}},{config:{...args.config,budgets:{...args.config.budgets,operationMicros:100001}}},
    {provider:{...args.provider,id:'another'}},{previousValue:{html:'unrelated'}}])
    await assert.rejects(repairResearchArtifact({...repair,...changed}),/IDENTITY_MISMATCH|PREVIOUS_RESPONSE_MISMATCH/);
  const other={...project(),id:'other'};await initializeProject({directory,project:other});
  await assert.rejects(repairResearchArtifact({...repair,projectId:other.id}),/IDENTITY_MISMATCH/);
  assert.equal(raw(directory).attempt,1);assert.equal(raw(directory).usage.costMicros,120);
});
test('mock baseline content repair cannot restart review, succeeded, rejected or cancelled operations',async t=>{
  for(const decision of ['pending','allowed','withheld']) {
    const {args,generated}=await setup(t);await runResearchRender({...args,render:async()=>validReport()});
    if(decision!=='pending') {
      const status=await getOperation(args);
      await recordReview({...args,receipt:{reviewerId:'human',reviewedAt:new Date().toISOString(),subjectHash:status.subjectHash,decision,
        policyVersion:'m0a-local-human-review-v1',evidenceRef:'mock only',checks:{facts:true,rights:true,contentSafety:true,normalSpeedAudiovisual:true,silentReadability:true},
        ...(decision==='withheld'?{notes:'Actual issue found.'}:{})}});
    }
    await assert.rejects(repairResearchArtifact({...args,previousValue:generated.value,error:Error('BASELINE_PAGE_ERRORS')}),/REPAIR_NOT_ALLOWED/);
  }
  const {args,generated}=await setup(t),controller=new AbortController();
  await assert.rejects(runResearchRender({...args,signal:controller.signal,render:async()=>{controller.abort();throw Error('BASELINE_PAGE_ERRORS');}}));
  await assert.rejects(repairResearchArtifact({...args,previousValue:generated.value,error:Error('BASELINE_PAGE_ERRORS')}),/REPAIR_NOT_ALLOWED/);
});
test('mock baseline denies rights/environment/unknown execution errors and cannot relabel them as content failures',async t=>{
  const forbidden=['M0A_BASELINE_RESOURCE_RIGHTS','LOCAL_AGENT_BUDGET_EXHAUSTED','LOCAL_AGENT_USAGE_UNKNOWN','BASELINE_EXECUTION_FAILED: stderr',
    'BASELINE_IMAGE_MISSING','BASELINE_CLEANUP_FAILED','BASELINE_OUTPUT_SPEC_UNRECOGNIZED'];
  for(const message of forbidden)assert.equal(isResearchRepairableError(Error(message)),false);
  for(const message of ['M0A_BASELINE_RESPONSE_INVALID','BASELINE_OUTPUT_SPEC','BASELINE_PAGE_ERRORS: concrete diagnostic'])assert.equal(isResearchRepairableError(Error(message)),true);
  const {args,generated}=await setup(t);const failure=Error('BASELINE_EXECUTION_FAILED: environment unknown');
  await assert.rejects(runResearchRender({...args,render:async()=>{throw failure;}}));
  await assert.rejects(repairResearchArtifact({...args,previousValue:generated.value,error:failure}),/REPAIR_NOT_ALLOWED/);
  await assert.rejects(repairResearchArtifact({...args,previousValue:generated.value,error:Error('BASELINE_PAGE_ERRORS')}),/ERROR_MISMATCH/);
});
test('mock baseline internal repairs retain cumulative budget and unknown model usage never enables another attempt',async t=>{
  const settings=config();settings.budgets.operationMicros=14000;
  const {args,generated,directory}=await setup(t,{settings});
  await assert.rejects(repairResearchArtifact({...args,previousValue:generated.value,error:Error('M0A_BASELINE_RESPONSE_INVALID')}),/BUDGET_EXHAUSTED/);
  assert.equal(raw(directory).usage.costMicros,120);assert.equal(raw(directory).state,'paused_budget');
  await assert.rejects(repairResearchArtifact({...args,previousValue:generated.value,error:Error('M0A_BASELINE_RESPONSE_INVALID')}),/REPAIR_NOT_ALLOWED/);
  const fresh=await setup(t),unknown={id:'mock',generate:async()=>{throw Error('network lost after dispatch');}};
  await assert.rejects(repairResearchArtifact({...fresh.args,provider:unknown,previousValue:fresh.generated.value,error:Error('M0A_BASELINE_RESPONSE_INVALID')}));
  assert.equal(raw(fresh.directory).usage.costMicros,14120);
  await assert.rejects(repairResearchArtifact({...fresh.args,previousValue:fresh.generated.value,error:Error('M0A_BASELINE_RESPONSE_INVALID')}),/REPAIR_NOT_ALLOWED/);
});
test('mock model alias remains requested identity while actual snapshots are retained and cannot drift during baseline repair',async t=>{
  const first=provider({html:'first'}),generate=first.generate;first.generate=async input=>({...await generate(input),model:'mock-snapshot-2026'});
  const {args,generated,directory}=await setup(t,{api:first});
  assert.equal(generated.model.id,'mock-model');assert.deepEqual(generated.returnedModel,{provider:'mock',id:'mock-snapshot-2026'});
  assert.deepEqual(raw(directory).returnedModels,[{attempt:1,provider:'mock',id:'mock-snapshot-2026'}]);
  await assert.rejects(repairResearchArtifact({...args,provider:provider({html:'different version'}),previousValue:generated.value,error:Error('M0A_BASELINE_RESPONSE_INVALID')}),/MODEL_MISMATCH/);
  assert.equal(raw(directory).returnedModels[1].id,'mock-model');assert.equal(raw(directory).usage.costMicros,240);
  assert.equal(read(directory,'operations/baseline/attempts/2/response.json').html,'different version');
});
