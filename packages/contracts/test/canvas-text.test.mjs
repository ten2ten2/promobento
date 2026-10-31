import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCanvasTextTrace,assertCanvasTextFrameDigests} from '../src/canvas-text.mjs';

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
