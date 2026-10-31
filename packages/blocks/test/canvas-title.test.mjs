import test from 'node:test';
import assert from 'node:assert/strict';
import {blockEvents,filmObservationFrames,filmMotionFrames} from '../src/events.mjs';

const calls=[];
globalThis.window={__pbTakeCanvasText:()=>function(text,x,y){calls.push({text,x,y});}};
const {boundCanvasTitle}=await import('../src/canvas-title.ts');
delete globalThis.window;

const context=()=>({textAlign:'left',textBaseline:'alphabetic',font:'40px "Fixture"',letterSpacing:'0px',globalAlpha:1,
 getTransform:()=>({a:1,b:0,c:0,d:1,e:0,f:0}),measureText:text=>({width:text.length*20,actualBoundingBoxLeft:0,
  actualBoundingBoxRight:18,actualBoundingBoxAscent:30,actualBoundingBoxDescent:5})});
const trace=()=>({boxes:[],fontSize:0,alpha:0,draws:0,font:'',letterSpacing:'0px'});

test('wrapped Canvas text preserves the complete frozen slot and records both lines',()=>{
 calls.length=0;const result=trace(),bound=boundCanvasTitle(context(),'LEARN A LITTLE',result);
 bound.canvas.fillText('LEARN A',0,40);bound.canvas.fillText('LITTLE',0,90);bound.finish();
 assert.deepEqual(calls.map(call=>call.text),['LEARN A','LITTLE']);assert.equal(result.draws,2);assert.equal(result.boxes.length,12);
 const without=boundCanvasTitle(context(),'LEARN A LITTLE',null);
 without.canvas.fillText('LEARN A',0,40);without.canvas.fillText('LITTLE',0,90);without.finish();assert.equal(calls.length,2);
});

test('wrapped Canvas text cannot reorder, omit or add words or change line typography',()=>{
 for(const lines of [['LEARN','EXTRA'],['LEARN'],['LITTLE','LEARN'],['LEARN','A','LITTLE']]){
  const bound=boundCanvasTitle(context(),'LEARN A LITTLE',trace());
  assert.throws(()=>{for(const line of lines)bound.canvas.fillText(line,0,0);bound.finish();},/CANVAS_TEXT_BINDING_MISMATCH/);
 }
 const ctx=context(),bound=boundCanvasTitle(ctx,'LEARN A LITTLE',trace());bound.canvas.fillText('LEARN A',0,0);ctx.font='41px "Fixture"';
 assert.throws(()=>bound.canvas.fillText('LITTLE',0,50),/CANVAS_TEXT_LAYOUT_UNSUPPORTED/);
});

test('a title highlight has an explicit readable hold and leaves old title timing unchanged',()=>{
 const scene={kind:'block',block:'canvas-title@1',start:0,end:150,params:{textSlot:'headline',highlightFrame:45}};
 assert.deepEqual(blockEvents('canvas-title',scene,scene.params),[{name:'title-land',frame:30},{name:'highlight-land',frame:63}]);
 assert.deepEqual(filmObservationFrames({scenes:[scene]},'final'),[69,75]);
 assert.deepEqual(filmMotionFrames({scenes:[scene]},'final'),[0,45,63,149]);
 assert.throws(()=>blockEvents('canvas-title',{start:0,end:75},scene.params),/CANVAS_HIGHLIGHT_READING_HOLD_MISSING/);
 assert.deepEqual(blockEvents('canvas-title',{start:0,end:150},{textSlot:'headline'}),[{name:'title-land',frame:30}]);
});
