import test from 'node:test';
import assert from 'node:assert/strict';
import {ADMISSION_DRAW_MAX_BYTES,paintAdmissionCanvas,validateAdmissionDraw} from '../src/admission-commands.mjs';
import {admissionVerificationPlan,captureAdmission} from '../src/admission-capture.mjs';
import {fixtureConfiguration} from '../src/render-sample.mjs';

const options={width:1080,height:1080,declarations:{regions:[{id:'headline',sourcePath:'composition.mjs',line:1}]}};
const rect=()=>({op:'rect',x:10,y:20,width:100,height:50,color:'#e77d51',opacity:1});
const circle=()=>({op:'circle',x:10,y:20,radius:30,color:'#ABC123',opacity:0.5});
const polygon=()=>({op:'polygon',points:[{x:0,y:0},{x:100,y:100},{x:0,y:100}],color:'#000000',opacity:0});

test('geometry data is fully validated, canonicalized and detached without accepting markup or browser methods',()=>{
  const value={commands:[rect(),circle(),polygon()],regions:[{id:'headline',x:0,y:0,width:1080,height:100}]};
  const actual=validateAdmissionDraw(JSON.stringify(value),options);
  assert.deepEqual(actual,value);
  assert.notEqual(actual,value);assert.notEqual(actual.commands,value.commands);
  const detached=validateAdmissionDraw(value,options);
  detached.commands[0].x=99;assert.equal(value.commands[0].x,10);
  assert.deepEqual(validateAdmissionDraw({commands:[]},options),{commands:[],regions:[]});
  for(const command of [
    {...rect(),op:'fillRect'}, {...rect(),url:'https://example.test'}, {...rect(),html:'<script>throw 1</script>'},
    {...rect(),color:'url(https://example.test)'},{...rect(),color:'#fff'},{...rect(),opacity:1.01},
    {...rect(),opacity:-0.1},{...rect(),x:Infinity},{...rect(),width:-1},{...rect(),extra:1},
    {...circle(),width:5},{...polygon(),points:[{x:0,y:0},{x:1,y:1}]},
    {...polygon(),points:[{x:0,y:0},{x:1,y:1},{x:0,y:1,z:0}]}
  ])assert.throws(()=>validateAdmissionDraw({commands:[command]},options),/ADMISSION_DRAW_INVALID/);
  for(const value of [{commands:[],receipt:{event:'frame-ready'}},{commands:[],frameIndex:0},{commands:[],regions:[],extra:0}])
    assert.throws(()=>validateAdmissionDraw(value,options),/ADMISSION_DRAW_INVALID/);
  const missing=rect();delete missing.opacity;
  assert.throws(()=>validateAdmissionDraw({commands:[missing]},options),/ADMISSION_DRAW_INVALID/);
});

test('serialized geometry rejects duplicates and oversized input before parsing',()=>{
  assert.throws(()=>validateAdmissionDraw('{"commands":[],"commands":[]}',options),/DUPLICATE_JSON_KEY/);
  assert.throws(()=>validateAdmissionDraw(' '.repeat(ADMISSION_DRAW_MAX_BYTES)+'{}',options),/ADMISSION_DRAW_TOO_LARGE/);
  assert.throws(()=>validateAdmissionDraw(new Uint8Array(ADMISSION_DRAW_MAX_BYTES+1),options),/ADMISSION_DRAW_TOO_LARGE/);
  let touched=false;
  const dangerous={commands:[]};Object.defineProperty(dangerous,'receipt',{get:()=>{touched=true;throw Error('not data');},enumerable:true});
  assert.throws(()=>validateAdmissionDraw(dangerous,options),/ADMISSION_DRAW_INVALID/);
  assert.equal(touched,false,'In-memory non-JSON accessors must not execute during validation');
});

test('command, polygon and geometry bounds are enforced while bounded offscreen motion is allowed',()=>{
  const commands=Array.from({length:4096},rect);
  assert.equal(validateAdmissionDraw({commands},options).commands.length,4096);
  commands.push(rect());assert.throws(()=>validateAdmissionDraw({commands},options),/ADMISSION_DRAW_INVALID/);
  const points=Array.from({length:64},(_,index)=>({x:index,y:index%2}));
  assert.equal(validateAdmissionDraw({commands:[{...polygon(),points}]},options).commands[0].points.length,64);
  assert.throws(()=>validateAdmissionDraw({commands:[{...polygon(),points:[...points,{x:1,y:2}]}]},options),/ADMISSION_DRAW_INVALID/);
  assert.throws(()=>validateAdmissionDraw({commands:Array.from({length:257},()=>({...polygon(),points}))},options),/ADMISSION_DRAW_TOO_MANY_POINTS/);
  for(const command of [{...rect(),x:4321},{...circle(),radius:4321},{...rect(),height:4321},
    {...polygon(),points:[{x:0,y:0},{x:-4321,y:0},{x:0,y:1}]}])
    assert.throws(()=>validateAdmissionDraw({commands:[command]},options),/ADMISSION_GEOMETRY_OUT_OF_RANGE/);
  assert.equal(validateAdmissionDraw({commands:[{...rect(),x:-4320}]},options).commands[0].x,-4320);
  assert.throws(()=>validateAdmissionDraw({commands:[{...rect(),radius:25.01}]},options),/ADMISSION_CORNER_RADIUS_INVALID/);
  assert.equal(validateAdmissionDraw({commands:[{...rect(),radius:25}]},options).commands[0].radius,25);
  for(const width of [0,-1,4097,NaN,10.5])assert.throws(()=>validateAdmissionDraw({commands:[]},{...options,width}),/ADMISSION_CANVAS_DIMENSIONS_INVALID/);
});

test('reported regions cannot create source declarations or exceed canvas bounds',()=>{
  const region={id:'headline',x:0,y:0,width:1080,height:100};
  for(const regions of [[{...region,id:'invented'}],[region,region]])
    assert.throws(()=>validateAdmissionDraw({commands:[],regions},options),/REGION_(UNDECLARED|BOUNDS_INVALID)/);
  assert.throws(()=>validateAdmissionDraw({commands:[],regions:[{...region,x:1}]},options),/REGION_OUT_OF_BOUNDS/);
  assert.throws(()=>validateAdmissionDraw({commands:[],regions:[{...region,sourcePath:'other.mjs'}]},options),/ADMISSION_DRAW_INVALID/);
});

test('trusted painter resets each frame and dispatches only the fixed geometry operations',()=>{
  const calls=[],context={};
  for(const method of ['fillRect','beginPath','rect','roundRect','arc','moveTo','lineTo','closePath','fill'])
    context[method]=(...args)=>calls.push([method,...args]);
  const canvas={getContext:(...args)=>{calls.push(['getContext',...args]);return context;}};
  const previous=globalThis.document;
  globalThis.document={getElementById:id=>{assert.equal(id,'admission-canvas');return canvas;}};
  try {
    paintAdmissionCanvas({width:1080,height:1080,commands:[rect(),{...rect(),radius:8},circle(),polygon()]});
    assert.equal(canvas.width,1080);assert.equal(canvas.height,1080);
    assert.deepEqual(calls[1],['fillRect',0,0,1080,1080]);
    assert(calls.some(call=>call[0]==='rect'));assert(calls.some(call=>call[0]==='roundRect'));
    assert(calls.some(call=>call[0]==='arc'));assert(calls.some(call=>call[0]==='closePath'));
    assert.equal(calls.filter(call=>call[0]==='fill').length,4);assert.equal(context.globalAlpha,1);
    assert.throws(()=>paintAdmissionCanvas({width:1080,height:1080,commands:[{...rect(),op:'drawImage'}]}),/ADMISSION_DRAW_OPERATION_INVALID/);
  } finally {
    if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
  }
});

test('capture requires exact platform output and the complete fixed determinism plan before launching a browser',async()=>{
  const {input,encoding}=fixtureConfiguration('square');
  const base={input,encoding,drawFrame:()=>({commands:[]}),outputDirectory:'/not-created'};
  for(const frameCount of [450,900]) {
    const plan=admissionVerificationPlan(frameCount);
    assert.equal(plan.version,'admission-determinism-v1');
    assert.equal(plan.cold[0],0);assert.equal(plan.cold.at(-1),frameCount-1);
    assert(plan.cold.some(frame=>frame%30!==0));
    assert(new Set(plan.repeated).size<plan.repeated.length);
    assert(plan.unordered.some((frame,index)=>index&&frame<plan.unordered[index-1]));
  }
  assert.throws(()=>admissionVerificationPlan(451),/ADMISSION_FRAME_COUNT_INVALID/);
  await assert.rejects(captureAdmission({...base,verification:{...admissionVerificationPlan(450),cold:[]}}),/ADMISSION_VERIFICATION_INVALID/);
  await assert.rejects(captureAdmission({...base,input:{...input,targetId:'custom:square'}}),/ADMISSION_TARGET_INVALID/);
  await assert.rejects(captureAdmission({...base,input:{...input,width:540}}),/ADMISSION_CANVAS_DIMENSIONS_INVALID/);
  await assert.rejects(captureAdmission({...base,input:{...input,durationSeconds:16}}),/ADMISSION_DURATION_INVALID/);
  await assert.rejects(captureAdmission({...base,encoding:{...encoding,fps:60}}),/ADMISSION_ENCODING_INVALID/);
  await assert.rejects(captureAdmission({...base,drawFrame:undefined}),/ADMISSION_DRAW_READER_REQUIRED/);
});
