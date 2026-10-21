import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {initializeProject,createWork,getOperation} from '../src/runner.mjs';
import {createOpenAIProvider} from '../src/openai.mjs';
import {publicErrorCode} from '../src/errors.mjs';
import {config,project,provider,mockMethod,mockRender} from './fixtures.mjs';
const secret='PRIVATE_UNREVIEWED_BODY';
async function setup(t) {
  const directory=mkdtempSync(join(tmpdir(),'agent-private-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  await initializeProject({directory,project:project()});return {directory,projectId:project().id,config:config(),operationId:'private',method:mockMethod,render:mockRender};
}
const raw=args=>parseCanonicalJson(readFileSync(join(args.directory,'operations/private/run.json')));
const diagnostic=args=>readFileSync(join(args.directory,'operations/private/private-error.json'),'utf8');
async function assertPrivate(args,expectedCost) {
  assert.equal((await getOperation(args)).outputStatus,'withheld');
  assert.ok(!JSON.stringify(await getOperation(args)).includes('PRIVATE_UN'));assert.equal(raw(args).usage.costMicros,expectedCost);
  assert.match(diagnostic(args),/PRIVATE_UN/);assert.equal(statSync(join(args.directory,'operations/private/private-error.json')).mode&0o777,0o600);
  const cli=spawnSync(process.execPath,['apps/agent-runner/scripts/local-agent.mjs','status','--directory',args.directory,'--operation-id','private'],{encoding:'utf8'});
  assert.equal(cli.status,0);assert.ok(!cli.stdout.includes('PRIVATE_UN'));assert.ok(!cli.stderr.includes('PRIVATE_UN'));
}
test('invalid model JSON retains settled costs and private diagnostics but never exposes response text in status/CLI',async t=>{
  const args=await setup(t),api=provider(),generate=api.generate;api.generate=async input=>({...await generate(input),text:secret});
  await assert.rejects(createWork({...args,provider:api}),error=>error.message==='LOCAL_AGENT_MODEL_RESPONSE_INVALID');
  await assertPrivate(args,120);assert.equal(raw(args).returnedModels[0].id,'mock-model');
});
test('invalid provider response JSON retains unknown reservation but exposes only fixed error code',async t=>{
  const args=await setup(t);let calls=0;
  const api=createOpenAIProvider(args.config,{apiKey:'unit-test-only',fetchImpl:async()=>++calls===1?new Response('{"input_tokens":1}'):new Response(secret)});
  await assert.rejects(createWork({...args,provider:api}),error=>error.message==='LOCAL_AGENT_PROVIDER_RESPONSE_INVALID');
  await assertPrivate(args,14000);assert.equal(calls,2);
});
test('renderer diagnostics and attacker-chosen error prefixes cannot cross withheld status or CLI',async t=>{
  const args=await setup(t);
  await assert.rejects(createWork({...args,provider:provider(),render:async()=>{throw Error('ADMISSION_SOURCE_ERROR: '+secret);}}));
  await assertPrivate(args,360);
  assert.equal(publicErrorCode(Error('LOCAL_AGENT_PRIVATE_'+secret)),'LOCAL_AGENT_OPERATION_FAILED');
  assert.equal(publicErrorCode(Error('LOCAL_AGENT_RENDER_FAILED: '+secret)),'LOCAL_AGENT_RENDER_FAILED');
  const file=join(args.directory,'bad-project.json');writeFileSync(file,secret);
  const cli=spawnSync(process.execPath,['apps/agent-runner/scripts/local-agent.mjs','init','--directory',args.directory,'--project',file],{encoding:'utf8'});
  assert.equal(cli.status,1);assert.ok(!cli.stdout.includes('PRIVATE_UN'));assert.ok(!cli.stderr.includes('PRIVATE_UN'));
  assert.deepEqual(parseCanonicalJson(cli.stderr),{error:'LOCAL_AGENT_OPERATION_FAILED'});
});
test('provider omission of actual model version is not silently replaced with requested alias',async t=>{
  const args=await setup(t),api=provider(),generate=api.generate;
  api.generate=async input=>{const value=await generate(input);delete value.model;return value;};
  await assert.rejects(createWork({...args,provider:api}),/PROVIDER_MODEL_REQUIRED/);
  assert.equal(raw(args).usage.costMicros,120);assert.equal(raw(args).model.id,'mock-model');assert.equal(raw(args).returnedModels,undefined);
});
