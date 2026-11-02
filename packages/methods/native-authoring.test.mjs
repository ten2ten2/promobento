import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTreatment} from './native-authoring.mjs';

test('native Treatment spans every film frame while allowing overlapping layers',()=>{
 const beat=(id,startFrame,endFrame)=>({id,purpose:'Native shot',startFrame,endFrame,assetIds:[]});
 const treatment=beats=>({beats,hardestBeat:'first',reviewFrames:[0,225,449]});
 const complete=treatment([beat('first',0,180),beat('second',150,360),beat('last',360,450)]);
 assert.equal(assertTreatment(complete,15,[]),complete);
 for(const incomplete of [
  [beat('first',0,180),beat('last',181,450)],
  [beat('first',0,150),beat('second',0,180),beat('last',300,450)],
 ])assert.throws(()=>assertTreatment(treatment(incomplete),15,[]),/NATIVE_TREATMENT_INVALID/);
});
