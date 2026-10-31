import test from 'node:test';
import assert from 'node:assert/strict';

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
