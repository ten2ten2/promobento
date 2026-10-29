import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {canonical,parseCanonicalJson} from '@promobento/contracts';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {historicalModelSpend} from '../../../research/model-probe/history.mjs';

async function load(path){const{outputFiles}=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm',target:'node26'});
 return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));}
const budget=await load('apps/cloud/src/model-budget.ts'),{modelStep}=await load('apps/cloud/src/model-client.ts');
async function fixture(t,confirmed=true,history){
 const shared=sqliteD1(),local=sqliteD1();t.after(()=>{shared.db.close();local.db.close();});const{MEDIA,objects}=memoryMedia();
 const env={DB:local.DB,MODEL_LEDGER:shared.DB,PIPELINE_ENVIRONMENT:'staging',MEDIA,MODEL_COMPAT_API_KEY:'synthetic-not-a-secret'};
 const opening=await budget.importModelOpening(env,history??{kind:'historical_model_spend',authorizationId:budget.modelAuthorizationId,scope:'all_model_spend_before_shared_ledger',sources:['offline fixture, no real provider use'],entries:[]});
 if(confirmed)await budget.confirmModelOpening(env,{kind:'model_spend_confirmation',authorizationId:budget.modelAuthorizationId,openingManifestHash:opening.openingManifestHash,approvedBy:'owner',totalUsdMicros:1000,basis:'Synthetic opening for isolated tests.',source:'offline fixture'});
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('model-operation','workspace','project',0,'calibration','active','request',10000000,Date.now(),null,null);
 return{shared,local,env,objects};
}

test('historical primary reports inventory every request; unknown prices/usage never become a zero opening',async t=>{
 const{env}=await fixture(t,false),history=historicalModelSpend();
 assert.equal(history.entries.length,128);assert.equal(history.entries.filter(row=>row.quote===null).length,14);
 assert.equal(history.entries.reduce((sum,row)=>sum+(row.quote?.usdMicros??0),0),255521);
 assert.ok(history.entries.filter(row=>row.quote).every(row=>row.quote.currency==='CNY'&&row.quote.usdRate===6.6863));
 await assert.rejects(budget.assertModelBudgetReady(env),/MODEL_HISTORY_RECONCILIATION_REQUIRED/);
 const different={...history,sources:['different inventory']};await assert.rejects(budget.importModelOpening(env,different),/MODEL_OPENING_CONFLICT/);
});
test('temporary history allowance preserves unknown opening, holds $5, caps cumulative new spend at $10 and never enables production',async t=>{
 const{env,shared}=await fixture(t,false,historicalModelSpend());
 const before=await budget.modelBudgetStatus(env);assert.equal(before.budgetBasis,'provisional');assert.equal(before.openingConfirmed,false);assert.equal(before.openingMicros,null);
 assert.equal(before.budgetedHistoryMicros,5000000);assert.equal(before.admissionLimitMicros,15000000);assert.equal(before.limitMicros,300000000);
 assert.equal(before.recordedHistoricalCalls,128);assert.equal(before.unpricedHistoricalCalls.length,14);
 await assert.rejects(budget.reserveModelBudget({...env,PIPELINE_ENVIRONMENT:'production'},'prod','prod-op',1,{},'catalog'),/MODEL_HISTORY_RECONCILIATION_REQUIRED/);
 const competing=await Promise.allSettled([budget.reserveModelBudget(env,'provisional-a','operation-a',7000000,{a:1},'catalog'),
  budget.reserveModelBudget({...env},'provisional-b','operation-b',7000000,{b:1},'catalog')]);
 assert.equal(competing.filter(value=>value.status==='fulfilled').length,1);assert.match(competing.find(value=>value.status==='rejected').reason.message,/MODEL_AUTHORIZATION_BUDGET_EXHAUSTED/);
 const id=competing.find(value=>value.status==='fulfilled').value;await budget.markModelDispatched(env,id);
 await assert.rejects(budget.reserveModelBudget(env,'over-cap','another-operation',3000001,{},'catalog'),/MODEL_AUTHORIZATION_BUDGET_EXHAUSTED/);
 assert.equal((await budget.modelBudgetStatus(env)).pending[0].reserved_micros,7000000);
 await budget.settleModelBudget(env,id,10000,{kind:'synthetic actual'});
 await budget.reserveModelBudget(env,'remaining','new-operation',9990000,{},'catalog');
 await assert.rejects(budget.reserveModelBudget(env,'one-more','newer-operation',1,{},'catalog'),/MODEL_AUTHORIZATION_BUDGET_EXHAUSTED/);
 const after=await budget.modelBudgetStatus(env);assert.equal(after.currentChargedMicros,10000000);assert.equal(after.openingConfirmed,false);assert.equal(after.openingMicros,null);
 assert.equal(shared.db.prepare('SELECT confirmation_json FROM model_budget_openings').get().confirmation_json,null);
 const originalDate=Date.now;try{Date.now=()=>Date.parse('2026-11-01T00:00:00+08:00');await assert.rejects(budget.assertModelBudgetReady(env),/MODEL_HISTORY_RECONCILIATION_REQUIRED/);}finally{Date.now=originalDate;}
 shared.db.prepare('UPDATE model_budget_openings SET manifest_hash=?').run('a'.repeat(64));
 await assert.rejects(budget.assertModelBudgetReady(env),/MODEL_HISTORY_RECONCILIATION_REQUIRED/);
});
test('staging/production compete atomically for one grant; unknown usage stays held and immutable settlement releases only proven amounts',async t=>{
 const{env}=await fixture(t),other={...env,PIPELINE_ENVIRONMENT:'production'};
 const entries=await Promise.allSettled([budget.reserveModelBudget(env,'call-a','operation-a',200000000,{a:1},'catalog'),budget.reserveModelBudget(other,'call-b','operation-b',200000000,{b:1},'catalog')]);
 assert.equal(entries.filter(row=>row.status==='fulfilled').length,1);assert.equal(entries.filter(row=>row.status==='rejected').length,1);
 const id=entries.find(row=>row.status==='fulfilled').value;
 await budget.markModelDispatched(env,id);assert.equal((await budget.modelBudgetStatus(other)).pending[0].reserved_micros,200000000);
 await assert.rejects(budget.settleModelBudget(env,id,0,{kind:'not_dispatched'},{notDispatched:true}),/COST_SETTLEMENT_CONFLICT/);
 await budget.settleModelBudget(env,id,17,{usage:'synthetic actual'});await budget.settleModelBudget(env,id,17,{usage:'synthetic actual'});
 await assert.rejects(budget.settleModelBudget(env,id,18,{usage:'changed'}),/COST_SETTLEMENT_CONFLICT/);
 assert.equal((await budget.modelBudgetStatus(other)).currentChargedMicros,17);
 const unused=await budget.reserveModelBudget(env,'unused','operation-a',10,{x:1},'catalog');
 await budget.settleModelBudget(env,unused,0,{kind:'not_dispatched'},{notDispatched:true});await assert.rejects(budget.markModelDispatched(env,unused),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 const status=await budget.modelBudgetStatus(env);assert.equal(status.openingMicros,1000);assert.equal(status.currentChargedMicros,17);assert.equal(status.pending.length,0);
});
test('persisted raw model response completes a failed ledger write without another provider request or repricing',async t=>{
 const{env,local,objects}=await fixture(t),fetch=globalThis.fetch;let requests=0,failLocalWrite=true;
 globalThis.fetch=async()=>{requests++;const data=value=>'data: '+canonical(value)+'\n\n';return new Response(data({choices:[{delta:{content:'{"value":"original fixture"}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})+'data: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=fetch;});const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{if(sql.startsWith('INSERT OR IGNORE INTO cost_settlements')&&failLocalWrite){failLocalWrite=false;throw Error('LOCAL_LEDGER_UNAVAILABLE');}return prepare(sql);};
 const request={system:'Original offline fixture.',messages:[{role:'user',text:'Return the original fixture JSON.'}],maxOutputTokens:64},check=value=>assert.equal(value.value,'original fixture');
 await assert.rejects(modelStep(env,'model-operation',0,'facts','recovery-call',request,check),/LOCAL_LEDGER_UNAVAILABLE/);
 assert.equal(requests,1);assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 const stored=[...objects.keys()].find(key=>key.includes('/model-calls/'));assert.ok(stored);const receipt=parseCanonicalJson(objects.get(stored).bytes);assert.equal(receipt.quote.currency,'CNY');
 const result=await modelStep(env,'model-operation',0,'facts','recovery-call',request,check);assert.equal(result.value.value,'original fixture');assert.equal(requests,1);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,receipt.quote.usdMicros);
 const cached=await modelStep(env,'model-operation',0,'facts','recovery-call',request,check);assert.equal(cached.cached,true);assert.equal(requests,1);
});
test('a completed truncated response is metered and retained, never cached or resent as a correction',async t=>{
 const{env,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"partial":'},finish_reason:'length'}]})+'\n\ndata: '+canonical({choices:[],usage:{prompt_tokens:100,completion_tokens:64}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 for(let n=0;n<2;n++)await assert.rejects(modelStep(env,'model-operation',0,'facts','truncated-call',request,()=>assert.fail('truncated output must not be validated as usable')),/MODEL_OUTPUT_TRUNCATED/);
 assert.equal(requests,1);const status=await budget.modelBudgetStatus(env);assert.ok(status.currentChargedMicros>0);assert.equal(status.pending.length,0);
 const receipt=parseCanonicalJson([...objects.values()].find(object=>parseCanonicalJson(object.bytes).kind==='metered_model_response').bytes);
 assert.equal(receipt.result.failure,'MODEL_OUTPUT_TRUNCATED');assert.equal(receipt.result.text,'{"partial":');
});
test('gateway Opus reserves the observed hidden-input risk before dispatch without raising the spec stage cap',async t=>{
 const{env}=await fixture(t),originalFetch=globalThis.fetch;let reserved=0;
 globalThis.fetch=async()=>{reserved=(await budget.modelBudgetStatus(env)).pending[0].reserved_micros;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 await modelStep(env,'model-operation',0,'spec','hidden-input-call',{system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},value=>assert.equal(value.ok,true));
 assert.ok(reserved>50000&&reserved<400000);assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
});
test('a parser fix reuses the settled exact response for the same project, preserving its old cost without a second request',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'```json\n{"ok":true}\n```'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline original fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','old-parser-call',request,()=>{throw Error('OLD_POSTPROCESSING_BUG');}),/OLD_POSTPROCESSING_BUG/);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new-request',10000000,Date.now(),null,null);
 const before=await budget.modelBudgetStatus(env);
 const value=await modelStep(env,'new-operation',0,'facts','new-parser-call',request,value=>assert.equal(value.ok,true));
 assert.equal(requests,1);assert.equal(value.cached,true);assert.match(value.reusedReceiptKey,/operations\/model-operation\/model-calls/);
 assert.equal((await budget.modelBudgetStatus(env)).currentChargedMicros,before.currentChargedMicros);assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
});
test('validated cache reuse stays within the original workspace, project and purpose',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:canonical({run:requests})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},validate=value=>assert.ok(Number.isInteger(value.run));
 await modelStep(env,'model-operation',0,'facts','original-call',request,validate);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('same-project','workspace','project',0,'calibration','active','same',10000000,Date.now(),null,null);
 const same=await modelStep(env,'same-project',0,'facts','same-call',request,validate);assert.equal(same.cached,true);assert.equal(requests,1);
 for(const[id,workspace,project,purpose]of [['other-project','workspace','other','calibration'],['other-workspace','other','project','calibration'],['other-purpose','workspace','project','evaluation']]){
  local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,workspace,project,0,purpose,'active',id,10000000,Date.now(),null,null);
  const next=await modelStep(env,id,0,'facts',id+'-call',request,validate);assert.equal(next.cached,false);assert.equal(next.value.run,requests);
 }
 assert.equal(requests,4);
});
test('a valid response without usage cannot be reused by another operation',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:canonical({run:requests})},finish_reason:'stop'}],...(requests===1?{}:{usage:{prompt_tokens:100,completion_tokens:10}})})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},validate=value=>assert.ok(Number.isInteger(value.run));
 await modelStep(env,'model-operation',0,'facts','unknown-call',request,validate);
 const before=await budget.modelBudgetStatus(env);assert.equal(before.pending.length,1);
 const replay=await modelStep(env,'model-operation',0,'facts','unknown-call',request,validate);assert.equal(replay.value.run,1);assert.equal(requests,1);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 const next=await modelStep(env,'new-operation',0,'facts','new-call',request,validate);assert.equal(next.cached,false);assert.equal(next.value.run,2);assert.equal(requests,2);
 const after=await budget.modelBudgetStatus(env);assert.deepEqual(after.pending,before.pending);
});
test('legacy cache re-admits a settled receipt in the same scope without a new request',async t=>{
 const{env,local,shared}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},validate=value=>assert.equal(value.ok,true);
 await modelStep(env,'model-operation',0,'facts','legacy-call',request,validate);
 const hash=local.db.prepare('SELECT request_hash FROM cost_reservations WHERE id=?').get('legacy-call').request_hash;
 local.db.prepare('UPDATE model_responses SET cache_key=?').run(hash);
 shared.db.prepare('UPDATE model_budget_openings SET total_micros=NULL,confirmation_json=NULL').run();
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 const reused=await modelStep(env,'new-operation',0,'facts','new-call',request,validate);
 assert.equal(reused.cached,true);assert.match(reused.reusedReceiptKey,/operations\/model-operation\/model-calls/);assert.equal(requests,1);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
});
test('settled spec and scene-layout tool responses can be reused in the same scope',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async(_url,init)=>{requests++;const body=JSON.parse(init.body),delta=body.tools
  ?{tool_calls:[{index:0,id:'edit',function:{name:'edit_file',arguments:canonical({command:'create',path:'scenes/product/index.js',content:'layout fixture'})}}]}
  :{content:canonical({film:{title:'spec fixture'}})};
  return new Response('data: '+canonical({choices:[{delta,finish_reason:body.tools?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const spec={system:'Offline spec.',messages:[{role:'user',text:'Write a spec.'}],maxOutputTokens:64};
 const layout={system:'Offline layout.',messages:[{role:'user',text:'Create the layout.'}],maxOutputTokens:64,tools:[{name:'edit_file',description:'Edit a scene.',parameters:{type:'object'}}]};
 const checkSpec=value=>assert.equal(value.film.title,'spec fixture'),checkLayout=value=>assert.equal(value.toolCalls[0].input.path,'scenes/product/index.js');
 await modelStep(env,'model-operation',0,'spec','spec-call',spec,checkSpec);
 await modelStep(env,'model-operation',0,'scenes','layout-call',layout,checkLayout,Date.now()+60000,{sceneId:'product'});
 const before=await budget.modelBudgetStatus(env);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 assert.equal((await modelStep(env,'new-operation',0,'spec','new-spec',spec,checkSpec)).cached,true);
 assert.equal((await modelStep(env,'new-operation',0,'scenes','new-layout',layout,checkLayout,Date.now()+60000,{sceneId:'product'})).cached,true);
 assert.equal(requests,2);assert.equal((await budget.modelBudgetStatus(env)).currentChargedMicros,before.currentChargedMicros);
});
test('missing settled receipt stops reuse without silently buying the response again',async t=>{
 const{env,local,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await modelStep(env,'model-operation',0,'facts','old-call',request,value=>assert.equal(value.ok,true));
 local.db.prepare('DELETE FROM model_responses').run();for(const key of objects.keys())if(key.includes('/model-calls/'))objects.delete(key);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 await assert.rejects(modelStep(env,'new-operation',0,'facts','new-call',request,()=>{}),/MODEL_RECEIPT_UNAVAILABLE/);
 assert.equal(requests,1);assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
});
test('receipt recovery finds a later usable response after a failed or unavailable older one',async t=>{
 const{env,local,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:requests===1?'{':'{"ok":true}'},finish_reason:requests===1?'length':'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},validate=value=>assert.equal(value.ok,true);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','a-truncated',request,validate),/MODEL_OUTPUT_TRUNCATED/);
 const firstReceipt=[...objects.keys()].find(key=>key.includes('/model-calls/'));
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('second','workspace','project',0,'calibration','active','second',10000000,Date.now(),null,null);
 await modelStep(env,'second',0,'facts','b-valid',request,validate);assert.equal(requests,2);
 for(const[id,removeFirst]of [['third',false],['fourth',true]]){
  local.db.prepare('DELETE FROM model_responses').run();if(removeFirst)objects.delete(firstReceipt);
  local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'workspace','project',0,'calibration','active',id,10000000,Date.now(),null,null);
  const reused=await modelStep(env,id,0,'facts',id+'-call',request,validate);
  assert.equal(reused.cached,true);assert.match(reused.reusedReceiptKey,/operations\/second\/model-calls/);assert.equal(requests,2);
 }
});
test('a later cached response cannot replace an earlier call whose outcome is unknown',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;if(requests===1)throw Error('Network connection lost.');
  return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},validate=value=>assert.equal(value.ok,true);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','unknown-call',request,validate),/MODEL_TRANSPORT_FAILED/);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 await modelStep(env,'new-operation',0,'facts','new-call',request,validate);assert.equal(requests,2);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','unknown-call',request,validate),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,2);const status=await budget.modelBudgetStatus(env);assert.equal(status.pending.length,1);assert.ok(status.pending[0].reserved_micros>0);
});
for(const phase of ['fetch','fetch-status','stream'])test(`network connection loss during ${phase} preserves the reservation and never resends the call`,async t=>{
 const{env,local,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;if(phase.startsWith('fetch'))throw Object.assign(Error('Network connection lost.'),phase==='fetch-status'?{status:503}:{});
  return new Response(new ReadableStream({pull(controller){controller.error(Error('Network connection lost.'));}}));};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const callId='network-'+phase,request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts',callId,request,()=>assert.fail('no response to validate')),/MODEL_TRANSPORT_FAILED/);
 const before=await budget.modelBudgetStatus(env);assert.equal(before.pending.length,1);assert.ok(before.pending[0].reserved_micros>0);assert.ok(before.pending[0].dispatched_at);
 await assert.rejects(modelStep(env,'model-operation',0,'facts',callId,request,()=>assert.fail('no response to validate')),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,1);const after=await budget.modelBudgetStatus(env);assert.deepEqual(after.pending,before.pending);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM model_responses').get().n,0);
 const diagnostics=[...objects.entries()].filter(([key])=>key.endsWith('-request-failure.json'));
 assert.equal(diagnostics.length,1);const failure=parseCanonicalJson(diagnostics[0][1].bytes);
 assert.equal(failure.callId,callId);assert.equal(failure.code,'MODEL_TRANSPORT_FAILED');assert.equal(failure.httpStatus,phase==='fetch-status'?503:null);assert.equal(failure.usageStatus,'unknown');
 assert.doesNotMatch(canonical(failure),/synthetic-not-a-secret|Network connection lost/);
});
test('SSE parser failure is not recorded as a network failure',async t=>{
 const{env,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: {\n\n');};t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','invalid-sse',request,()=>{}),error=>{assert.ok(error instanceof SyntaxError);return true;});
 const diagnostic=[...objects.entries()].find(([key])=>key.endsWith('-request-failure.json'));
 const failure=parseCanonicalJson(diagnostic[1].bytes);assert.equal(failure.code,'MODEL_ADAPTER_FAILED');assert.equal(failure.usageStatus,'unknown');
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);assert.equal(requests,1);
});
test('complete malformed tool output is persisted and settled before correction; unknown usage stays held',async t=>{
 const{env,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{tool_calls:[{index:0,id:'bad',function:{name:'submit_candidate',arguments:'{"note":"unfinished'}}]},finish_reason:'tool_calls'}]})+'\n\n'+(requests===1?'data: '+canonical({choices:[],usage:{prompt_tokens:100,completion_tokens:64}})+'\n\n':'')+'data: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Malformed complete tool fixture.'}],maxOutputTokens:64};
 for(let n=0;n<2;n++)await assert.rejects(modelStep(env,'model-operation',0,'facts','malformed-known',request,()=>assert.fail('invalid tool cannot reach validator')),error=>{
  assert.equal(error.message,'MODEL_TOOL_JSON_INVALID');assert.equal(error.completedOutput.toolCalls[0].arguments,'{"note":"unfinished');return true;
 });
 assert.equal(requests,1);assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
 const receipt=parseCanonicalJson([...objects.values()].find(object=>parseCanonicalJson(object.bytes).kind==='metered_model_response').bytes);
 assert.equal(receipt.result.failure,'MODEL_TOOL_JSON_INVALID');assert.equal(receipt.result.toolCalls[0].arguments,'{"note":"unfinished');assert.ok(receipt.quote.usdMicros>0);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','malformed-unknown',{...request,messages:[{role:'user',text:'Unknown complete tool fixture.'}]},()=>assert.fail('invalid tool cannot reach validator')),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,2);const after=await budget.modelBudgetStatus(env);assert.equal(after.pending.length,1);assert.ok(after.pending[0].reserved_micros>0);
});
