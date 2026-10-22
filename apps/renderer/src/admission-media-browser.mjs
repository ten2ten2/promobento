import {createMediaController} from '../../../packages/composition-runtime/src/media.mjs';
import {transformedBox,clipContainsBox} from '../../../packages/composition-runtime/src/command-geometry.mjs';
import {beginCommand,paintGeometryCommand,paintCommandImage,artisticImage} from '../../../packages/composition-runtime/src/command-painter.mjs';
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
    globalThis.admissionMedia={controller,images:bitmaps,imageKeys:new Map(images.map(image=>[image.id,image.sha256])),measure:(command)=>measureCommandText(fontMetrics,declarations.fonts,
      command.fontId,command.text,command.fontSize,command.weight,command.layout?{...command.layout,width:command.width}:undefined)};
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
    beginCommand(context,command);
    try {
      if(command.op==='text') {
        const metrics=media.measure(command),faces=[];let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
        context.textBaseline='alphabetic';context.fontKerning='none';context.textAlign='left';
        for(const glyph of metrics.glyphs) {
          media.controller.fonts.assertText(glyph.fontId,glyph.character,glyph.weight);
          context.font=`${glyph.weight} ${command.fontSize}px ${media.controller.fonts.family(glyph.fontId)}`;
          const measured=context.measureText(glyph.character),x=command.x+glyph.x,y=command.y+glyph.y+metrics.ascent;
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
          if(!clipContainsBox(command.clip,{x:left,y:top,width:right-left,height:bottom-top},0.02))throw Error('ADMISSION_TEXT_INK_CLIPPED');
          const screenInk=transformedBox(command.transform,{x:left,y:top,width:right-left,height:bottom-top});
          texts.push({id:command.id,text:command.text,fontId:command.fontId,weight:command.weight,fontSize:command.fontSize,faces,
            bounds:transformedBox(command.transform,{x:command.x,y:command.y,width:command.layout?command.width:metrics.width,height:metrics.height}),
            ink:{left:screenInk.x,top:screenInk.y,right:screenInk.x+screenInk.width,bottom:screenInk.y+screenInk.height},opacity:command.opacity,
            ...(command.layout?{layout:{...command.layout,lineCount:metrics.lineCount}}:{}),...(command.transform?{transform:command.transform}:{})});
        }
      } else if(command.op==='image') {
        const image=media.images.get(command.resourceId);if(!image)throw Error('ADMISSION_IMAGE_UNAUTHORIZED');
        paintCommandImage(context,artisticImage(image,media.imageKeys.get(command.resourceId),command.effect),command);images.push(command.resourceId);
      } else if(command.op==='video') {
        const selected=await media.controller.videoFrames.get(command.useId,{numerator:frame,denominator:30});
        paintCommandImage(context,selected.image,command);
        videos.push({useId:command.useId,sourceSha256:selected.sourceSha256,sourcePts:selected.sourcePts});
      } else paintGeometryCommand(context,command);
    } finally {context.restore();}
  }
  context.globalAlpha=1;return {texts,videos,images};
}
