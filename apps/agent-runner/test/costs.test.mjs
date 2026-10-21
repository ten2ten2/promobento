import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {usageCost,createCostLedger,latestCosts} from '../src/costs.mjs';
import {withStore} from '../src/store.mjs';
import {assertConfig,assertProject,assertPlan} from '../src/schema.mjs';
import {config,project,plan} from './fixtures.mjs';

function temp(t){const path=mkdtempSync(join(tmpdir(),'agent-cost-'));t.after(()=>rmSync(path,{recursive:true,force:true}));return path;}
test('local research configuration requires explicit unexpired authorization and consistent hard caps',()=>{
  assertConfig(config());assertProject(project());
  const expired=config();expired.authorization.expiresAt='2020-01-01T00:00:00Z';assert.throws(()=>assertConfig(expired),/AUTHORIZATION/);
  const unlimited=config();unlimited.budgets.operationMicros=null;assert.throws(()=>assertConfig(unlimited),/CONFIG_INVALID/);
  const missing=project();delete missing.facts[0].confirmedBy;assert.throws(()=>assertProject(missing),/PROJECT_INVALID/);
  for(const field of ['inputMicrosPerMillion','outputMicrosPerMillion']){const c=config();c.prices[field]=0;assert.throws(()=>assertConfig(c),/CONFIG_INVALID/);}
  const future=project();future.facts[0].confirmedAt='2099-01-01T00:00:00Z';assert.throws(()=>assertProject(future),/CONFIRMATION_IN_FUTURE/);
  future.facts[0].confirmedAt='2020-01-01T00:00:00Z';future.rights=[{resourceId:'screen-still',evidenceRef:'test',confirmedBy:'test',confirmedAt:'2099-01-01T00:00:00Z'}];
  assert.throws(()=>assertProject(future),/CONFIRMATION_IN_FUTURE/);
});
test('plan interpretation and impact use required ready-candidate production text semantics',()=>{
  assertPlan(plan(),450);
  for(const field of ['agentInterpretation','impactSummary'])for(const value of [undefined,null,'',{},42]){
    const p=plan();if(value===undefined)delete p[field];else p[field]=value;
    assert.throws(()=>assertPlan(p,450),/INVALID/);
  }
});
test('usage cost bills cached input once and rounds integer micros upward',()=>{
  assert.equal(usageCost({inputTokens:100,outputTokens:20,cachedInputTokens:40},config().prices),120);
  assert.equal(usageCost({inputTokens:1,outputTokens:0},{inputMicrosPerMillion:1,cachedInputMicrosPerMillion:0,outputMicrosPerMillion:0}),1);
  assert.throws(()=>usageCost({inputTokens:1,outputTokens:0,cachedInputTokens:2},config().prices),/USAGE_INVALID/);
});
test('reservation replacement is not summed twice; retries and new operations retain cumulative spend',async t=>{
  await withStore(temp(t),store=>{
    const c=config();c.budgets.projectMicros=100000;c.budgets.userMicros=100000;
    const ledger=createCostLedger(store,c,project(),'op-1','attempt-1');
    const reservation=ledger.reserve({usdMicros:80000,provider:'mock'});assert.equal(ledger.total(),80000);
    ledger.settle(reservation,{usdMicros:60000,usage:[]});assert.equal(ledger.total(),60000);
    const retry=createCostLedger(store,c,project(),'op-1','attempt-2');assert.throws(()=>retry.reserve({usdMicros:50000,provider:'mock'}),/BUDGET_EXHAUSTED/);
    const next=createCostLedger(store,c,project(),'op-2','attempt-1');assert.throws(()=>next.reserve({usdMicros:50000,provider:'mock'}),/BUDGET_EXHAUSTED/);
    assert.equal(latestCosts(ledger.events()).length,1);
    assert.throws(()=>ledger.settle(reservation,{usdMicros:1,usage:[]}),/CHAIN_INVALID/);
  });
});
test('local store keeps a single owner across asynchronous work',async t=>{
  const directory=temp(t);
  await withStore(directory,async()=>assert.rejects(withStore(directory,()=>{}),/STORE_BUSY/));
  await withStore(directory,()=>{});
});
