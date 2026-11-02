import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTreatment,applyProjectPatch} from './native-authoring.mjs';

test('native Treatment spans every film frame while allowing overlapping layers',()=>{
 const beat=(id,startFrame,endFrame)=>({id,purpose:'Native shot',startFrame,endFrame,assetIds:[]});
 const treatment=beats=>({beats,hardestBeat:'first',reviewFrames:[0,225,449]});
 const complete=treatment([beat('first',0,180),beat('second',150,360),beat('last',360,450)]);
 assert.equal(assertTreatment(complete,15,[]),complete);
 for(const incomplete of [
  [beat('first',0,180),beat('last',181,450)],
  [beat('first',0,150),beat('second',0,180),beat('last',300,450)],
 ])assert.throws(()=>assertTreatment(treatment(incomplete),15,[]),/NATIVE_TREATMENT_INVALID/);
 assert.throws(()=>assertTreatment(treatment([{...beat('first',0,450),assetIds:['music','music']}]),15,['music']),/NATIVE_TREATMENT_INVALID/);
});

test('revision patches cannot rewrite the approved Brief, Treatment or locked production documents',()=>{
 const files=[{path:'index.html',content:'<h1>Original</h1>'},
  {path:'BRIEF.md',content:'Confirmed facts'},
  {path:'TREATMENT.md',content:'Approved direction'},
  {path:'script.json',content:'{}'},
  {path:'material-selection.json',content:'{}'}];
 const patch=(command,path)=>applyProjectPatch(files,'revision-1',{baseRevision:'revision-1',edits:[
  {command,path,oldText:'Approved direction',newText:'Unapproved direction',content:'Unapproved direction'}]});
 for(const command of ['create','replace','delete']){
  assert.throws(()=>patch(command,'TREATMENT.md'),/NATIVE_TREATMENT_READ_ONLY/);
  assert.throws(()=>patch(command,'BRIEF.md'),/NATIVE_BRIEF_READ_ONLY/);
  assert.throws(()=>patch(command,'script.json'),/NATIVE_PRODUCTION_DOCUMENT_READ_ONLY/);
  assert.throws(()=>patch(command,'material-selection.json'),/NATIVE_PRODUCTION_DOCUMENT_READ_ONLY/);
 }
 assert.equal(applyProjectPatch(files,'revision-1',{baseRevision:'revision-1',edits:[
  {command:'replace',path:'index.html',oldText:'Original',newText:'Corrected'}]})
  .find(file=>file.path==='TREATMENT.md').content,'Approved direction');
});
