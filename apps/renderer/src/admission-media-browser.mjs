import {createMediaController} from '../../../packages/composition-runtime/src/media.mjs';
import {measureCommandText} from '../../../packages/composition-runtime/src/command-text.mjs';

/** This module is trusted renderer code; the source module is never imported here. */
export async function initializeAdmissionMedia({manifest,declarations,fontMetrics,images}) {
  const controller=await createMediaController({definition:declarations,manifest}),bitmaps=new Map();
  try {
    for(const image of images) {
      const response=await fetch(image.url,{credentials:'omit',cache:'no-store'}),bytes=await response.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      if(!response.ok||hash!==image.sha256||bytes.byteLength!==image.byteLength)throw Error('ADMISSION_IMAGE_HASH_MISMATCH');
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}));
      if(bitmap.width!==image.width||bitmap.height!==image.height){bitmap.close();throw Error('ADMISSION_IMAGE_DIMENSIONS');}
      bitmaps.set(image.id,bitmap);
    }
    globalThis.admissionMedia={controller,images:bitmaps,measure:(command)=>measureCommandText(fontMetrics,declarations.fonts,
      command.fontId,command.text,command.fontSize,command.weight)};
  } catch(error) {controller.dispose();for(const image of bitmaps.values())image.close();throw error;}
}

/** Results describe the actual commands dispatched, measured ink and selected faces. */
export async function paintAdmissionMedia({commands,width,height,frame}) {
  const canvas=document.getElementById('admission-canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'}),media=globalThis.admissionMedia;
  if(!context||!media)throw Error('ADMISSION_MEDIA_UNAVAILABLE');
  context.fillStyle='#000000';context.fillRect(0,0,width,height);
  const texts=[],videos=[],images=[];
  for(const command of commands) {
    context.globalAlpha=command.opacity;context.fillStyle=command.color??'#000000';
    if(command.op==='text') {
      const metrics=media.measure(command),faces=[];let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
      context.textBaseline='alphabetic';context.fontKerning='none';context.textAlign='left';
      for(const glyph of metrics.glyphs) {
        media.controller.fonts.assertText(glyph.fontId,glyph.character,glyph.weight);
        context.font=`${glyph.weight} ${command.fontSize}px ${media.controller.fonts.family(glyph.fontId)}`;
        const measured=context.measureText(glyph.character),x=command.x+glyph.x,y=command.y+metrics.ascent;
        // Native hinting rounds measured advances in the pinned Linux browser.
        // Placement deliberately uses the shared WOFF float advances instead;
        // the actual loaded face's ink bounds, not its hinted pen advance, are QA'd.
        context.fillText(glyph.character,x,y);
        left=Math.min(left,x-measured.actualBoundingBoxLeft);right=Math.max(right,x+measured.actualBoundingBoxRight);
        top=Math.min(top,y-measured.actualBoundingBoxAscent);bottom=Math.max(bottom,y+measured.actualBoundingBoxDescent);
        if(!faces.some(face=>face.sha256===glyph.sha256))faces.push({fontId:glyph.fontId,weight:glyph.weight,sha256:glyph.sha256});
      }
      if(command.opacity>0&&command.text) {
        if(left<command.x-0.02||right>command.x+command.width+0.02||top<command.y-0.02||bottom>command.y+command.height+0.02)
          throw Error('ADMISSION_TEXT_INK_OVERFLOW');
        texts.push({id:command.id,text:command.text,fontId:command.fontId,weight:command.weight,fontSize:command.fontSize,faces,
          bounds:{x:command.x,y:command.y,width:metrics.width,height:metrics.ascent+metrics.descent},ink:{left,top,right,bottom},opacity:command.opacity});
      }
    } else if(command.op==='image') {
      const image=media.images.get(command.resourceId);if(!image)throw Error('ADMISSION_IMAGE_UNAUTHORIZED');
      context.drawImage(image,command.x,command.y,command.width,command.height);images.push(command.resourceId);
    } else if(command.op==='video') {
      const selected=await media.controller.videoFrames.get(command.useId,{numerator:frame,denominator:30});
      context.drawImage(selected.image,command.x,command.y,command.width,command.height);
      videos.push({useId:command.useId,sourceSha256:selected.sourceSha256,sourcePts:selected.sourcePts});
    } else {
      context.beginPath();
      if(command.op==='rect') {
        if(command.radius)context.roundRect(command.x,command.y,command.width,command.height,command.radius);
        else context.rect(command.x,command.y,command.width,command.height);
      } else if(command.op==='circle')context.arc(command.x,command.y,command.radius,0,Math.PI*2);
      else if(command.op==='polygon') {
        context.moveTo(command.points[0].x,command.points[0].y);
        for(const point of command.points.slice(1))context.lineTo(point.x,point.y);context.closePath();
      } else throw Error('ADMISSION_DRAW_OPERATION_INVALID');
      context.fill();
    }
  }
  context.globalAlpha=1;return {texts,videos,images};
}
