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
