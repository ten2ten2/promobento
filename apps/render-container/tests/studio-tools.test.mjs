import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStudioFrame,checkStudio} from '../src/studio-tools.mjs';

test('studio tools keep the original allowed-frame scope and check the freshly captured frame',async()=>{
 const task={mode:'studio',taskId:'test-studio',job:{renderId:'test-render',frames:[45,165]}},input={taskId:'test-studio',frameIndex:45};
 assert.doesNotThrow(()=>assertStudioFrame(task,input,true));
 for(const [candidate,ready]of [[input,false],[{...input,taskId:'other'},true],[{...input,frameIndex:46},true],[{...input,frameIndex:45.5},true]])
  assert.throws(()=>assertStudioFrame(task,candidate,ready),/STUDIO_SCOPE_INVALID/);
 const calls=[],observation={frame:45,findings:[]};
 const result=await checkStudio({async frame(frame,options){calls.push(['frame',frame,options]);},async observe(id,frame){calls.push(['observe',id,frame]);return observation;}},task,45);
 assert.deepEqual(calls,[['frame',45,{format:'png'}],['observe','test-render',45]]);assert.equal(result.observation,observation);assert.ok(result.totalMs>=result.observeMs);
});
