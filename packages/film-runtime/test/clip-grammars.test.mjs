import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrammar,grammarNames} from '../src/clip/grammars/index.js';
import {createClipStage} from '../src/clip/stage.js';

test('original grammars are allowlisted and create independent scene state',()=>{
 const previous={U:globalThis.U,TY:globalThis.TY,document:globalThis.document};
 try{
  globalThis.U={clamp:(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),lerp:(a,b,p)=>a+(b-a)*p};
  globalThis.TY={fit:(g,text,width,size)=>({size,lines:[text],ok:true})};
  globalThis.document={createElement:()=>({getContext:()=>({})})};
  const clip={beats:(cues,name)=>cues.map(cue=>({id:name(cue),at:cue.at})),rid:(base,i)=>`${base}-${i}`,mark:()=>{}};
  assert.equal(grammarNames.length,7);assert.ok(!grammarNames.includes('y4_storytime'));
  for(const name of grammarNames){const grammar=createGrammar(name,clip);assert.equal(typeof grammar.draw,'function',name);}
  assert.throws(()=>createGrammar('y4_storytime',clip),/CLIP_GRAMMAR_UNSUPPORTED/);
  const context=colour=>{const cues=[{kind:'title',at:0,text:'Approved fixture'}];return{W:100,H:100,u:1,portrait:false,alpha:false,
   data:{palette:[[colour,'#ffffff']]},cues,safe:{top:0,bottom:0},of:(...kinds)=>cues.filter(cue=>kinds.includes(cue.kind))};};
  const red=createGrammar('y5_kinetic_type',clip),blue=createGrammar('y5_kinetic_type',clip),a=context('#ff0000'),b=context('#0000ff');
  red.init(a);blue.init(b);
  const fills=[];const canvas=new Proxy({},{get:(object,key)=>key==='fillRect'?()=>fills.push(object.fillStyle):key in object?object[key]:()=>{},set:(object,key,value)=>(object[key]=value,true)});
  red.draw(canvas,-1,a);blue.draw(canvas,-1,b);
  assert.deepEqual(fills,['#ff0000','#0000ff']);
 }finally{for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

test('clip stage fails closed and keeps original grammar instances and frame hits separate',()=>{
 const previous={U:globalThis.U,TY:globalThis.TY,document:globalThis.document,CAM:globalThis.CAM};
 try{
  globalThis.U={clamp:(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),lerp:(a,b,p)=>a+(b-a)*p};
  globalThis.TY={fit:(g,text,width,size)=>({size,lines:[text],ok:true}),width:()=>12,slam:()=>{throw Error('RUNTIME_TEXT_FORBIDDEN');}};
  globalThis.CAM={drift:()=>[0,0],with:(c,options,draw)=>draw(c)};
  globalThis.document={createElement:()=>({getContext:()=>({})})};
  const spec=colour=>({grammar:'y5_kinetic_type',duration:15,data:{palette:[[colour,'#ffffff']]},cues:[{kind:'title',at:10,text:'Approved fixture'}]});
  const first=createClipStage(spec('#ff0000'),{width:100,height:100}),second=createClipStage(spec('#0000ff'),{width:100,height:100});
  assert.deepEqual(first.scenes(),[{id:'title',at:10}]);
  const fills=[];const c=new Proxy({},{get:(object,key)=>key==='fillRect'?()=>fills.push(object.fillStyle):key in object?object[key]:()=>{},set:(object,key,value)=>(object[key]=value,true)});
  first.draw(c,0);second.draw(c,0);first.draw(c,0);assert.deepEqual(fills,['#ff0000','#0000ff','#ff0000']);
  assert.equal(first.hit('title'),null);assert.throws(()=>first.draw(c,10),/RUNTIME_TEXT_FORBIDDEN/);
  assert.throws(()=>first.draw(c,16),/CLIP_TIME_INVALID/);
  assert.throws(()=>createClipStage({...spec('#000000'),fps:24},{width:100,height:100}),/CLIP_SPEC_INVALID/);
  assert.throws(()=>createClipStage({...spec('#000000'),cues:[{kind:'title',at:16}]},{width:100,height:100}),/CLIP_CUE_INVALID/);
 }finally{for(const [key,value]of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
