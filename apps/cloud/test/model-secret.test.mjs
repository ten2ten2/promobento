import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '@promobento/contracts/canonical';
import {bindModelSecret} from '../scripts/bind-model-secret.mjs';

test('staging key maintenance uses stdin once, refuses active work, preserves existing keys and rolls back only its own addition',async()=>{
 const fixture=({existing=false,session=false,busy=false,pending=false,writeUnknown=false,badHealth=false}={})=>{
  let configured=existing,healthCalls=0;const calls=[],report={status:'checking'};
  const run=(args,input)=>{
   calls.push({args,input});assert.ok(!args.includes('fixture-only-value'));
   if(args[0]==='secret'&&args[1]==='list')return canonical([...(configured?[{name:'MODEL_COMPAT_API_KEY'}]:[]),...(session?[{name:'EVAL_API_KEY'}]:[])]);
   if(args[0]==='d1')return canonical([{success:true,results:[{unfinished:busy?1:0,unsettled_compute:pending?1:0}]}]);
   assert.equal(args[2],'MODEL_COMPAT_API_KEY');assert.deepEqual(args.slice(-2),['--env','staging']);
   if(args[1]==='put'){assert.equal(input,'fixture-only-value');configured=true;if(writeUnknown)throw Error('SYNTHETIC_UNKNOWN_WRITE');}
   else if(args[1]==='delete'){assert.equal(input,undefined);configured=false;}
   else throw Error('UNEXPECTED_COMMAND');return'';
  };
  const health=async()=>!(badHealth&&++healthCalls===2);
  return{run,health,secret:'fixture-only-value',report,calls};
 };
 const good=fixture();await bindModelSecret(good);assert.equal(good.report.status,'bound');assert.equal(good.report.configuredAfter,true);
 assert.equal(good.calls.filter(call=>call.args[1]==='put').length,1);assert.equal(good.calls.filter(call=>call.args[1]==='delete').length,0);
 const old=fixture({existing:true});await bindModelSecret(old);assert.equal(old.report.status,'retained_existing_binding');assert.equal(old.calls.length,1);
 for(const [options,code]of [[{session:true},'ANOTHER_INTERNAL_SESSION_ACTIVE'],[{busy:true},'STAGING_MODEL_BIND_REQUIRES_IDLE'],[{pending:true},'STAGING_MODEL_BIND_REQUIRES_IDLE']]){
  const blocked=fixture(options);await assert.rejects(bindModelSecret(blocked),new RegExp(code));assert.ok(blocked.calls.every(call=>!['put','delete'].includes(call.args[1])));
 }
 const unknown=fixture({writeUnknown:true});await assert.rejects(bindModelSecret(unknown),/MODEL_SECRET_BIND_UNCONFIRMED/);assert.equal(unknown.calls.filter(call=>call.args[1]==='put').length,1);assert.ok(unknown.calls.every(call=>call.args[1]!=='delete'));
 const rollback=fixture({badHealth:true});await assert.rejects(bindModelSecret(rollback),/STAGING_HEALTH_FAILED_AFTER_BIND/);assert.equal(rollback.report.status,'rolled_back_new_binding');assert.equal(rollback.report.configuredAfter,false);assert.equal(rollback.report.rollbackHealthy,true);
});
