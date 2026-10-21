import test from 'node:test';
import assert from 'node:assert/strict';
import {captureFrame,withDeadline} from '../src/frame-capture.mjs';

test('the frame deadline includes a draw that never resolves and awaits termination',async()=>{
  let terminated=false,screenshotCalled=false;
  const page={evaluate:()=>new Promise(()=>{}),screenshot:()=>{screenshotCalled=true;}};
  await assert.rejects(captureFrame(page,17,{timeoutMs:20,terminate:async()=>{terminated=true;}}),/FRAME_TIMEOUT: 17/);
  assert(terminated);
  assert.equal(screenshotCalled,false);
});

test('the same frame deadline also covers stalled pixel readback',async()=>{
  let terminated=false;
  const page={evaluate:async()=>({frameIndex:3}),screenshot:()=>new Promise(()=>{})};
  await assert.rejects(captureFrame(page,3,{timeoutMs:20,terminate:async()=>{terminated=true;}}),/FRAME_TIMEOUT: 3/);
  assert(terminated);
});

test('capture leaves animation state untouched and does not terminate a completed frame',async()=>{
  const expected=Buffer.from('frame');let options;
  const page={evaluate:async()=>({frameIndex:8}),screenshot:async value=>{options=value;return expected;}};
  assert.equal(await captureFrame(page,8,{timeoutMs:100,terminate:()=>assert.fail('Unexpected termination')}),expected);
  assert.equal(options.animations,'allow');
  await assert.rejects(withDeadline(()=>Promise.reject(new Error('DRAW_FAILED')),{timeoutMs:100,code:'TIMEOUT',
    terminate:()=>assert.fail('Unexpected termination')}),/DRAW_FAILED/);
});

test('local capture rejects a stale applied epoch before reading pixels',async()=>{
  let captured=false;
  const page={evaluate:async()=>({frameIndex:8,previewEpoch:2}),screenshot:async()=>{captured=true;}};
  await assert.rejects(captureFrame(page,8,{previewEpoch:3,timeoutMs:100,terminate:()=>{}}),/stale local epoch/);
  assert.equal(captured,false);
});
