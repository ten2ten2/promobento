import test from 'node:test';
import assert from 'node:assert/strict';
import {collectIsolation,inspectChromiumEnvironment} from '../src/isolation.mjs';
import {sha256Bytes} from '@promobento/contracts/digest';

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

test('uid token scan finds bearer bytes even in overwritten proc records without transferring or reporting them',()=>{
 const token='fixture-run-token-not-secret',scope={fingerprint:sha256Bytes(Buffer.from(token)),tokenByteLength:Buffer.byteLength(token)};
 const browser=inspectChromiumEnvironment(Buffer.from('PATH=/usr/bin\0HOME=/chrome\0LANG=C.UTF-8\0FONTCONFIG_FILE=/fonts\0'),{...scope,browser:true});
 assert.equal(browser.onlyWhitelistedKeys,true);assert.equal(browser.tokenFound,false);assert.equal(browser.unexpectedEntryCount,0);
 const child=inspectChromiumEnvironment(Buffer.from('--headless\0 --force-color-profile=srgb\0'),{...scope,browser:false});
 assert.equal(child.tokenFound,false);assert.equal(child.environmentKeys,undefined);
 const leaked=inspectChromiumEnvironment(Buffer.from('overwritten argv fragment '+token+'\0'),{...scope,browser:false});
 assert.equal(leaked.tokenFound,true);assert.equal(JSON.stringify(leaked).includes(token),false);
 assert.equal(JSON.stringify(leaked).includes(scope.fingerprint),false);
});
