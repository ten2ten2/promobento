import test from 'node:test';
import assert from 'node:assert/strict';
import {createClipHelpers} from '../src/clip/helpers.js';

test('private clip helpers keep stage, functions and scratch canvases separate',()=>{
 const firstEnv={},secondEnv={},first=createClipHelpers(firstEnv),second=createClipHelpers(secondEnv);
 first.U.setStage(200,100);second.U.setStage(80,120);
 assert.deepEqual(firstEnv.STAGE,{W:200,H:100});assert.deepEqual(secondEnv.STAGE,{W:80,H:120});
 const spring=second.MO.springHz;first.MO.springHz=()=>123;
 assert.equal(first.MO.springHz(),123);assert.equal(second.MO.springHz,spring);
 const original=globalThis.document;globalThis.document={createElement:()=>({width:0,height:0})};
 try{
  const a=first.UI.scratch('shared',10,20),b=second.UI.scratch('shared',10,20);
  assert.notEqual(a,b);assert.equal(first.UI.scratch('shared',10,20),a);a.width=7;assert.equal(b.width,10);
 }finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});

test('an explicitly supplied environment retains the legacy global namespace objects',()=>{
 const env={},clip=createClipHelpers(env);
 for(const name of ['U','MO','CAM','PAINT','KIT','DG','TY','CH','UI','CL','TOON'])assert.equal(clip[name],env[name]);
 assert.equal(clip.cues.findWord([{word:'hello',start:1,end:2}],'hello'),1);
});
