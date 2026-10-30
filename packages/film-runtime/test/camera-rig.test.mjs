import test from 'node:test';
import assert from 'node:assert/strict';
import cameraRig from '../src/camera-rig.js';
import {createOM} from '../src/om.js';

test('original camera rig samples contiguous shots in absolute time and tracks a subject', () => {
  const shots = [
    {id:'opening',start:0,end:2,keys:[
      {at:0,position:[0,0,10],target:[0,0,0],fov:40},
      {at:2,position:[10,4,10],target:[2,0,0],fov:50,ease:'linear'}]},
    {id:'landing',start:2,end:4,keys:[
      {at:0,position:[10,4,10],target:[2,0,0],fov:50},
      {at:2,position:[12,4,10],target:[2,0,0],fov:50,ease:'hold'}]}
  ];
  const rig=cameraRig.create(shots);
  shots[0].keys[0].position[0]=999;
  assert.equal(rig.duration,4);
  assert.deepEqual(rig.sample(1),{time:1,shot:'opening',local:1,progress:.5,position:[5,2,10],target:[1,0,0],fov:45,roll:0});
  assert.equal(rig.sample(2).shot,'landing');
  assert.deepEqual(rig.sample(3).position,[10,4,10]);
  assert.deepEqual(rig.sample(4).position,[12,4,10]);
  assert.deepEqual(rig.sample(1).position,[5,2,10]);
  const snapshot=rig.shots();snapshot[0].id='changed';assert.equal(rig.shots()[0].id,'opening');
  const tracked=cameraRig.track(rig.sample(1),{position:[0,0,0],forward:[0,0,1]});
  assert.deepEqual(tracked.position,[0,3,-6]);assert.deepEqual(tracked.target,[0,.6,1]);
  assert.equal(createOM({root:{},target:{}},[]).cameraRig,cameraRig);
  assert.ok(Object.isFrozen(cameraRig.eases));
  assert.throws(()=>cameraRig.track({}, {position:[0,0,0],forward:[0,1,0]}),/horizontal direction/);
  assert.throws(()=>cameraRig.create([{...rig.shots()[0],start:1}]),/contiguous/);
  const invalidEase=rig.shots();invalidEase[0].keys[1].ease='constructor';
  assert.throws(()=>cameraRig.create(invalidEase),/Unknown camera ease/);
  assert.throws(()=>rig.sample(NaN),/finite/);
});
