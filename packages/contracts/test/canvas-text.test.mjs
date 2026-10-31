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
