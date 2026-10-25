import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {inRenderPhase,renderFailureDiagnostic} from '../src/failure.mjs';

test('failure evidence retains the innermost trusted stage and typed cause without exposing arbitrary messages',async()=>{
 const secret='fixture-sensitive-text-not-for-diagnostics',error=Object.assign(new TypeError('fetch failed '+secret),{cause:{code:'ECONNRESET',message:secret}});let calls=0;
 await assert.rejects(inRenderPhase({phase:'output_upload',extra:secret},()=>inRenderPhase({phase:'frame_capture',frame:44,extra:secret},()=>{calls++;throw error;})),value=>value===error);
 assert.equal(calls,1);assert.deepEqual(renderFailureDiagnostic(error),{phase:'frame_capture',type:'TypeError',frame:44,systemCode:'ECONNRESET'});
 assert.equal(JSON.stringify(renderFailureDiagnostic(error)).includes(secret),false);
 const media=Object.assign(Error('MEDIA_PROCESS_FAILED '+secret),{command:'ffmpeg',code:1,signal:null,diagnostic:'Failed to configure output pad; Resource temporarily unavailable '+secret});
 assert.deepEqual(renderFailureDiagnostic(media).media,{command:'ffmpeg',exitCode:1,signal:null,signatures:['resource_unavailable','filter_configuration']});
 assert.equal(JSON.stringify(renderFailureDiagnostic(media)).includes(secret),false);
 const runtime=Object.assign(Error('page.evaluate: Error: TEXT_FIT_FAILED:'+secret),{renderPhase:{phase:'runtime_init',frame:9999}});
 assert.deepEqual(renderFailureDiagnostic(runtime),{phase:'runtime_init',type:'Error',runtimeCode:'TEXT_FIT_FAILED'});
 const unknown=Object.assign(Error(secret),{renderPhase:{phase:secret,frame:-1},code:secret,command:secret,diagnostic:secret});
 assert.deepEqual(renderFailureDiagnostic(unknown),{phase:null,type:'Error'});
 const closed=Error('page.waitForFunction: Target page, context or browser has been closed '+secret);
 assert.deepEqual(renderFailureDiagnostic(closed),{phase:null,type:'Error',signatures:['page_closed']});
 assert.equal(JSON.stringify(renderFailureDiagnostic(closed)).includes(secret),false);
 assert.deepEqual(renderFailureDiagnostic(Error('The source image cannot be decoded. '+secret)),{phase:null,type:'Error',signatures:['image_decode_failed']});
 const foreign=runInNewContext('new TypeError("fixture is not a function")');assert.equal(foreign instanceof Error,false);
 await assert.rejects(inRenderPhase({phase:'runtime_ready'},()=>{throw foreign;}),error=>error===foreign);
 assert.deepEqual(renderFailureDiagnostic(foreign),{phase:'runtime_ready',type:'TypeError',signatures:['not_callable']});
});
