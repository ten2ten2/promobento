/** Verify the bounded trusted Canvas-title trace against the immutable FilmSpec. */
export function assertCanvasTextTrace(spec,frame,traces){
 if(!Number.isSafeInteger(frame)||frame<0||frame>=spec.totalFrames)throw Error('CANVAS_TEXT_TRACE_INVALID');
 const scenes=spec.scenes.filter(scene=>scene.kind==='block'&&scene.block==='canvas-title@1'&&scene.start<=frame&&frame<scene.end);
 if(!Array.isArray(traces)||traces.length!==scenes.length||new Set(traces.map(trace=>trace?.sceneId)).size!==traces.length)throw Error('CANVAS_TEXT_TRACE_MISSING');
 for(const scene of scenes){
  const trace=traces.find(item=>item?.sceneId===scene.id),slotId=scene.params.textSlot,slot=spec.texts[slotId],font=spec.style.type.display;
  if(!trace||!slot||Object.keys(trace).some(key=>!['sceneId','slotId','text','fontId','weight','style','boxes','fontSize','alpha'].includes(key))
   ||trace.slotId!==slotId||trace.text!==slot.text||trace.fontId!==font.fontId||trace.weight!==font.weight||trace.style!==(font.style??'normal')
   ||!Number.isFinite(trace.fontSize)||trace.fontSize<=0||trace.fontSize>10000||!Number.isFinite(trace.alpha)||trace.alpha<0||trace.alpha>1
   ||!Array.isArray(trace.boxes)||trace.boxes.length!==[...slot.text].filter(ch=>ch.trim()).length
   ||trace.boxes.some(box=>!box||Object.keys(box).some(key=>!['x','y','width','height'].includes(key))
    ||![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0))throw Error('CANVAS_TEXT_TRACE_INVALID');
 }
 return traces;
}

/** Verify all encoded source frames in order, including deliberate empty intervals. */
export function assertCanvasTextFrameDigests(spec,shard,quality,records){
 const stride=quality==='review'?2:1;
 if(!Array.isArray(records)||records.length!==(shard.end-shard.start)/stride)throw Error('CANVAS_TEXT_TRACE_MISSING');
 for(let i=0;i<records.length;i++){
  const record=records[i],frame=shard.start+i*stride;
  if(!record||Object.keys(record).some(key=>!['frame','sha256','canvasText'].includes(key))||record.frame!==frame||!/^[a-f0-9]{64}$/.test(record.sha256??''))throw Error('CANVAS_TEXT_TRACE_INVALID');
  assertCanvasTextTrace(spec,frame,record.canvasText);
 }
}
