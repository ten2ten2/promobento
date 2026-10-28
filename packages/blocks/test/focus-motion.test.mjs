import test from 'node:test';
import assert from 'node:assert/strict';
import {focusPose,focusViewport} from '../src/focus-motion.ts';
import {blockEvents,filmMotionFrames} from '../src/events.mjs';

test('real-source framing is continuous, bounded, aspect-aware and independent of seek history',()=>{
 const track=[{frame:0,x:.2,y:.4,zoom:1},{frame:90,x:.8,y:.6,zoom:2},{frame:180,x:.5,y:.5,zoom:1}];
 assert.deepEqual(focusPose(45,track),{x:.5,y:.5,zoom:1.5});
 assert.deepEqual(focusPose(180,track),track[2]);
 for(const viewport of [{width:960,height:540},{width:540,height:960},{width:1080,height:1350},{width:1080,height:1080}]){
  for(let frame=0;frame<=180;frame++){
   const box=focusViewport({width:1920,height:1080},viewport,focusPose(frame,track));
   assert.ok(box.left<=0&&box.top<=0&&box.left+box.width>=viewport.width-1e-9&&box.top+box.height>=viewport.height-1e-9);
  }
  const centered=focusViewport({width:1920,height:1080},viewport,focusPose(180,track));
  assert.ok(Math.abs(centered.left+centered.width/2-viewport.width/2)<1e-9);
  assert.ok(Math.abs(centered.top+centered.height/2-viewport.height/2)<1e-9);
 }
});
test('focus tracks reject out-of-scene or unordered frames and get actual motion samples',()=>{
 const frames={start:0,end:120},valid={focusTrack:[{frame:0,x:.5,y:.5,zoom:1},{frame:100,x:.6,y:.5,zoom:1}]};
 assert.deepEqual(blockEvents('continuous-focus',frames,valid),[{name:'product-land',frame:0}]);
 for(const track of [[{frame:1}],[{frame:0},{frame:0}],[{frame:0},{frame:120}]])
  assert.throws(()=>blockEvents('continuous-focus',frames,{focusTrack:track}),/FOCUS_TRACK_TIMING_INVALID/);
 assert.throws(()=>blockEvents('continuous-focus',frames,{...valid,aspectTracks:{portrait:[{frame:3}]}}),/FOCUS_TRACK_TIMING_INVALID/);
 const spec={totalFrames:450,scenes:[{...frames,kind:'block',block:'continuous-focus@1',params:valid}]};
 assert.deepEqual(filmMotionFrames(spec,'review'),[0,6,30,60,90,118]);
});
