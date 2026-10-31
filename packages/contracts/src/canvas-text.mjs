/** Only audited fixed Canvas blocks may use trusted text drawing. */
export function isCanvasTextScene(scene){return scene.kind==='block'&&['canvas-title@1','canvas-sequence@1','canvas-number@1','canvas-subtitle@1','canvas-subtitle-sequence@1'].includes(scene.block);}
/** Original y5 count, bound to a confirmed non-negative value and optional percent. */
export function parseCanvasNumber(text){
 if(typeof text!=='string')throw Error('CANVAS_NUMBER_INVALID');
 const match=/^(0|[1-9]\d{0,2})(?:\.(\d{1,2}))?(%)?$/.exec(text);if(!match)throw Error('CANVAS_NUMBER_INVALID');
 return{value:Number(match[1]+(match[2]?'.'+match[2]:'')),decimals:match[2]?.length??0,suffix:match[3]??''};
}
export function canvasNumberText(text,frame){
 const {value,decimals,suffix}=parseCanvasNumber(text);
 if(!Number.isSafeInteger(frame)||frame<0)throw Error('CANVAS_NUMBER_INVALID');
 const p=Math.min(1,(frame+1)/21),ease=p>=1?1:1-Math.pow(2,-10*p);
 return (value*ease).toFixed(decimals)+suffix;
}
export function canvasTextSlotAt(scene,frame){
 if(['canvas-title@1','canvas-number@1','canvas-subtitle@1'].includes(scene.block))return scene.params.textSlot;
 const items=scene.params.items;return [...items].reverse().find(item=>scene.start+item.startFrame<=frame)?.textSlot;
}
export function canvasTextSubtitleSlotAt(scene,frame){
 if(scene.block==='canvas-subtitle@1')return scene.params.subtitleSlot;
 if(scene.block==='canvas-subtitle-sequence@1')return [...scene.params.items].reverse().find(item=>scene.start+item.startFrame<=frame)?.subtitleSlot;
}
export function canvasTextSlotsAt(scene,frame){
 const subtitle=canvasTextSubtitleSlotAt(scene,frame);
 return subtitle?[canvasTextSlotAt(scene,frame),subtitle]:[canvasTextSlotAt(scene,frame)];
}
/** Verify the bounded trusted Canvas trace against the immutable FilmSpec. */
export function assertCanvasTextTrace(spec,frame,traces){
 if(!Number.isSafeInteger(frame)||frame<0||frame>=spec.totalFrames)throw Error('CANVAS_TEXT_TRACE_INVALID');
 const scenes=spec.scenes.filter(scene=>isCanvasTextScene(scene)&&scene.start<=frame&&frame<scene.end),bindings=scenes.flatMap(scene=>canvasTextSlotsAt(scene,frame).map(slotId=>({scene,slotId})));
 if(!Array.isArray(traces)||traces.length!==bindings.length||new Set(traces.map(trace=>trace?.sceneId+'\0'+trace?.slotId)).size!==traces.length)throw Error('CANVAS_TEXT_TRACE_MISSING');
 for(const {scene,slotId}of bindings){
  const trace=traces.find(item=>item?.sceneId===scene.id&&item?.slotId===slotId),slot=spec.texts[slotId],subtitle=canvasTextSubtitleSlotAt(scene,frame),font=slotId===subtitle?spec.style.type.text:spec.style.type.display;
  if(scene.block==='canvas-number@1'&&(!slot||slot.role!=='number'||!Array.isArray(slot.factIds)||!slot.factIds.length))throw Error('CANVAS_TEXT_TRACE_INVALID');
  if(['canvas-subtitle@1','canvas-subtitle-sequence@1'].includes(scene.block)&&(!slot||slot.role!==(slotId===subtitle?'body':'headline')||!Array.isArray(slot.factIds)||!slot.factIds.length))throw Error('CANVAS_TEXT_TRACE_INVALID');
  const text=scene.block==='canvas-number@1'&&slot?canvasNumberText(slot.text,frame-scene.start):slot?.text;
  if(!trace||!slot||Object.keys(trace).some(key=>!['sceneId','slotId','text','fontId','weight','style','boxes','fontSize','alpha'].includes(key))
   ||trace.slotId!==slotId||trace.text!==text||trace.fontId!==font.fontId||trace.weight!==font.weight||trace.style!==(font.style??'normal')
   ||!Number.isFinite(trace.fontSize)||trace.fontSize<=0||trace.fontSize>10000||!Number.isFinite(trace.alpha)||trace.alpha<0||trace.alpha>1
   ||!Array.isArray(trace.boxes)||trace.boxes.length!==[...text].filter(ch=>ch.trim()).length
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
