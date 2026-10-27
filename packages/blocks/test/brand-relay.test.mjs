import test from 'node:test';
import assert from 'node:assert/strict';
import {brandRelayPose} from '../src/brand-relay.ts';
import {blockEvents,filmBlockEvents,filmObservationFrames,filmMotionFrames} from '../src/events.mjs';
import {deriveAudioPlan} from '../../audio/src/plan.mjs';
import {validate} from '../../contracts/generated/block-params.mjs';

const params={logoKey:'brand',beatFrames:18,items:['coding','work','media'].map(textSlot=>({textSlot}))};
test('brand relay requires a beat interval and text roles, while existing feature grids stay valid',()=>{
  const valid=params=>validate({block:'feature-grid@1',params});
  assert.equal(valid(params),true);
  assert.equal(valid({items:params.items}),true);
  assert.equal(valid({...params,beatFrames:undefined}),false);
  assert.equal(valid({...params,beatFrames:5}),false);
  assert.equal(valid({...params,items:[{textSlot:'coding',assetKey:'screen'},params.items[1]]}),false);
});
test('three visible landings map to three distinct automatic sounds on the same music beats',()=>{
  const scene={id:'crew',kind:'block',block:'feature-grid@1',start:183,end:360,params};
  const spec={totalFrames:450,scenes:[scene],audio:{mute:false,music:{kind:'procedural',style:'funk',bpm:100},sfx:'auto'}};
  const events=filmBlockEvents(spec),plan=deriveAudioPlan(spec,events);
  assert.deepEqual(events.map(event=>event.frame),[15,33,51]);
  assert.deepEqual(events.map(event=>event.name),['feature-step-1','feature-step-2','feature-land']);
  const sfx=plan.events.filter(event=>event.kind==='sfx');
  assert.deepEqual(sfx.map(event=>event.frameStart),[198,216,234]);
  assert.ok(sfx.every(event=>event.frameStart%18===0));
  assert.deepEqual(blockEvents('feature-grid',{start:0,end:100},{items:params.items}),[{name:'feature-land',frame:22}]);
  assert.throws(()=>blockEvents('feature-grid',{start:0,end:51},params),/FEATURE_BEAT_AFTER_SCENE/);
});
test('brand mark lands exactly and replays a moving pose after reverse or cold seeks',()=>{
  for(const points of [[{x:8,y:0},{x:300,y:0},{x:600,y:0}], [{x:8,y:0},{x:8,y:200},{x:8,y:400}]]){
    for(const [index,frame] of [15,33,51].entries())
      assert.deepEqual(brandRelayPose(frame,18,points),{...points[index],scale:1,rotation:0,moving:false});
    const moving=brandRelayPose(24,18,points);
    assert.equal(moving.moving,true);assert.ok(moving.scale>1);
    brandRelayPose(90,18,points);brandRelayPose(0,18,points);
    assert.deepEqual(brandRelayPose(24,18,points),moving);
    assert.deepEqual(brandRelayPose(400,18,points),{...points[2],scale:1,rotation:0,moving:false});
  }
});

test('review captures the actual relay landings and mid-hops without treating moving poses as reading QA',()=>{
 const spec={scenes:[{id:'crew',kind:'block',block:'feature-grid@1',start:75,end:240,params}]};
 assert.deepEqual(filmMotionFrames(spec,'final'),[90,99,108,117,126]);
 assert.deepEqual(filmMotionFrames(spec,'review'),[90,98,108,116,126]);
 assert.deepEqual(filmObservationFrames(spec,'final'),[132,157]);
 assert.deepEqual(filmObservationFrames(spec,'review'),[132,156]);
 const legacy={scenes:[{...spec.scenes[0],params:{items:params.items}}]};
 assert.deepEqual(filmMotionFrames(legacy,'final'),[]);
 assert.deepEqual(filmMotionFrames({scenes:[{...spec.scenes[0],params:{...params,logoKey:undefined}}]},'final'),[]);
});

test('custom motion evidence captures event neighborhoods and adjacent handoffs on the actual frame clock',()=>{
 const spec={totalFrames:450,scenes:[{id:'shot',kind:'custom',start:101,end:190,params:{textSlots:[],assetKeys:[],events:[{name:'action',frame:31}],readingHolds:[{start:30,end:80}]}}]};
 const final=filmMotionFrames(spec,'final'),review=filmMotionFrames(spec,'review');
 for(const frame of [99,101,107,126,132,138,184,189,190])assert.ok(final.includes(frame),String(frame));
 for(const frame of [98,100,106,126,132,138,184,188,190])assert.ok(review.includes(frame),String(frame));
 assert.ok(review.every(frame=>frame%2===0));
 assert.deepEqual(filmMotionFrames(spec,'final',{eventNeighborhoods:false}),[101,131,132,161,189]);
});
