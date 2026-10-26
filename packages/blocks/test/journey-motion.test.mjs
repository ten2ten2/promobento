import test from 'node:test';
import assert from 'node:assert/strict';
import {journeyPose} from '../src/journey-motion.ts';
import {blockEvents,filmBlockEvents,filmObservationFrames,filmMotionFrames} from '../src/events.mjs';
import {deriveAudioPlan} from '../../audio/src/plan.mjs';
import {validate} from '../../contracts/generated/block-params.mjs';

const params={beatFrames:18,items:['ready','pause','done'].map(textSlot=>({textSlot,assetKey:textSlot}))};
const scene={id:'journey',kind:'block',block:'ui-journey@1',start:54,end:216,params};
test('beat journey preserves the legacy contract and requires a final reading interval',()=>{
  assert.equal(validate({block:scene.block,params}),true);
  assert.equal(validate({block:scene.block,params:{items:params.items}}),true);
  assert.equal(validate({block:scene.block,params:{...params,beatFrames:5}}),false);
  assert.deepEqual(blockEvents('ui-journey',scene,{items:params.items}),[{name:'product-land',frame:138}]);
  assert.throws(()=>blockEvents('ui-journey',{start:0,end:143},params),/JOURNEY_READING_HOLD_MISSING/);
});
test('each real state has a readable observation, transition pose and beat-aligned sound',()=>{
  const spec={totalFrames:450,scenes:[scene],audio:{mute:false,music:{kind:'procedural',style:'funk',bpm:100},sfx:'auto'}};
  const events=filmBlockEvents(spec);
  assert.deepEqual(events.map(event=>event.frame),[18,72,126]);
  assert.deepEqual(events.map(event=>event.name),['product-step-1','product-step-2','product-land']);
  assert.deepEqual(deriveAudioPlan(spec,events).events.filter(event=>event.kind==='sfx').map(event=>event.frameStart),[72,126,180]);
  assert.deepEqual(filmObservationFrames(spec,'final'),[81,135,189]);
  assert.deepEqual(filmObservationFrames(spec,'review'),[80,134,188]);
  assert.deepEqual(filmMotionFrames(spec,'final'),[63,72,117,126,171,180]);
  assert.deepEqual(filmMotionFrames(spec,'review'),[62,72,116,126,170,180]);
  for(const [index,frame]of [27,81,135].entries()){
    const pose=journeyPose(frame,index,3,18);
    assert.equal(pose.textOpacity,1);assert.equal(pose.textY,0);
    assert.equal(pose.opacity,1);assert.equal(Math.abs(pose.angle),0);
    assert.notEqual(pose.zoom,journeyPose(frame+6,index,3,18).zoom);
    assert.ok([0,1,2].filter(i=>i!==index).every(i=>journeyPose(frame,i,3,18).opacity===0));
  }
  for(const frame of [0,9,63,117,161])for(const index of [0,1,2]){
    const pose=journeyPose(frame,index,3,18);
    journeyPose(161,index,3,18);journeyPose(0,index,3,18);
    assert.deepEqual(journeyPose(frame,index,3,18),pose);
  }
  for(const frame of [0,9,54,58,63,68,72,108,117,126,161])
    assert.equal([0,1,2].reduce((sum,index)=>sum+journeyPose(frame,index,3,18).opacity,0),1,'one real product state, never a ghosted pair');
  for(const frame of [63,117])
    assert.ok([0,1,2].every(index=>journeyPose(frame,index,3,18).textOpacity===0),'copy clears the product during camera handoff');
});
