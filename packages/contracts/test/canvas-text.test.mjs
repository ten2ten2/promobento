import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCanvasTextTrace,assertCanvasTextFrameDigests,canvasNumberText} from '../src/canvas-text.mjs';

test('Canvas title traces are bound to exact scene, frame, text, glyph geometry and font',()=>{
 const spec={totalFrames:450,scenes:[{id:'title',kind:'block',block:'canvas-title@1',start:2,end:4,params:{textSlot:'headline'}}],
  texts:{headline:{text:'AB',role:'headline'}},style:{type:{display:{fontId:'fixture',weight:600}}}};
 const trace={sceneId:'title',slotId:'headline',text:'AB',fontId:'fixture',weight:600,style:'normal',boxes:[{x:1,y:1,width:2,height:3},{x:4,y:1,width:2,height:3}],fontSize:40,alpha:1};
 assert.deepEqual(assertCanvasTextTrace(spec,2,[trace]),[trace]);assert.deepEqual(assertCanvasTextTrace(spec,1,[]),[]);
 for(const bad of [{...trace,text:'AC'},{...trace,slotId:'other'},{...trace,fontId:'other'},{...trace,alpha:1.1},
  {...trace,boxes:trace.boxes.slice(0,1)},{...trace,boxes:[{...trace.boxes[0],width:0},trace.boxes[1]]},{...trace,untrusted:true}])
  assert.throws(()=>assertCanvasTextTrace(spec,2,[bad]),/CANVAS_TEXT_TRACE_INVALID/);
 assert.throws(()=>assertCanvasTextTrace(spec,2,[]),/CANVAS_TEXT_TRACE_MISSING/);
 assert.throws(()=>assertCanvasTextTrace(spec,450,[]),/CANVAS_TEXT_TRACE_INVALID/);
 const sha256='a'.repeat(64),records=[{frame:0,sha256,canvasText:[]},{frame:2,sha256,canvasText:[trace]},{frame:4,sha256,canvasText:[]}];
 assert.doesNotThrow(()=>assertCanvasTextFrameDigests(spec,{start:0,end:6},'review',records));
 assert.throws(()=>assertCanvasTextFrameDigests(spec,{start:0,end:6},'review',records.slice(1)),/CANVAS_TEXT_TRACE_MISSING/);
 assert.throws(()=>assertCanvasTextFrameDigests(spec,{start:0,end:6},'review',[records[0],{...records[1],canvasText:[]},records[2]]),/CANVAS_TEXT_TRACE_MISSING/);
 assert.throws(()=>assertCanvasTextFrameDigests(spec,{start:0,end:6},'review',[records[0],{...records[1],frame:3},records[2]]),/CANVAS_TEXT_TRACE_INVALID/);
});

test('each counting frame is bound to the frozen number and original y5 timing',()=>{
 const scene={id:'count',kind:'block',block:'canvas-number@1',start:10,end:130,params:{textSlot:'number'}};
 const spec={totalFrames:450,scenes:[scene],texts:{number:{text:'123',role:'number',factIds:['confirmed']}},style:{type:{display:{fontId:'fixture',weight:600}}}};
 const trace=text=>({sceneId:'count',slotId:'number',text,fontId:'fixture',weight:600,style:'normal',boxes:[...text].map((_,i)=>({x:i*4,y:1,width:2,height:3})),fontSize:40,alpha:1});
 assert.notEqual(canvasNumberText('123',0),'123');assert.equal(canvasNumberText('123',20),'123');
 for(let n=0;n<=999;n++)for(let frame=0;frame<=20;frame++){
  const p=Math.min(1,(frame/30+1/30)/.7),ease=p>=1?1:1-Math.pow(2,-10*p);
  assert.equal(canvasNumberText(String(n),frame),(n*ease).toFixed(0));
 }
 for(let frame=10;frame<35;frame++)assert.doesNotThrow(()=>assertCanvasTextTrace(spec,frame,[trace(canvasNumberText('123',frame-10))]));
 assert.throws(()=>assertCanvasTextTrace(spec,10,[trace('123')]),/CANVAS_TEXT_TRACE_INVALID/);
 assert.throws(()=>assertCanvasTextTrace({...spec,texts:{number:{...spec.texts.number,factIds:[]}}},10,[trace(canvasNumberText('123',0))]),/CANVAS_TEXT_TRACE_INVALID/);
 assert.equal(canvasNumberText('12.30%',20),'12.30%');assert.equal(canvasNumberText('0.50',20),'0.50');
 for(const value of ['001','-1','1000','1.234','$1','+1%'])assert.throws(()=>canvasNumberText(value,0),/CANVAS_NUMBER_INVALID/);
});

test('sequence traces and bindings switch exactly on each declared page',async()=>{
 const {filmTextBindings}=await import('../src/film.mjs');
 const scene={id:'sequence',kind:'block',block:'canvas-sequence@1',start:10,end:310,params:{items:[{textSlot:'a',startFrame:0},{textSlot:'b',startFrame:120}]}};
 const spec={totalFrames:450,scenes:[scene],texts:{a:{text:'AB',factIds:['a']},b:{text:'CD',factIds:['b']}},style:{type:{display:{fontId:'fixture',weight:600}}}};
 const trace=(slotId,text)=>({sceneId:'sequence',slotId,text,fontId:'fixture',weight:600,style:'normal',boxes:[{x:1,y:1,width:2,height:3},{x:4,y:1,width:2,height:3}],fontSize:40,alpha:1});
 assert.doesNotThrow(()=>assertCanvasTextTrace(spec,129,[trace('a','AB')]));
 assert.doesNotThrow(()=>assertCanvasTextTrace(spec,130,[trace('b','CD')]));
 assert.throws(()=>assertCanvasTextTrace(spec,130,[trace('a','AB')]),/CANVAS_TEXT_TRACE_INVALID/);
 assert.deepEqual(filmTextBindings(spec).map(({slotId,frameStart,frameEndExclusive})=>({slotId,frameStart,frameEndExclusive})),
  [{slotId:'a',frameStart:10,frameEndExclusive:130},{slotId:'b',frameStart:130,frameEndExclusive:310}]);
});
