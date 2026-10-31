import test from 'node:test';
import assert from 'node:assert/strict';
import {blockEvents,filmObservationFrames,filmMotionFrames} from '../src/events.mjs';

test('original Vox image arrivals retain reading holds and actual motion sampling',()=>{
 const params={intervalFrames:90,items:[{assetKey:'first'},{assetKey:'second'},{assetKey:'third'}]},scene={id:'clip',kind:'block',block:'vox-clip@1',start:30,end:300,params};
 assert.deepEqual(blockEvents('vox-clip',scene,params),[{name:'product-step-1',frame:18},{name:'product-step-2',frame:108},{name:'product-land',frame:198}]);
 assert.throws(()=>blockEvents('vox-clip',{start:0,end:227},params),/VOX_CLIP_READING_HOLD_MISSING/);
 assert.deepEqual(filmObservationFrames({scenes:[scene]},'final'),[63,153,243]);
 assert.deepEqual(filmMotionFrames({scenes:[scene]},'final'),[30,48,120,138,210,228]);
});
