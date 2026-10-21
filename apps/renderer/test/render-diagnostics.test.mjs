import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderDiagnostics,inspectExecutionResources} from '../src/render-diagnostics.mjs';
import {resourceWaitWithinDraw} from '../../../packages/composition-runtime/src/diagnostics.mjs';

test('parallel resource waits are clipped to the draw and counted once',()=>{
  assert.equal(resourceWaitWithinDraw([[8,14],[12,18],[22,30],[29,null]],10,25),11);
  assert.equal(resourceWaitWithinDraw([],10,25),0);
  assert.equal(resourceWaitWithinDraw([[0,3],[30,40]],10,25),0);
  assert.equal(resourceWaitWithinDraw([[0,null]],10,25),15);
});

test('capture diagnostics distinguish nested browser time and encoder backpressure from total work',()=>{
  const diagnostics=createRenderDiagnostics(2);
  const frame={seekMs:20,screenshotMs:40,frameFileWriteMs:1,pngDecodeMs:4,pixelHashMs:2,opticalQaMs:0,textQaMs:0,encoderWriteMs:3,
    browser:{drawMs:10,resourceWaitMs:7,regionChecksMs:1,settleMs:5}};
  diagnostics.frame(0,frame);
  assert.throws(()=>diagnostics.report(),/DIAGNOSTIC_COVERAGE_INCOMPLETE/);
  assert.throws(()=>diagnostics.frame(0,frame),/DIAGNOSTIC_FRAME_ORDER_INVALID/);
  diagnostics.frame(1,{...frame,screenshotMs:60});diagnostics.finishEncoder(12);
  const report=diagnostics.report();
  assert.equal(report.frames,2);assert.equal(report.scope,'forward_capture_only');
  assert.deepEqual(report.host.screenshotMs,{count:2,totalMs:100,p50Ms:40,p95Ms:60,maxMs:60});
  assert.equal(report.host.seekMs.totalMs,40);
  assert.equal(report.browserWithinSeek.drawMs.totalMs,20);
  assert.equal(report.browserWithinSeek.resourceWaitMs.totalMs,14);
  assert.equal(report.encoderFinishMs,12);
  assert.throws(()=>diagnostics.finishEncoder(1),/DIAGNOSTIC_ENCODER_FINISH_INVALID/);
  assert.throws(()=>createRenderDiagnostics(1).frame(0,{...frame,browser:{...frame.browser,resourceWaitMs:11}}),/DIAGNOSTIC_MEASUREMENT_INVALID/);
  assert.throws(()=>createRenderDiagnostics(1).frame(0,{...frame,seekMs:NaN}),/DIAGNOSTIC_MEASUREMENT_INVALID/);
});

test('execution resources are observed independently from a render quality profile',()=>{
  const actual=inspectExecutionResources();
  assert(Number.isSafeInteger(actual.cpu.availableParallelism)&&actual.cpu.availableParallelism>0);
  assert(actual.memory.hostTotalBytes>0);
  for(const value of [actual.cpu.visibleQuotaCores,actual.memory.processConstrainedBytes,actual.memory.visibleCgroupLimitBytes])
    assert(value===null||Number.isFinite(value)&&value>0);
  assert.equal(Object.hasOwn(actual,'profile'),false);
});
