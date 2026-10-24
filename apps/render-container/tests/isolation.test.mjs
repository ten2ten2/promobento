import test from 'node:test';
import assert from 'node:assert/strict';
import {collectIsolation} from '../src/isolation.mjs';

test('fixed isolation probes retain the failed phase, continue independent checks and redact the ephemeral token',async()=>{
 const token='fixture-run-token-not-secret',calls=[],sandbox={chromiumUid:10002};
 const report=await collectIsolation({token,sandbox,probes:{
  page:async()=>{calls.push('page');throw new TypeError('fixture failure Bearer '+token+' '+'.'.repeat(600));},
  host:async()=>{calls.push('host');return{passed:true,broker:{missingToken:403}};},
  uid:async()=>{calls.push('uid');return{passed:true,uid:10002};}
 }});
 assert.deepEqual(calls,['page','host','uid']);assert.equal(report.passed,false);assert.equal(report.sandbox,sandbox);
 assert.equal(report.page.passed,false);assert.equal(report.page.error.name,'TypeError');assert.equal(report.page.error.code,'UNKNOWN');
 assert.equal(report.page.error.message.length,500);assert.ok(report.page.error.message.includes('Bearer [redacted]'));
 assert.equal(JSON.stringify(report).includes(token),false);assert.equal(report.page.error.stack,undefined);
 assert.equal(report.host.passed,true);assert.equal(report.uid.passed,true);
});
