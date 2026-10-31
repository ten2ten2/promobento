import test from 'node:test';
import assert from 'node:assert/strict';
import {componentPose,readingPose,relayFit,relayLandings,relayPageOffset,relayPageOpacity,relayVisible,returnPose} from '../src/component-relay.ts';
import {blockEvents,filmObservationFrames,filmMotionFrames} from '../src/events.mjs';
import {deriveAudioPlan} from '../../audio/src/plan.mjs';
import {validate} from '../../contracts/generated/block-params.mjs';
import {relayObservationIssues} from '../../../apps/cloud/src/component-relay.ts';

const params={items:[{assetKey:'first'},{assetKey:'second'},{assetKey:'third'}],focus:'roi:0',beatFrames:18};
const scene={id:'relay',kind:'block',block:'component-relay@1',start:30,end:250,params};
const roi={x:.2,y:.25,width:.3,height:.2};

test('component relay admits bounded inputs and reserves a hold for the final page',()=>{
  assert.equal(validate({block:scene.block,params}),true);
  assert.equal(validate({block:scene.block,params:{...params,componentBehavior:'return-to-source'}}),true);
  assert.equal(validate({block:scene.block,params:{...params,componentBehavior:'carry'}}),true);
  assert.equal(validate({block:scene.block,params:{...params,componentBehavior:'random'}}),false);
  assert.equal(validate({block:scene.block,params:{...params,focus:'roi:8'}}),false);
  assert.equal(validate({block:scene.block,params:{...params,beatFrames:5}}),false);
  assert.deepEqual(relayLandings(3,18),[90,144]);
  assert.throws(()=>blockEvents('component-relay',{start:0,end:161},params),/RELAY_READING_HOLD_MISSING/);
  assert.deepEqual(blockEvents('component-relay',scene,params),[
    {name:'component-land',frame:36},{name:'product-step-1',frame:90},{name:'product-step-2',frame:144}]);
});

test('a source-specific detail returns before the next page, while the next page gently moves',()=>{
  const bounds={x:100,y:100,width:700,height:1000},parent=relayFit(bounds,750,1600),beat=18;
  const held=returnPose(3*beat,beat,parent,roi,bounds),returning=returnPose(3.5*beat,beat,parent,roi,bounds),done=returnPose(4*beat,beat,parent,roi,bounds);
  assert.equal(held.opacity,1);assert.ok(returning.component.y>held.component.y);assert.equal(done.opacity,0);assert.deepEqual(done.page,parent);
  const next=relayFit(bounds,750,1600);assert.notDeepEqual(readingPose(5*beat,1,3,beat,next),readingPose(6*beat,1,3,beat,next));
  assert.deepEqual(readingPose(7*beat,1,3,beat,next),next);
  assert.equal(relayPageOpacity(4*beat,1,3,beat),0);
  assert.equal(relayPageOpacity(5*beat,0,3,beat),0);
  assert.equal(relayPageOpacity(5*beat,1,3,beat),1);
});

test('crop begins at its parent, pages travel continuously and frozen events drive review and audio',()=>{
  const bounds={x:100,y:100,width:700,height:1000},parent=relayFit(bounds,750,1600);
  const start=componentPose(18,18,parent,roi,bounds),end=componentPose(36,18,parent,roi,bounds);
  assert.deepEqual(start.page,parent);
  assert.deepEqual(start.component,{x:parent.x+roi.x*parent.width,y:parent.y+roi.y*parent.height,width:parent.width*roi.width,height:parent.height*roi.height});
  assert.notDeepEqual(end.component,start.component);
  for(const frame of [0,18,27,36,72,81,90,126,135,144]){
    const values=params.items.map((_,i)=>[relayVisible(frame,i,3,18),relayPageOffset(frame,i,3,18,840)]);
    assert.deepEqual(values,params.items.map((_,i)=>[relayVisible(frame,i,3,18),relayPageOffset(frame,i,3,18,840)]));
  }
  assert.equal(relayPageOffset(72,1,3,18,840),840);
  assert.equal(relayPageOffset(90,1,3,18,840),0);
  assert.equal(relayVisible(90,0,3,18),false);
  const spec={totalFrames:450,scenes:[scene],audio:{mute:false,music:{kind:'none'},sfx:'auto'}};
  const events=blockEvents('component-relay',scene,params).map(event=>({...event,sceneId:'relay'}));
  assert.deepEqual(deriveAudioPlan(spec,events).events.map(event=>event.frameStart),[66,120,174]);
  assert.deepEqual(filmObservationFrames(spec,'final'),[75,129,183]);
  assert.deepEqual(filmMotionFrames(spec,'final'),[57,66,111,120,165,174]);
});

test('director accepts only a component region from the bound source observation',()=>{
  const film={scenes:[scene],assets:{first:{resourceId:'res_one',roi:[roi]},second:{resourceId:'res_two'},third:{resourceId:'res_three'}}};
  const resources=[{resourceId:'res_one',sha256:'source-one'}],insights=[{sha256:'source-one',regions:[{box:roi,label:'fixture detail'}]}];
  assert.deepEqual(relayObservationIssues(film,insights,resources),[]);
  assert.equal(relayObservationIssues(film,insights,resources,{requireBehavior:true})[0].code,'RELAY_COMPONENT_BEHAVIOR_REQUIRED');
  const scoped={...film,scenes:[{...scene,params:{...params,componentBehavior:'return-to-source'}}]};
  assert.deepEqual(relayObservationIssues(scoped,insights,resources,{requireBehavior:true}),[]);
  const carry={...film,scenes:[{...scene,params:{...params,componentBehavior:'carry'}}]};
  assert.equal(relayObservationIssues(carry,insights,resources,{requireBehavior:true})[0].code,'RELAY_CARRY_RELATION_UNOBSERVED');
  const allResources=[...resources,{resourceId:'res_two',sha256:'source-two'},{resourceId:'res_three',sha256:'source-three'}];
  const allInsights=[...insights,{sha256:'source-two',regions:[{label:' Fixture  detail '}]},{sha256:'source-three',regions:[{label:'fixture detail'}]}];
  assert.deepEqual(relayObservationIssues(carry,allInsights,allResources,{requireBehavior:true}),[]);
  assert.deepEqual(relayObservationIssues(carry,insights,resources),[],'old method has no new carry precondition');
  assert.equal(relayObservationIssues(film,[{sha256:'other',regions:[{box:roi}]}],resources)[0].code,'RELAY_ROI_NOT_OBSERVED');
  assert.equal(relayObservationIssues({...film,assets:{...film.assets,first:{...film.assets.first,roi:[{...roi,x:.21}]}}},insights,resources)[0].code,'RELAY_ROI_NOT_OBSERVED');
});

test('Vox highlights must belong to the exact source image and preserve reading time',()=>{
 const vox={id:'vox',kind:'block',block:'vox-clip@1',start:0,end:450,params:{intervalFrames:120,items:[{assetKey:'first',focus:'roi:0'},{assetKey:'second'}]}};
 const film={scenes:[vox],assets:{first:{resourceId:'res_one',roi:[roi]},second:{resourceId:'res_two'}}};
 const resources=[{resourceId:'res_one',sha256:'source-one'}],insights=[{sha256:'source-one',regions:[{box:roi,label:'visible detail'}]}];
 assert.deepEqual(relayObservationIssues(film,insights,resources),[]);
 assert.equal(relayObservationIssues(film,[{sha256:'other',regions:[{box:roi}]}],resources)[0].code,'VOX_ROI_NOT_OBSERVED');
 assert.equal(relayObservationIssues({...film,assets:{...film.assets,first:{...film.assets.first,roi:[{...roi,x:.21}]}}},insights,resources)[0].path,'/scenes/0/params/items/0/focus');
 assert.deepEqual(blockEvents('vox-clip',vox,vox.params).map(event=>event.frame),[18,69,138]);
 assert.deepEqual(filmObservationFrames(film,'final'),[33,84,153]);
 assert.throws(()=>blockEvents('vox-clip',vox,{...vox.params,intervalFrames:90}),/VOX_CLIP_HIGHLIGHT_HOLD_MISSING/);
});
