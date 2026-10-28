// Trusted review packaging: compose actual checked PNG pixels, never execute author code or omit an aspect.
import {pngPixels,pngRgba} from '@promobento/contracts/seams';

export {pngRgba} from '@promobento/contracts/seams';

/** Bind only the committed encoded-frame images described by the measured inspection. */
export function auditSheetReferences(movie,aspect){
 const inspection=movie.media?.motionAudit?.inspection;
 if(inspection?.status!=='available')return [];
 return inspection.sheets.map(sample=>{
  if(!/^audit-frames\/[01]-(overview|detail)\.jpg$/.test(sample.path)||!Array.isArray(sample.frames)||
    sample.frames.length!==6||sample.frames.some(frame=>!Number.isInteger(frame)||frame<0||frame>899))throw Error('AUDIT_IMAGE_REFERENCE_INVALID');
  const object=movie.outputs.find(blob=>blob.key.endsWith('/out/'+sample.path));
  if(!object)throw Error('RENDER_OUTPUT_MISSING');
  return {...sample,aspect,renderId:movie.renderId,image:object,
    layout:'3x2_row_major_4px_gutters',scope:'actual_encoded_preview_frames_not_full_motion_or_audio_review'};
 });
}

// Review chrome stays outside the source rectangles. A tiny fixed font avoids
// browser/font dependencies in this trusted Worker-side packaging step.
const glyphs={
 '0':['01110','10001','10011','10101','11001','10001','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01110','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','01110'],
 A:['01110','10001','10001','11111','10001','10001','10001'],
 E:['11111','10000','10000','11110','10000','10000','11111'],
 F:['11111','10000','10000','11110','10000','10000','10000'],
 M:['10001','11011','10101','10101','10001','10001','10001'],
 N:['10001','11001','10101','10011','10001','10001','10001'],
 O:['01110','10001','10001','10001','10001','10001','01110'],
 R:['11110','10001','10001','11110','10100','10010','10001']
};
function label(pixels,width,left,top,limit,text){
 const scale=limit>=text.length*12?2:1;
 for(const [index,char]of [...text].entries())for(const [y,row]of (glyphs[char]??[]).entries())for(let x=0;x<5;x++)if(row[x]==='1'){
  for(let yy=0;yy<scale;yy++)for(let xx=0;xx<scale;xx++){
   const dx=index*6*scale+x*scale+xx;if(dx>=limit)continue;
   pixels.set([241,245,249,255],((top+y*scale+yy)*width+left+dx)*4);
  }
 }
}
function copyReduced(source,pixels,width,left,top,tileWidth,tileHeight){
 for(let y=0;y<tileHeight;y++)for(let x=0;x<tileWidth;x++){
  const x0=x*source.width/tileWidth,x1=(x+1)*source.width/tileWidth,y0=y*source.height/tileHeight,y1=(y+1)*source.height/tileHeight;
  let alpha=0,red=0,green=0,blue=0;
  for(let sy=Math.floor(y0);sy<Math.ceil(y1);sy++)for(let sx=Math.floor(x0);sx<Math.ceil(x1);sx++){
   const weight=(Math.min(sx+1,x1)-Math.max(sx,x0))*(Math.min(sy+1,y1)-Math.max(sy,y0));
   const at=(sy*source.width+sx)*4,a=source.pixels[at+3]*weight;
   alpha+=a;red+=source.pixels[at]*a;green+=source.pixels[at+1]*a;blue+=source.pixels[at+2]*a;
  }
  const at=((top+y)*width+left+x)*4;pixels.set(alpha?[Math.round(red/alpha),Math.round(green/alpha),Math.round(blue/alpha),Math.round(alpha/((x1-x0)*(y1-y0)))]:[0,0,0,0],at);
 }
}

export async function reviewContactSheet({aspect,frames,load,sampleKind='reading_holds'}){
 if(!['reading_holds','brand_relay_keyposes','beat_choreography_keyposes','motion_keyposes','custom_event_keyposes'].includes(sampleKind))throw Error('REVIEW_SAMPLE_KIND_INVALID');
 if(!['landscape','portrait','feed','square'].includes(aspect)||!Array.isArray(frames)||!frames.length||frames.length>120)throw Error('REVIEW_FRAME_COVERAGE_MISSING');
 const sequence=frames.map(blob=>{
  const match=(sampleKind==='reading_holds'?/\/observation-frames\/(\d+)\.png$/:/\/motion-frames\/(\d+)\.png$/).exec(blob.key);if(!match)throw Error('REVIEW_FRAME_REFERENCE_INVALID');
  return{blob,frame:Number(match[1])};
 }).sort((a,b)=>a.frame-b.frame);
 if(sequence.some((entry,index)=>entry.frame>899||index&&entry.frame===sequence[index-1].frame))throw Error('REVIEW_FRAME_REFERENCE_INVALID');
 const columns=sequence.length<=12?Math.min(2,sequence.length):Math.min(4,Math.ceil(Math.sqrt(sequence.length))),rows=Math.ceil(sequence.length/columns);
 const gap=12,header=24;
 let pixels,width,height,tileWidth,tileHeight,sourceWidth,sourceHeight;
 const tiles=[];
 for(const [index,{blob,frame}]of sequence.entries()){
  const source=pngPixels(await load(blob));
  if(index===0){
   sourceWidth=source.width;sourceHeight=source.height;
   const scale=Math.min(480/sourceWidth,480/sourceHeight,(960-(columns+1)*gap)/(columns*sourceWidth),(1920-(rows+1)*gap-rows*header)/(rows*sourceHeight));
   let a=sourceWidth,b=sourceHeight;while(b){const rest=a%b;a=b;b=rest;}
   const multiple=Math.floor(a*scale);
   tileWidth=multiple?sourceWidth/a*multiple:Math.max(1,Math.floor(sourceWidth*scale));
   tileHeight=multiple?sourceHeight/a*multiple:Math.max(1,Math.floor(sourceHeight*scale));
   width=columns*tileWidth+(columns+1)*gap;height=rows*(tileHeight+header)+(rows+1)*gap;
   pixels=new Uint8Array(width*height*4);for(let at=0;at<pixels.length;at+=4)pixels.set([40,50,61,255],at);
   for(let cell=sequence.length;cell<columns*rows;cell++)label(pixels,width,gap+cell%columns*(tileWidth+gap),gap+Math.floor(cell/columns)*(tileHeight+header+gap)+5,tileWidth,'NO FRAME');
  }
  if(source.width!==sourceWidth||source.height!==sourceHeight)throw Error('REVIEW_FRAME_DIMENSIONS_MIXED');
  const left=gap+index%columns*(tileWidth+gap),top=gap+Math.floor(index/columns)*(tileHeight+header+gap)+header;
  label(pixels,width,left,top-header+5,tileWidth,'FRAME '+frame);
  copyReduced(source,pixels,width,left,top,tileWidth,tileHeight);
  tiles.push({frame,source:blob,left,top,width:tileWidth,height:tileHeight,label:'FRAME '+frame});
 }
 const bytes=pngRgba(width,height,pixels);
 if(bytes.length>1<<20)throw Error('MODEL_IMAGE_TOO_LARGE');
 return{bytes,width,height,tiles,columns,rows,padding:'frame_labels_gutters_and_unlisted_cells_are_review_chrome_not_film_pixels',scope:sampleKind==='reading_holds'?'all_actual_reading_hold_frames_not_per_second_or_full_Q2':sampleKind==='brand_relay_keyposes'?'actual_brand_relay_landings_and_mid_hops_not_full_motion_or_audio_review':sampleKind==='custom_event_keyposes'?'selected_custom_events_and_handoffs_not_full_motion_or_audio_review':sampleKind==='motion_keyposes'?'existing_motion_keyposes_not_full_motion_or_audio_review':'actual_beat_choreography_arrivals_and_transitions_not_full_motion_or_audio_review'};
}

/** Keep the most useful actual frames of the hardest custom scene readable in one model image.
 * Missing requested frames stay visible in the selection record; never invent image evidence. */
export function selectCustomMotionFrames(frames,film,quality){
 const custom=film.scenes.filter(scene=>scene.kind==='custom').sort((a,b)=>Number(b.params.hardest===true)-Number(a.params.hardest===true));
 if(!custom.length)return null;
 const scene=custom[0],stride=quality==='review'?2:1,align=frame=>Math.floor(frame/stride)*stride;
 const valid=frame=>frame>=0&&frame<film.totalFrames;
 const events=[...scene.params.events].sort((a,b)=>a.frame-b.frame);
 const anchors=[scene.start-2,scene.start,scene.start+6,...events.slice(0,2).flatMap(event=>[-6,0,6].map(offset=>Math.max(scene.start,Math.min(scene.end-1,scene.start+event.frame+offset)))),scene.end-6,scene.end-1,scene.end].filter(valid).map(align);
 const byFrame=new Map();for(const blob of frames){const match=/\/motion-frames\/(\d+)\.png$/.exec(blob.key);if(!match||byFrame.has(Number(match[1])))throw Error('REVIEW_FRAME_REFERENCE_INVALID');byFrame.set(Number(match[1]),blob);}
 const requested=[...new Set(anchors)],selected=requested.filter(frame=>byFrame.has(frame));
 const remaining=[...byFrame.keys()].filter(frame=>frame>=scene.start&&frame<scene.end&&!selected.includes(frame)).sort((a,b)=>a-b);
 while(selected.length<12&&remaining.length){const index=Math.floor(remaining.length/2);selected.push(remaining.splice(index,1)[0]);}
 selected.sort((a,b)=>a-b);
 return {sceneId:scene.id,frames:selected.map(frame=>byFrame.get(frame)),requested,missing:requested.filter(frame=>!byFrame.has(frame)),scope:'first_two_events_and_scene_handoffs_actual_frames_only'};
}
