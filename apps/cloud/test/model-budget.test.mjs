import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {modelCallCostMicros} from '../../../packages/contracts/src/models.mjs';
import {assertScriptProjection} from '../../../packages/methods/production-documents.mjs';
import providers from '../../../config/model-providers.json' with {type:'json'};
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {historicalModelSpend} from '../../../research/model-probe/history.mjs';
import {reconcileOperation} from '../src/render-recovery.ts';

async function load(path){const{outputFiles}=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm',target:'node26'});
 return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));}
const budget=await load('apps/cloud/src/model-budget.ts'),{modelStep}=await load('apps/cloud/src/model-client.ts'),
 {analyzeMaterialStage}=await load('apps/cloud/src/director-stages.ts');
async function fixture(t,confirmed=true,history){
 const shared=sqliteD1(),local=sqliteD1();t.after(()=>{shared.db.close();local.db.close();});const{MEDIA,objects}=memoryMedia();
 const env={DB:local.DB,MODEL_LEDGER:shared.DB,PIPELINE_ENVIRONMENT:'staging',MEDIA,MODEL_COMPAT_API_KEY:'synthetic-not-a-secret'};
 const opening=await budget.importModelOpening(env,history??{kind:'historical_model_spend',authorizationId:budget.modelAuthorizationId,scope:'all_model_spend_before_shared_ledger',sources:['offline fixture, no real provider use'],entries:[]});
 if(confirmed)await budget.confirmModelOpening(env,{kind:'model_spend_confirmation',authorizationId:budget.modelAuthorizationId,openingManifestHash:opening.openingManifestHash,approvedBy:'owner',totalUsdMicros:1000,basis:'Synthetic opening for isolated tests.',source:'offline fixture'});
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('model-operation','workspace','project',0,'calibration','active','request',10000000,Date.now(),null,null);
 return{shared,local,env,objects};
}

test('identical concurrent observations share one metered request while other operations still honor pending and receipt barriers',async t=>{
 const{env,local,shared}=await fixture(t),oldFetch=globalThis.fetch;
 let requests=0,releaseProvider,markStarted;
 const held=new Promise(resolve=>{releaseProvider=resolve;});
 const started=new Promise(resolve=>{markStarted=resolve;});
 globalThis.fetch=async()=>{
  requests++;markStarted();await held;
  return new Response('data: '+canonical({choices:[{delta:{content:'{"value":"shared observation"}'},finish_reason:'stop'}],
   usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{releaseProvider();globalThis.fetch=oldFetch;});
 const asset={resourceId:'res_shared',sha256:'a'.repeat(64),preview:{sha256:'b'.repeat(64),mediaType:'image/png'}};
 const identity=item=>canonical([item.resourceId,item.sha256,item.preview.sha256,item.preview.mediaType]);
 const request={system:'Synthetic offline observation.',messages:[{role:'user',text:'Analyze identical signed evidence.'}],maxOutputTokens:64};
 const check=value=>assert.equal(value.value,'shared observation');
 const analyze=(item,index,guard)=>modelStep(env,'model-operation',0,'assets','model-operation-asset-'+index,request,check,Date.now()+30_000,
  {dispatchGuard:guard}).then(result=>result.value);
 const observed=analyzeMaterialStage([asset,structuredClone(asset)],2,analyze,identity);
 await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('MODEL_REQUEST_NOT_STARTED')),1_000))]);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('other-operation','workspace','project',0,'calibration','active','other-request',10000000,Date.now(),null,null);
 await assert.rejects(modelStep(env,'other-operation',0,'assets','other-asset-0',request,check),/MODEL_CALL_RECONCILIATION_REQUIRED/,
  'a genuinely pending provider call is not a reusable completed result');
 releaseProvider();
 assert.deepEqual(await observed,[{value:'shared observation'},{value:'shared observation'}]);
 assert.equal(requests,1,'the duplicate asset did not start another paid request');
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
 assert.equal(shared.db.prepare('SELECT COUNT(*) AS n FROM model_budget_reservations').get().n,1);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,1);
 const reused=await modelStep(env,'other-operation',0,'assets','other-asset-0',request,check);
 assert.equal(reused.cached,true,'a settled response with a receipt is safely reusable');
 assert.equal(requests,1);
});

test('two simultaneous direction author previews fit their aggregate stage budget without weakening per-call reserves',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;
 let started=0,release,signalStarted;
 const held=new Promise(resolve=>{release=resolve;}),bothStarted=new Promise(resolve=>{signalStarted=resolve;});
 globalThis.fetch=async()=>{
  if(++started===2)signalStarted();
  await held;
  return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],
   usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{release();globalThis.fetch=originalFetch;});
 const author=key=>modelStep(env,'model-operation',0,'author','model-operation-direction-'+key,
  {system:'Offline native preview.',messages:[{role:'user',text:'Build direction '+key+' A'.repeat(100000)}],maxOutputTokens:24576},
  value=>assert.equal(value.ok,true));
 const work=Promise.all([author('fit'),author('amplify')]);
 try{
  await Promise.race([bothStarted,new Promise((_,reject)=>setTimeout(()=>reject(Error('AUTHOR_PREVIEW_ADMISSION_FAILED')),1000))]);
  const reserved=local.db.prepare("SELECT SUM(reserved_micros) AS total FROM cost_reservations WHERE stage='author'").get().total;
  assert.ok(reserved>350000,'two valid worst-case author reservations must coexist');
  assert.ok(reserved<=4200000,'the aggregate author allowance is still bounded');
 }finally{release();}
 const results=await work;
 assert.equal(results.length,2);assert.equal(started,2);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS count FROM cost_settlements').get().count,2);
});

test('historical primary reports inventory every request; unknown prices/usage never become a zero opening',async t=>{
 const{env}=await fixture(t,false),history=historicalModelSpend();
 assert.equal(history.entries.length,128);assert.equal(history.entries.filter(row=>row.quote===null).length,14);
 assert.equal(history.entries.reduce((sum,row)=>sum+(row.quote?.usdMicros??0),0),255521);
 assert.ok(history.entries.filter(row=>row.quote).every(row=>row.quote.currency==='CNY'&&row.quote.usdRate===6.6863));
 await assert.rejects(budget.assertModelBudgetReady(env),/MODEL_HISTORY_RECONCILIATION_REQUIRED/);
 const different={...history,sources:['different inventory']};await assert.rejects(budget.importModelOpening(env,different),/MODEL_OPENING_CONFLICT/);
});
test('temporary history allowance preserves unknown opening, holds $5, caps cumulative new spend at $10 and never enables production',async t=>{
 const actualNow=Date.now;t.after(()=>{Date.now=actualNow;});Date.now=()=>Date.parse('2026-10-31T12:00:00+08:00');
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
for(const fence of ['expired','key-removed'])test(`durable model receipts finish bookkeeping after provider access is ${fence}`,async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch,realNow=Date.now;let requests=0,failLocalWrite=true;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;Date.now=realNow;});
 const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{if(sql.startsWith('INSERT OR IGNORE INTO cost_settlements')&&failLocalWrite){failLocalWrite=false;throw Error('LOCAL_LEDGER_UNAVAILABLE');}return prepare(sql);};
 const request={system:'Offline durable response recovery.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 const check=value=>assert.equal(value.ok,true);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','access-fenced-receipt',request,check),/LOCAL_LEDGER_UNAVAILABLE/);
 if(fence==='expired')Date.now=()=>Date.parse('2027-01-01T00:00:00+08:00');else delete env.MODEL_COMPAT_API_KEY;
 const recovered=await modelStep(env,'model-operation',0,'facts','access-fenced-receipt',request,check);
 assert.equal(recovered.cached,true);assert.equal(requests,1);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,1);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','new-fenced-call',{...request,messages:[{role:'user',text:'A new paid request.'}]},check),
  fence==='expired'?/MODEL_NOT_AUTHORIZED/:/MODEL_SECRET_MISSING/);
 assert.equal(requests,1,'bookkeeping recovery never re-enables new provider calls');
});
for(const side of ['local','shared'])for(const ackLost of [false,true])
test(`terminal recovery settles a completed ${side} ledger ${ackLost?'lost acknowledgement':'write failure'} without another model request`,async t=>{
 const{env,local,shared,objects}=await fixture(t),oldFetch=globalThis.fetch;
 let requests=0,fail=true;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],
  usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=oldFetch;});
 const DB=side==='local'?env.DB:env.MODEL_LEDGER,prepare=DB.prepare.bind(DB);
 const prefix=side==='local'?'INSERT OR IGNORE INTO cost_settlements':'INSERT OR IGNORE INTO model_budget_settlements';
 DB.prepare=sql=>{const statement=prepare(sql);if(!sql.startsWith(prefix))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
   if(fail&&!ackLost){fail=false;throw Error('SETTLEMENT_INTERRUPTED');}
   const result=await bound.run();if(fail){fail=false;throw Error('SETTLEMENT_INTERRUPTED');}return result;
  }};}};};
 const request={system:'Offline completed terminal bill.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','completed-terminal',request,()=>{}),/SETTLEMENT_INTERRUPTED/);
 const receipt=parseCanonicalJson([...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'))[1].bytes);
 local.db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1 WHERE id='model-operation'").run();
 delete env.MODEL_COMPAT_API_KEY;
 const cleaned=await Promise.all([reconcileOperation(env,'model-operation'),reconcileOperation(env,'model-operation')]);
 assert.ok(cleaned.every(result=>result.pendingCosts.length===0));
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,receipt.quote.usdMicros);
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,receipt.quote.usdMicros);
 assert.equal(local.db.prepare('SELECT COUNT(*) n FROM model_responses').get().n,0,'accounting recovery does not approve model output');
 await assert.rejects(modelStep(env,'model-operation',0,'facts','completed-terminal',request,()=>{}),/OPERATION_FENCED/);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('receipt-followup','workspace','project',0,'calibration','active','next',10000000,Date.now(),null,null);
 const reused=await modelStep(env,'receipt-followup',0,'facts','reuse-completed',request,value=>assert.equal(value.ok,true));
 assert.equal(reused.cached,true);assert.equal(requests,1,'a new operation can validate the existing paid receipt without provider access');
});
test('terminal recovery refuses mismatched completed source identity and preserves unknown bills',async t=>{
 const{env,local,shared,objects}=await fixture(t),oldFetch=globalThis.fetch;
 let fail=true;
 globalThis.fetch=async()=>new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');
 t.after(()=>{globalThis.fetch=oldFetch;});
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);
 env.MODEL_LEDGER.prepare=sql=>{if(sql.startsWith('INSERT OR IGNORE INTO model_budget_settlements')&&fail){fail=false;throw Error('SETTLEMENT_INTERRUPTED');}return prepare(sql);};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','source-bound-bill',
  {system:'Offline source identity.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},()=>{}),/SETTLEMENT_INTERRUPTED/);
 local.db.prepare("UPDATE pipeline_operations SET status='failed' WHERE id='model-operation'").run();
 const [key,object]=[...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'));
 const receipt=parseCanonicalJson(object.bytes),replace=value=>{
  const bytes=new TextEncoder().encode(canonical(value));objects.set(key,{bytes,customMetadata:{sha256:sha256Bytes(bytes)}});
 };
 for(const patch of [{callId:'wrong-call'},{requestHash:'a'.repeat(64)},{budgetId:'b'.repeat(64)},
  {rawStreamRef:{...receipt.rawStreamRef,key:'operations/other/model-streams/other.sse'}}]){
  replace({...receipt,...patch});await assert.rejects(reconcileOperation(env,'model-operation'),/MODEL_RECEIPT_CONFLICT/);
 }
 for(const patch of [{quote:null},{result:{...receipt.result,streamComplete:false}}]){
  replace({...receipt,...patch});assert.equal((await reconcileOperation(env,'model-operation')).pendingCosts.length,1);
 }
 assert.equal(local.db.prepare('SELECT COUNT(*) n FROM cost_settlements').get().n,0);
 assert.equal(shared.db.prepare('SELECT COUNT(*) n FROM model_budget_settlements').get().n,0);
 replace(receipt);assert.deepEqual((await reconcileOperation(env,'model-operation')).pendingCosts,[]);
});
test('terminal recovery releases a shared admission with a lost acknowledgement and no local row',async t=>{
 const{env,local,shared}=await fixture(t),oldFetch=globalThis.fetch;let requests=0,loseAck=true,loseCleanupAck=true;
 globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PROVIDER_CALL');};t.after(()=>{globalThis.fetch=oldFetch;});
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);
 env.MODEL_LEDGER.prepare=sql=>{const statement=prepare(sql);
  if(!sql.startsWith('INSERT INTO model_budget_reservations')&&!sql.startsWith('INSERT OR IGNORE INTO model_budget_settlements'))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){const result=await bound.run();
   if(sql.startsWith('INSERT INTO model_budget_reservations')&&loseAck){loseAck=false;throw Error('SHARED_ADMISSION_ACK_LOST');}
   if(sql.startsWith('INSERT OR IGNORE INTO model_budget_settlements')&&loseCleanupAck){loseCleanupAck=false;throw Error('SHARED_CLEANUP_ACK_LOST');}
   return result;
  }};}};};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','orphan-admission',
  {system:'Offline shared admission.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},()=>{}),/SHARED_ADMISSION_ACK_LOST/);
 assert.equal(local.db.prepare('SELECT COUNT(*) n FROM cost_reservations').get().n,0);
 await assert.rejects(budget.reconcileModelCosts(env,'model-operation'),/OPERATION_NOT_TERMINAL/);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
 local.db.prepare("UPDATE pipeline_operations SET status='failed' WHERE id='model-operation'").run();
 await assert.rejects(reconcileOperation(env,'model-operation'),/SHARED_CLEANUP_ACK_LOST/);
 assert.deepEqual((await reconcileOperation(env,'model-operation')).pendingCosts,[]);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
 assert.equal(shared.db.prepare('SELECT COUNT(*) n FROM model_budget_settlements').get().n,1);
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,0);
 assert.equal(requests,0);
});
test('orphan recovery scopes the grant, origin and operation and cannot beat a committed dispatch marker',async t=>{
 const{env,local,shared}=await fixture(t);
 const intended=await budget.reserveModelBudget(env,'marker-race','model-operation',100,{},providers.catalogVersion);
 await budget.reserveModelBudget({...env,PIPELINE_ENVIRONMENT:'production'},'other-origin','model-operation',100,{},providers.catalogVersion);
 await budget.reserveModelBudget(env,'other-operation','another-operation',100,{},providers.catalogVersion);
 local.db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1 WHERE id='model-operation'").run();
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);let marked=false;
 env.MODEL_LEDGER.prepare=sql=>{
  if(sql.startsWith('INSERT OR IGNORE INTO model_budget_settlements')&&!marked){marked=true;
   shared.db.prepare('UPDATE model_budget_reservations SET dispatched_at=? WHERE id=?').run(Date.now(),intended);}
  return prepare(sql);
 };
 assert.deepEqual((await reconcileOperation(env,'model-operation')).pendingCosts,[]);
 assert.equal(marked,true);assert.equal(shared.db.prepare('SELECT COUNT(*) n FROM model_budget_settlements').get().n,0);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,3,'a marker winner and other scopes remain reserved');
});
test('a completed truncated response is metered and retained, never cached or resent as a correction',async t=>{
 const{env,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"partial":'},finish_reason:'length'}]})+'\n\ndata: '+canonical({choices:[],usage:{prompt_tokens:100,completion_tokens:64}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 for(let n=0;n<2;n++)await assert.rejects(modelStep(env,'model-operation',0,'facts','truncated-call',request,()=>assert.fail('truncated output must not be validated as usable')),/MODEL_OUTPUT_TRUNCATED/);
 assert.equal(requests,1);const status=await budget.modelBudgetStatus(env);assert.ok(status.currentChargedMicros>0);assert.equal(status.pending.length,0);
 const receipt=parseCanonicalJson([...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'))[1].bytes);
 assert.equal(receipt.result.failure,'MODEL_OUTPUT_TRUNCATED');assert.equal(receipt.result.text,'{"partial":');
});
test('a failed incomplete model stream cannot settle from provisional mid-stream token usage',async t=>{
 const{env,local,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response(
  'data: '+canonical({choices:[],usage:{prompt_tokens:100,completion_tokens:2}})+'\n\n'+
  'data: '+canonical({error:{code:502,message:'upstream disconnected'}})+'\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 for(let n=0;n<2;n++)await assert.rejects(modelStep(env,'model-operation',0,'facts','incomplete-usage-call',request,()=>{}),
  /MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,1,'an incomplete paid call may never be silently replayed');
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 const receipt=parseCanonicalJson([...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'))[1].bytes);
 assert.equal(receipt.result.failure,'MODEL_STREAM_FAILED');
 assert.equal(receipt.result.streamComplete,false);
 assert.equal(receipt.result.usage.completion_tokens,2);
 assert.equal(receipt.quote,null,'mid-stream usage is evidence, not final charge confirmation');
});
test('a completed response with invalid cached-token usage keeps its reservation and cannot be reused as a settled bill',async t=>{
 const{env,local,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{
  requests++;
  return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],
   usage:{prompt_tokens:10000,completion_tokens:20,prompt_tokens_details:{cached_tokens:0.5}}})+'\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Synthetic cached-token usage check.',messages:[{role:'user',text:'Return ok.'}],maxOutputTokens:64};
 const check=value=>assert.equal(value.ok,true);
 const first=await modelStep(env,'model-operation',0,'facts','invalid-cache-usage',request,check);
 assert.equal(first.value.ok,true);
 const receipt=parseCanonicalJson([...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'))[1].bytes);
 assert.equal(receipt.quote,null,'malformed reported usage must not produce an exact price');
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 const replay=await modelStep(env,'model-operation',0,'facts','invalid-cache-usage',request,check);
 assert.equal(replay.cached,true);assert.equal(requests,1);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('other-operation','workspace','project',0,'calibration','active','another-request',10000000,Date.now(),null,null);
 await assert.rejects(modelStep(env,'other-operation',0,'facts','other-invalid-cache',request,check),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,1);
});
for(const [stage,currency] of [['facts','original currency'],['treatment','USD']])test(`a completed response with ${currency} overflow keeps its receipt and reservation without resending`,async t=>{
 const{env,local,shared,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 const usage={prompt_tokens:9e15,completion_tokens:9e15};
 const raw='data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage})+'\n\ndata: [DONE]\n\n';
 globalThis.fetch=async()=>{requests++;return new Response(raw);};t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline cost overflow fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 const check=value=>assert.equal(value.ok,true),callId='overflow-call';
 const first=await modelStep(env,'model-operation',0,stage,callId,request,check);
 assert.deepEqual(first,{value:{ok:true},cached:false},'a complete usable result still reaches finish');
 const receipt=parseCanonicalJson(objects.get(`operations/model-operation/model-calls/${digest({callId})}.json`).bytes);
 assert.equal(receipt.kind,'metered_model_response');assert.equal(receipt.quote,null);
 assert.equal(receipt.result.failure,undefined);assert.deepEqual(receipt.result.usage,usage);
 assert.equal(new TextDecoder().decode(objects.get(receipt.rawStreamRef.key).bytes),raw);
 const before=await budget.modelBudgetStatus(env);assert.equal(before.pending.length,1);
 assert.ok(before.pending[0].dispatched_at!==null);assert.ok(before.pending[0].reserved_micros>0);
 assert.equal(local.db.prepare('SELECT reserved_micros FROM cost_reservations WHERE id=?').get(callId).reserved_micros,before.pending[0].reserved_micros);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 assert.equal(shared.db.prepare('SELECT COUNT(*) AS n FROM model_budget_settlements').get().n,0);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM model_responses').get().n,0);
 const replay=await modelStep(env,'model-operation',0,stage,callId,request,check);
 assert.equal(replay.cached,true);assert.equal(requests,1);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('other-operation','workspace','project',0,'calibration','active','another-request',10000000,Date.now(),null,null);
 await assert.rejects(modelStep(env,'other-operation',0,stage,'other-overflow-call',request,check),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 local.db.prepare("UPDATE pipeline_operations SET status='failed' WHERE id='model-operation'").run();
 assert.equal(await budget.reconcileModelCosts(env,'model-operation'),0,'terminal recovery must not release a dispatched call with unknown cost');
 assert.deepEqual((await budget.modelBudgetStatus(env)).pending,before.pending);assert.equal(requests,1);
});
test('an overflowing pre-dispatch estimate never reserves funds or sends a paid request',async t=>{
 const{env,local,shared}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PAID_REQUEST');};t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline cost overflow fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:Number.MAX_SAFE_INTEGER};
 await assert.rejects(modelStep(env,'model-operation',0,'treatment','overflow-preflight',request,()=>assert.fail('no response')),/MODEL_COST_OVERFLOW/);
 assert.equal(requests,0);assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,0);
 assert.equal(shared.db.prepare('SELECT COUNT(*) AS n FROM model_budget_reservations').get().n,0);
});
test('an empty completed stream retains private raw events and an unknown reservation without resending',async t=>{
 const{env,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 const raw='data: '+canonical({choices:[{delta:{reasoning_content:'fixture'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n';
 globalThis.fetch=async()=>{requests++;return new Response(raw);};t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 for(let n=0;n<2;n++)await assert.rejects(modelStep(env,'model-operation',0,'facts','empty-call',request,()=>assert.fail('empty output')),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,1);assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
 const receipt=parseCanonicalJson([...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'))[1].bytes);
 assert.equal(receipt.result.failure,'MODEL_OUTPUT_EMPTY');assert.equal(receipt.quote,null);
 assert.equal(new TextDecoder().decode(objects.get(receipt.rawStreamRef.key).bytes),raw);
});
test('an expired model preflight never reserves funds or dispatches a paid request',async t=>{
 const{env,local,shared}=await fixture(t),realNow=Date.now,originalFetch=globalThis.fetch;
 let clock=realNow(),jumped=false,requests=0;
 Date.now=()=>clock;globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PAID_REQUEST');};
 t.after(()=>{Date.now=realNow;globalThis.fetch=originalFetch;});
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);
 env.MODEL_LEDGER.prepare=sql=>{
  if(!jumped&&sql.startsWith('SELECT * FROM model_budget_openings')){jumped=true;clock+=60_000;}
  return prepare(sql);
 };
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','expired-preflight',request,()=>{},clock+30_000),/OPERATION_DEADLINE/);
 assert.equal(jumped,true,'the test advanced time after model preflight began');
 assert.equal(requests,0,'no paid provider request may escape after the deadline');
 assert.equal(shared.db.prepare('SELECT COUNT(*) AS n FROM model_budget_reservations').get().n,0);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,0);
});
test('a deadline expiring during local admission settles both unused model reservations',async t=>{
 const{env,local,shared}=await fixture(t),realNow=Date.now,originalFetch=globalThis.fetch;
 let clock=realNow(),jumped=false,requests=0;
 Date.now=()=>clock;globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PAID_REQUEST');};
 t.after(()=>{Date.now=realNow;globalThis.fetch=originalFetch;});
 const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{
  if(!jumped&&sql.startsWith('SELECT operation_id,request_hash,kind,stage,reserved_micros')){jumped=true;clock+=60_000;}
  return prepare(sql);
 };
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','expired-admission',request,()=>{},clock+30_000),/OPERATION_DEADLINE/);
 assert.equal(jumped,true);assert.equal(requests,0);
 assert.equal(shared.db.prepare('SELECT COUNT(*) AS n FROM model_budget_reservations').get().n,1);
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,0);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
});
for(const cleanupUnavailable of [false,true])test(`committed local admission with a lost response releases known-unsent cost${cleanupUnavailable?' after cleanup recovery':''}`,async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0,loseAck=true,loseCleanup=cleanupUnavailable;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{
  if(sql.startsWith('SELECT operation_id,request_hash,kind,catalog_version')&&loseCleanup){loseCleanup=false;throw Error('LOCAL_CLEANUP_UNAVAILABLE');}
  const statement=prepare(sql);
  if(!sql.startsWith('INSERT OR IGNORE INTO cost_reservations'))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
   const result=await bound.run();if(loseAck){loseAck=false;throw Error('LOCAL_ADMISSION_ACK_LOST');}return result;
  }};}};
 };
 const request={system:'Offline lost admission acknowledgement.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 const check=value=>assert.equal(value.ok,true);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','lost-admission-ack',request,check),/LOCAL_ADMISSION_ACK_LOST|LOCAL_CLEANUP_UNAVAILABLE/);
 assert.equal(requests,0);assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
 if(cleanupUnavailable){
  assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
  await assert.rejects(modelStep(env,'model-operation',0,'facts','lost-admission-ack',request,check),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 }
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('after-unsent','workspace','project',0,'calibration','active','after-unsent',10000000,Date.now(),null,null);
 await modelStep(env,'after-unsent',0,'facts','after-unsent-call',request,check);
 assert.equal(requests,1,'proven unsent local cost cannot permanently block a later authorized request');
});

test('terminal reconciliation finishes a known-unsent local admission after failed cleanup without replaying the provider',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;
 let lostAck=true,lostCleanup=true,requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],
  usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{
  if(sql.startsWith('SELECT operation_id,request_hash,kind,catalog_version')&&lostCleanup){lostCleanup=false;throw Error('LOCAL_CLEANUP_UNAVAILABLE');}
  const statement=prepare(sql);
  if(!sql.startsWith('INSERT OR IGNORE INTO cost_reservations'))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
   const result=await bound.run();if(lostAck){lostAck=false;throw Error('LOCAL_ADMISSION_ACK_LOST');}return result;
  }};}};
 };
 const request={system:'Never dispatched due to a lost acknowledgement.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 const validate=value=>assert.equal(value.ok,true);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','terminal-unsent-call',request,validate),/LOCAL_CLEANUP_UNAVAILABLE/);
 assert.equal(requests,0);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 local.db.prepare("UPDATE pipeline_operations SET status='failed' WHERE id='model-operation'").run();
 await assert.rejects(modelStep(env,'model-operation',0,'facts','terminal-unsent-call',request,validate),/OPERATION_FENCED/);
 const cleaned=await reconcileOperation(env,'model-operation');
 assert.deepEqual(cleaned.pendingCosts,[]);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
 await reconcileOperation(env,'model-operation');
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,1,'cleanup is idempotent');
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-after-terminal','workspace','project',0,'calibration','active','new-request',10000000,Date.now(),null,null);
 const later=await modelStep(env,'new-after-terminal',0,'facts','new-after-terminal-call',request,validate);
 assert.equal(later.cached,false);assert.equal(requests,1);
});
test('an expired dispatch-marker response cannot start a late paid model request',async t=>{
 const{env,local,shared}=await fixture(t),realNow=Date.now,originalFetch=globalThis.fetch;
 let clock=realNow(),jumped=false,requests=0;
 Date.now=()=>clock;globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PAID_REQUEST');};
 t.after(()=>{Date.now=realNow;globalThis.fetch=originalFetch;});
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);
 env.MODEL_LEDGER.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.startsWith('UPDATE model_budget_reservations SET dispatched_at='))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
    const result=await bound.run();jumped=true;clock+=60_000;return result;
  }};}};
 };
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','late-dispatch-marker',request,()=>{},clock+30_000),/OPERATION_DEADLINE/);
 assert.equal(jumped,true,'the marker committed before its response advanced the clock');
 assert.equal(requests,0,'an expired paid call must not leave the control plane');
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,0);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
});
test('cancellation during dispatch bookkeeping cannot launch an already-fenced model request',async t=>{
 const{env,local,shared}=await fixture(t),originalFetch=globalThis.fetch;
 let cancelled=false,requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PAID_REQUEST');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);
 env.MODEL_LEDGER.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.startsWith('UPDATE model_budget_reservations SET dispatched_at='))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
    const result=await bound.run();cancelled=true;
    local.db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1 WHERE id='model-operation'").run();
    return result;
  }};}};
 };
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await modelStep(env,'model-operation',0,'facts','cancelled-during-dispatch',request,()=>{},Date.now()+30_000).catch(()=>{});
 assert.equal(cancelled,true);
 assert.equal(requests,0,'a known cancelled generation must never start a paid transport');
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,0);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
});
test('an owner authorization expiring after reservation cannot dispatch a paid model request',async t=>{
 const{env,shared,local}=await fixture(t),realNow=Date.now,originalFetch=globalThis.fetch;
 let clock=Date.parse('2026-12-31T23:59:58+08:00'),marked=false,requests=0;
 Date.now=()=>clock;globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PAID_REQUEST');};
 t.after(()=>{Date.now=realNow;globalThis.fetch=originalFetch;});
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);
 env.MODEL_LEDGER.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.startsWith('UPDATE model_budget_reservations SET dispatched_at='))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
    const result=await bound.run();marked=true;clock+=5_000;return result;
  }};}};
 };
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 const error=await modelStep(env,'model-operation',0,'facts','authorization-expired-after-mark',request,()=>{},clock+30_000).then(()=>null,cause=>cause);
 assert.equal(marked,true);
 assert.equal(error?.message,'MODEL_NOT_AUTHORIZED');
 assert.equal(requests,0);
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,0);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
});
test('a proven unsent settlement must not prevent a different operation from making its first paid request',async t=>{
 const{env,local,shared}=await fixture(t),originalFetch=globalThis.fetch;
 let marked=false,failedOnce=false,requests=0;
 const prepareLedger=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER),prepareLocal=env.DB.prepare.bind(env.DB);
 env.MODEL_LEDGER.prepare=sql=>{
  const statement=prepareLedger(sql);
  if(!sql.startsWith('UPDATE model_budget_reservations SET dispatched_at='))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
   const result=await bound.run();marked=true;return result;
  }};}};
 };
 env.DB.prepare=sql=>{
  if(sql.startsWith('SELECT * FROM pipeline_operations')&&marked&&!failedOnce){failedOnce=true;throw Error('Network connection lost.');}
  return prepareLocal(sql);
 };
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"value":"fresh"}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','unsent-original',request,()=>{}),/Network connection lost/);
 assert.equal(marked,true);assert.equal(failedOnce,true);assert.equal(requests,0);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,0);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-model-operation','workspace','project',0,'calibration','active','new-request',10000000,Date.now(),null,null);
 const result=await modelStep(env,'new-model-operation',0,'facts','fresh-call',request,value=>assert.equal(value.value,'fresh'));
 assert.equal(result.value.value,'fresh');assert.equal(requests,1);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
});
test('a parallel-stage failure during shared dispatch bookkeeping fences transport and releases known-unsent cost',async t=>{
 const{env,local,shared}=await fixture(t),originalFetch=globalThis.fetch;
 let allowed=true,requests=0,marked=false;
 globalThis.fetch=async()=>{requests++;throw Error('UNEXPECTED_PAID_REQUEST');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const prepare=env.MODEL_LEDGER.prepare.bind(env.MODEL_LEDGER);
 env.MODEL_LEDGER.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.startsWith('UPDATE model_budget_reservations SET dispatched_at='))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async run(){
   const result=await bound.run();marked=true;allowed=false;return result;
  }};}};
 };
 const request={system:'Offline parallel stage.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,'facts','stage-fenced',request,()=>{},Date.now()+30_000,
  {dispatchGuard:()=>{if(!allowed)throw Error('DIRECTOR_STAGE_ABORTED');}}),/DIRECTOR_STAGE_ABORTED/);
 assert.equal(marked,true);assert.equal(requests,0);
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
 assert.equal(shared.db.prepare('SELECT actual_micros FROM model_budget_settlements').get().actual_micros,0);
});
test('a genuine zero-price completed request still requires its immutable provider receipt',async t=>{
 const{env,local,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"value":"zero"}'},finish_reason:'stop'}],usage:{prompt_tokens:0,completion_tokens:0}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline zero-cost fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64};
 await modelStep(env,'model-operation',0,'facts','zero-cost-original',request,()=>{});
 assert.equal(local.db.prepare('SELECT actual_micros FROM cost_settlements').get().actual_micros,0);
 const receiptKey=[...objects.keys()].find(key=>key.includes('/model-calls/')&&key.endsWith('.json'));
 assert.ok(receiptKey);objects.delete(receiptKey);
 local.db.prepare('DELETE FROM model_responses').run();
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('zero-cost-next','workspace','project',0,'calibration','active','new-request',10000000,Date.now(),null,null);
 await assert.rejects(modelStep(env,'zero-cost-next',0,'facts','zero-cost-next-call',request,()=>{}),/MODEL_RECEIPT_UNAVAILABLE/);
 assert.equal(requests,1,'a known completed call with a missing receipt is not silently sent again');
});
for(const mode of ['stream','http'])test(`native author ${mode} 502 preserves unknown cost and never dispatches a fallback`,async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;if(mode==='http')return new Response('bad gateway',{status:502});
  return new Response('data: '+canonical({error:{type:'service_error',code:502}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Native author fixture.',messages:[{role:'user',text:'Write the native project.'}],maxOutputTokens:64,tools:[{name:'write_project',description:'Write native source',parameters:{type:'object'}}]};
 await assert.rejects(modelStep(env,'model-operation',0,'author','author-502',request,()=>{}),/MODEL_REQUEST_FAILED|MODEL_CALL_RECONCILIATION_REQUIRED/);
 await assert.rejects(modelStep(env,'model-operation',0,'author','author-502',request,()=>{}),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,1);assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations WHERE stage=?').get('author').n,1);
});
for(const stage of ['facts','author'])test(`another operation cannot resend an identical unresolved ${stage} request`,async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('Network connection lost.');};t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline native fixture.',messages:[{role:'user',text:'Return native work.'}],maxOutputTokens:64};
 await assert.rejects(modelStep(env,'model-operation',0,stage,'old-call',request,()=>{}),/MODEL_TRANSPORT_FAILED/);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 await assert.rejects(modelStep(env,'new-operation',0,stage,'new-call',request,()=>{}),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,1);assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
});
test('concurrent identical native author requests are admitted at most once',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('Network connection lost.');};t.after(()=>{globalThis.fetch=originalFetch;});
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 const request={system:'Offline native fixture.',messages:[{role:'user',text:'Create a project.'}],maxOutputTokens:64};
 const results=await Promise.allSettled([modelStep(env,'model-operation',0,'author','parallel-a',request,()=>{}),modelStep(env,'new-operation',0,'author','parallel-b',request,()=>{})]);
 assert.equal(requests,1);assert.equal(results.filter(result=>result.status==='rejected').length,2);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
});
test('a matching request that settles during concurrent admission cannot be purchased twice',async t=>{
 const{env,local,shared}=await fixture(t),originalFetch=globalThis.fetch;let requests=0,releaseAdmission;
 const firstFinished=new Promise(resolve=>{releaseAdmission=resolve;});
 globalThis.fetch=async()=>{requests++;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{releaseAdmission();globalThis.fetch=originalFetch;});
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('concurrent-operation','workspace','project',0,'calibration','active','concurrent',10000000,Date.now(),null,null);
 const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.startsWith('SELECT operation_id,request_hash,kind,stage,reserved_micros'))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async first(){
   if(args[0]==='concurrent-call')await firstFinished;
   return bound.first();
  }};}};
 };
 const request={system:'Offline concurrent admission.',messages:[{role:'user',text:'Return one paid observation.'}],maxOutputTokens:64};
 const check=value=>assert.equal(value.ok,true);
 const first=modelStep(env,'model-operation',0,'facts','first-call',request,check).finally(releaseAdmission);
 const second=modelStep(env,'concurrent-operation',0,'facts','concurrent-call',request,check);
 const outcomes=await Promise.allSettled([first,second]);
 assert.equal(outcomes[0].status,'fulfilled');
 assert.equal(outcomes[1].status,'rejected');assert.equal(outcomes[1].reason.message,'MODEL_CALL_RECONCILIATION_REQUIRED');
 assert.equal(requests,1,'settlement between preflight and atomic admission cannot authorize another paid dispatch');
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
 assert.equal(shared.db.prepare('SELECT COUNT(*) AS n FROM model_budget_settlements WHERE actual_micros=0').get().n,1);
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,0);
 assert.equal((await modelStep(env,'concurrent-operation',0,'facts','concurrent-call',request,check)).cached,true);
 assert.equal(requests,1,'retry recovers the now-complete response without another paid request');
});
test('gateway cache writes reserve their worst price and retain unknown-TTL usage without settling',async t=>{
 const{env,local,objects}=await fixture(t),originalFetch=globalThis.fetch;let requests=0,reserved=0;
 globalThis.fetch=async()=>{
  requests++;reserved=(await budget.modelBudgetStatus(env)).pending[0].reserved_micros;
  return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],
   usage:{prompt_tokens:108543,completion_tokens:100,prompt_tokens_details:{cached_tokens:0,cache_creation_tokens:105256}}})+'\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline cache-write metering.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:128};
 const result=await modelStep(env,'model-operation',0,'treatment','cache-write-ttl-unknown',request,value=>assert.equal(value.ok,true));
 assert.equal(result.value.ok,true);assert.equal(requests,1);
 const minimum=modelCallCostMicros(providers.steps.treatment,{prompt_tokens:131072},providers,{maxOutputTokens:128});
 assert.equal(minimum.estimated,true);assert.ok(reserved>=minimum.usdMicros);
 const receipt=parseCanonicalJson([...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'))[1].bytes);
 assert.equal(receipt.quote,null,'a gateway cache-write counter without TTL cannot establish a settled charge');
 assert.equal((await budget.modelBudgetStatus(env)).pending.length,1);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM model_responses').get().n,0);
});
test('a pending matching call cannot disappear between the completed and pending preflight queries',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0,releaseProvider,markStarted,finishFirst;
 const held=new Promise(resolve=>{releaseProvider=resolve;}),started=new Promise(resolve=>{markStarted=resolve;}),
  firstFinished=new Promise(resolve=>{finishFirst=resolve;});
 globalThis.fetch=async()=>{
  requests++;markStarted();await held;
  return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{releaseProvider();globalThis.fetch=originalFetch;});
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('late-operation','workspace','project',0,'calibration','active','late',10000000,Date.now(),null,null);
 const request={system:'Offline preflight settlement race.',messages:[{role:'user',text:'Return one observation.'}],maxOutputTokens:64};
 const check=value=>assert.equal(value.ok,true);
 const first=modelStep(env,'model-operation',0,'facts','pending-first',request,check).finally(finishFirst);
 await started;
 const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{
  const statement=prepare(sql);
  if(!sql.startsWith('SELECT r.id,r.operation_id,s.actual_micros'))return statement;
  return{bind(...args){const bound=statement.bind(...args);return{async all(){
   const rows=await bound.all();releaseProvider();await firstFinished;return rows;
  }};}};
 };
 const second=await modelStep(env,'late-operation',0,'facts','late-call',request,check).then(()=>null,error=>error);
 releaseProvider();await first;
 assert.equal(second?.message,'MODEL_CALL_RECONCILIATION_REQUIRED');
 assert.equal(requests,1,'a preflight snapshot must not lose a matching reservation that settles while queries run');
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_reservations').get().n,1);
});
test('gateway Opus reserves the observed hidden-input risk before dispatch without raising the treatment stage cap',async t=>{
 const{env}=await fixture(t),originalFetch=globalThis.fetch;let reserved=0;
 globalThis.fetch=async()=>{reserved=(await budget.modelBudgetStatus(env)).pending[0].reserved_micros;return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 await modelStep(env,'model-operation',0,'treatment','hidden-input-call',{system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},value=>assert.equal(value.ok,true));
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
 await assert.rejects(modelStep(env,'new-operation',0,'facts','new-call',request,validate),/MODEL_CALL_RECONCILIATION_REQUIRED/);assert.equal(requests,1);
 const after=await budget.modelBudgetStatus(env);assert.deepEqual(after.pending,before.pending);
});
test('settled response cache re-admits an identical request without new spending',async t=>{
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
test('settled treatment and native author tool responses can be reused in the same scope',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async(_url,init)=>{requests++;const body=JSON.parse(init.body),delta=body.tools
  ?{tool_calls:[{index:0,id:'edit',function:{name:'write_project',arguments:canonical({command:'create',path:'index.html',content:'layout fixture'})}}]}
  :{content:canonical({treatment:{title:'treatment fixture'}})};
  return new Response('data: '+canonical({choices:[{delta,finish_reason:body.tools?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const treatment={system:'Offline treatment.',messages:[{role:'user',text:'Write a treatment.'}],maxOutputTokens:64};
 const layout={system:'Offline layout.',messages:[{role:'user',text:'Create the layout.'}],maxOutputTokens:64,tools:[{name:'write_project',description:'Write native HTML.',parameters:{type:'object'}}]};
 const checkSpec=value=>assert.equal(value.treatment.title,'treatment fixture'),checkLayout=value=>assert.equal(value.toolCalls[0].input.path,'index.html');
 await modelStep(env,'model-operation',0,'treatment','treatment-call',treatment,checkSpec);
 await modelStep(env,'model-operation',0,'author','layout-call',layout,checkLayout,Date.now()+60000);
 const before=await budget.modelBudgetStatus(env);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 assert.equal((await modelStep(env,'new-operation',0,'treatment','new-treatment',treatment,checkSpec)).cached,true);
 assert.equal((await modelStep(env,'new-operation',0,'author','new-layout',layout,checkLayout,Date.now()+60000)).cached,true);
 assert.equal(requests,2);assert.equal((await budget.modelBudgetStatus(env)).currentChargedMicros,before.currentChargedMicros);
});
test('a completed author response missing authoritative copy is charged but never cached as successful',async t=>{
 const{env,local}=await fixture(t),oldFetch=globalThis.fetch;let requests=0;
 const script={segments:[{role:'title',displayText:'The real promise'}]};
 globalThis.fetch=async()=>{
  requests++;
  const html=requests===1?'<h1>Wrong headline</h1>':'<h1>The real promise</h1>';
  const response={choices:[{delta:{tool_calls:[{index:0,id:'author',function:{name:'write_project',
   arguments:canonical({files:[{path:'index.html',content:html}]})}}]},finish_reason:'tool_calls'}],
   usage:{prompt_tokens:100,completion_tokens:10}};
  return new Response('data: '+canonical(response)+'\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{globalThis.fetch=oldFetch;});
 const request={system:'Offline native author.',messages:[{role:'user',text:'Create a final film.'}],
  maxOutputTokens:128,tools:[{name:'write_project',description:'Create native source.',parameters:{type:'object'}}]};
 const validate=value=>assertScriptProjection(value.toolCalls[0].input.files,script);
 await assert.rejects(modelStep(env,'model-operation',0,'author','incomplete-author',request,validate),
  /SCRIPT_SOURCE_PROJECTION_MISSING/);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM model_responses').get().n,0);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,1);
 const corrected={...request,messages:[...request.messages,{role:'user',text:'Correct the missing authoritative copy.'}]};
 const result=await modelStep(env,'model-operation',0,'author','corrected-author',corrected,validate);
 assert.equal(result.cached,false);
 assert.equal(requests,2);
 assert.equal(local.db.prepare('SELECT COUNT(*) AS n FROM model_responses').get().n,1);
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
test('a later unrelated cache entry cannot replace an earlier call whose outcome is unknown',async t=>{
 const{env,local}=await fixture(t),originalFetch=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;if(requests===1)throw Error('Network connection lost.');
  return new Response('data: '+canonical({choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:10}})+'\n\ndata: [DONE]\n\n');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 const request={system:'Offline fixture.',messages:[{role:'user',text:'Return JSON.'}],maxOutputTokens:64},validate=value=>assert.equal(value.ok,true);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','unknown-call',request,validate),/MODEL_TRANSPORT_FAILED/);
 local.db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('new-operation','workspace','project',0,'calibration','active','new',10000000,Date.now(),null,null);
 await modelStep(env,'new-operation',0,'facts','new-call',{...request,messages:[{role:'user',text:'Different authorized request.'}]},validate);assert.equal(requests,2);
 const requestHash=local.db.prepare('SELECT request_hash FROM cost_reservations WHERE id=?').get('unknown-call').request_hash;
 const cacheKey=digest({kind:'model-response-cache-v2',requestHash,workspaceId:'workspace',projectId:'project',purpose:'calibration'});
 local.db.prepare('UPDATE model_responses SET cache_key=?').run(cacheKey);
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
 const receipt=parseCanonicalJson([...objects].find(([key])=>key.includes('/model-calls/')&&key.endsWith('.json'))[1].bytes);
 assert.equal(receipt.result.failure,'MODEL_TOOL_JSON_INVALID');assert.equal(receipt.result.toolCalls[0].arguments,'{"note":"unfinished');assert.ok(receipt.quote.usdMicros>0);
 await assert.rejects(modelStep(env,'model-operation',0,'facts','malformed-unknown',{...request,messages:[{role:'user',text:'Unknown complete tool fixture.'}]},()=>assert.fail('invalid tool cannot reach validator')),/MODEL_CALL_RECONCILIATION_REQUIRED/);
 assert.equal(requests,2);const after=await budget.modelBudgetStatus(env);assert.equal(after.pending.length,1);assert.ok(after.pending[0].reserved_micros>0);
});
