import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {waitForRuntimeReady} from '../src/readiness.mjs';

test('controller readiness polling respects boot failure, cancellation, read errors and its original deadline',async()=>{
 let reads=0;await waitForRuntimeReady({timeoutMs:100,read:async()=>({ready:++reads===2})});assert.equal(reads,2);
 await assert.rejects(waitForRuntimeReady({timeoutMs:100,read:async()=>({ready:true,failure:'TEXT_FIT_FAILED:fixture'})}),/TEXT_FIT_FAILED/);
 await assert.rejects(waitForRuntimeReady({timeoutMs:100,read:async()=>({ready:true}),pageError:()=> 'RENDER_PAGE_CRASHED'}),/RENDER_PAGE_CRASHED/);
 await assert.rejects(waitForRuntimeReady({timeoutMs:5,read:async()=>({ready:false})}),/INIT_TIMEOUT/);
 await assert.rejects(waitForRuntimeReady({timeoutMs:2,read:async()=>{await new Promise(r=>setTimeout(r,5));return{ready:true};}}),/INIT_TIMEOUT/);
 const error=Error('FIXTURE_READ_FAILED');await assert.rejects(waitForRuntimeReady({timeoutMs:100,read:async()=>{throw error;}}),e=>e===error);
 await assert.rejects(waitForRuntimeReady({timeoutMs:100,read:async()=>({ready:false,failure:'The source image cannot be decoded.'}),pageError:()=>error}),e=>e===error);
 const foreign=runInNewContext('new Error("fixture source read")');
 await assert.rejects(waitForRuntimeReady({timeoutMs:100,read:async()=>({ready:true}),pageError:()=>foreign}),e=>e===foreign);
 const controller=new AbortController();controller.abort(error);let used=false;
 await assert.rejects(waitForRuntimeReady({timeoutMs:100,signal:controller.signal,read:async()=>{used=true;return{ready:true};}}),e=>e===error);assert.equal(used,false);
});
