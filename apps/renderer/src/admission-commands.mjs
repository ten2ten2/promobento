import {readFileSync} from 'node:fs';
import {canonical,createSchemaValidator,parseCanonicalJson,targets} from '@promobento/contracts';
import {checkedRegions} from '@promobento/composition-runtime';
import {admissionTextMeasurement} from './admission-fonts.mjs';
import {transformedBox,clipContainsBox} from '../../../packages/composition-runtime/src/command-geometry.mjs';

export const ADMISSION_DRAW_MAX_BYTES=1024*1024;
export const ADMISSION_DRAW_MAX_POINTS=16384;
const schema=parseCanonicalJson(readFileSync(new URL('../../../contracts/admission-commands.schema.json',import.meta.url)));
const validateSchema=createSchemaValidator(schema);
const validateMediaSchema=createSchemaValidator(parseCanonicalJson(readFileSync(new URL('../../../contracts/admission-media-commands.schema.json',import.meta.url))));
const platformTargets=targets(parseCanonicalJson(readFileSync(new URL('../../../config/platform-presets.json',import.meta.url))));

/** This boundary accepts data, never browser commands, markup, URLs or script text. */
export function validateAdmissionDraw(value,{width,height,targetId,declarations={regions:[]},profile='canvas-commands-v1',resourceRequest}) {
  if (![width,height].every(dimension=>Number.isSafeInteger(dimension)&&dimension>0&&dimension<=4096))
    throw new Error('ADMISSION_CANVAS_DIMENSIONS_INVALID');
  if (typeof value==='string' || value instanceof Uint8Array) {
    if (Buffer.byteLength(value)>ADMISSION_DRAW_MAX_BYTES) throw new Error('ADMISSION_DRAW_TOO_LARGE');
    value=parseCanonicalJson(value);
  }
  if(!['canvas-commands-v1','canvas-media-v1'].includes(profile))throw Error('ADMISSION_PROFILE_INVALID');
  const target=profile==='canvas-media-v1'?platformTargets.find(item=>item.targetId===targetId):null;
  if(profile==='canvas-media-v1'&&(!target||target.layout.width!==width||target.layout.height!==height))throw Error('ADMISSION_TARGET_INVALID');
  const errors=(profile==='canvas-media-v1'?validateMediaSchema:validateSchema)(value);
  if(errors.length)throw new Error('ADMISSION_DRAW_INVALID: '+errors.slice(0,8).join('; '));
  const bytes=canonical(value);
  if(Buffer.byteLength(bytes)>ADMISSION_DRAW_MAX_BYTES)throw new Error('ADMISSION_DRAW_TOO_LARGE');
  const result=parseCanonicalJson(bytes),limit=4*Math.max(width,height);
  let points=0,glyphCount=0,textures=0,textureArea=0;const textIds=new Set();
  for(const command of result.commands) {
    if(command.transform) {
      const [a,b,c,d]=command.transform;
      if([a,b,c,d].some(value=>Math.abs(value)>64)||Math.abs(a*d-b*c)<0.000001)throw Error('ADMISSION_TRANSFORM_INVALID');
    }
    if(command.clip) {
      const clip=command.clip;
      if((clip.radius??0)>Math.min(clip.width,clip.height)/2||Math.abs(clip.x)>limit||Math.abs(clip.y)>limit||clip.width>limit||clip.height>limit)throw Error('ADMISSION_CLIP_INVALID');
    }
    if(command.gradient) {
      const g=command.gradient;
      if(g.kind==='radial'&&(g.r0===undefined||g.r1===undefined||g.r1<=g.r0))throw Error('ADMISSION_GRADIENT_INVALID');
      if(g.kind==='linear'&&(g.r0!==undefined||g.r1!==undefined||(g.x0===g.x1&&g.y0===g.y1)))throw Error('ADMISSION_GRADIENT_INVALID');
      if(g.stops.some((stop,i)=>i&&stop.offset<g.stops[i-1].offset))throw Error('ADMISSION_GRADIENT_INVALID');
    }
    if(command.stroke?.dash?.length&&command.stroke.dash.every(value=>value===0))throw Error('ADMISSION_STROKE_INVALID');
    if(command.crop&&(command.crop.x+command.crop.width>1||command.crop.y+command.crop.height>1))throw Error('ADMISSION_CROP_INVALID');
    if(command.op==='texture') {textures++;textureArea+=command.width*command.height;}
    if(command.op==='path') {
      if(command.segments[0].kind!=='move')throw Error('ADMISSION_PATH_INVALID');
      for(const segment of command.segments)for(const [key,value] of Object.entries(segment))if(key!=='kind') {
        points+=0.5;if(Math.abs(value)>limit)throw Error('ADMISSION_GEOMETRY_OUT_OF_RANGE');
      }
    } else if(command.op==='polygon') {
      points+=command.points.length;
      if(command.points.some(point=>Math.abs(point.x)>limit||Math.abs(point.y)>limit))
        throw new Error('ADMISSION_GEOMETRY_OUT_OF_RANGE');
    } else {
      if(Math.abs(command.x)>limit||Math.abs(command.y)>limit
        || ['width','height','radius'].some(key=>command[key]!==undefined&&command[key]>limit))
        throw new Error('ADMISSION_GEOMETRY_OUT_OF_RANGE');
      if(command.op==='rect' && (command.radius??0)>Math.min(command.width,command.height)/2)
        throw new Error('ADMISSION_CORNER_RADIUS_INVALID');
      if(command.op==='text') {
        if(textIds.has(command.id))throw Error('ADMISSION_TEXT_ID_DUPLICATE');textIds.add(command.id);
        const metrics=admissionTextMeasurement(declarations,command.fontId,command.text,command.fontSize,command.weight,
          command.layout?{...command.layout,width:command.width}:undefined);
        glyphCount+=metrics.glyphs.length;
        if(metrics.width>command.width+0.001||metrics.height>command.height+0.001)throw Error('ADMISSION_TEXT_OVERFLOW');
        const box=transformedBox(command.transform,command),safe=target.layout.safeInsets;
        if(command.opacity>0&&(box.x<0||box.y<0||box.x+box.width>width||box.y+box.height>height))throw Error('ADMISSION_TEXT_OUT_OF_BOUNDS');
        const local={x:command.x+Math.min(0,...metrics.glyphs.map(glyph=>glyph.x)),y:command.y,
          width:Math.max(0,...metrics.glyphs.map(glyph=>glyph.x+glyph.advance)),height:metrics.height};
        if(command.opacity>0&&command.text&&!clipContainsBox(command.clip,local))throw Error('ADMISSION_TEXT_CLIPPED');
        const actual=transformedBox(command.transform,local);
        if(command.opacity>0&&command.text&&(actual.x<safe.left*width||actual.y<safe.top*height
          ||actual.x+actual.width>(1-safe.right)*width||actual.y+actual.height>(1-safe.bottom)*height))
          throw Error('ADMISSION_TEXT_OUTSIDE_SAFE_AREA');
      } else if(command.op==='image') {
        if(!['screen-still','screen-detail'].includes(command.resourceId)||!resourceRequest?.resourceIds.includes(command.resourceId))throw Error('ADMISSION_IMAGE_UNAUTHORIZED');
      } else if(command.op==='video'&&!declarations.videoUses.some(use=>use.id===command.useId))throw Error('ADMISSION_VIDEO_UNAUTHORIZED');
    }
  }
  if(textures>16||textureArea>width*height*4)throw Error('ADMISSION_TEXTURE_BUDGET');
  if(points>ADMISSION_DRAW_MAX_POINTS)throw new Error('ADMISSION_DRAW_TOO_MANY_POINTS');
  if(glyphCount>16384)throw Error('ADMISSION_DRAW_TOO_MANY_GLYPHS');
  result.regions=checkedRegions(result.regions??[],declarations.regions,width,height);
  return result;
}

/** Browser-observed ink is checked as well as pure advance metrics: glyph
 * hinting/overhang must not turn a nominally safe layout into unsafe output. */
export function validateAdmissionTextInk(observation,{targetId,width,height}) {
  const target=platformTargets.find(item=>item.targetId===targetId);
  if(!target||target.layout.width!==width||target.layout.height!==height)throw Error('ADMISSION_TARGET_INVALID');
  const safe=target.layout.safeInsets;
  for(const {ink} of observation.texts) {
    if(!ink||![ink.left,ink.top,ink.right,ink.bottom].every(Number.isFinite)
      ||ink.left>ink.right||ink.top>ink.bottom)throw Error('ADMISSION_TEXT_INK_INVALID');
    if(ink.left<safe.left*width||ink.top<safe.top*height
      ||ink.right>(1-safe.right)*width||ink.bottom>(1-safe.bottom)*height)
      throw Error('ADMISSION_TEXT_OUTSIDE_SAFE_AREA');
  }
}

/** Serialized by Playwright as trusted code; all candidate content arrives as JSON arguments. */
export function paintAdmissionCanvas({commands,width,height}) {
  const canvas=document.getElementById('admission-canvas');
  // Resizing clears the bitmap, path, transform and all canvas state on every frame.
  canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});
  if(!context)throw new Error('ADMISSION_CANVAS_UNAVAILABLE');
  context.fillStyle='#000000';context.fillRect(0,0,width,height);
  for(const command of commands) {
    context.fillStyle=command.color;context.globalAlpha=command.opacity;
    context.beginPath();
    if(command.op==='rect') {
      if(command.radius)context.roundRect(command.x,command.y,command.width,command.height,command.radius);
      else context.rect(command.x,command.y,command.width,command.height);
    } else if(command.op==='circle')context.arc(command.x,command.y,command.radius,0,Math.PI*2);
    else if(command.op==='polygon') {
      context.moveTo(command.points[0].x,command.points[0].y);
      for(let index=1;index<command.points.length;index++)context.lineTo(command.points[index].x,command.points[index].y);
      context.closePath();
    } else throw new Error('ADMISSION_DRAW_OPERATION_INVALID');
    context.fill();
  }
  context.globalAlpha=1;
  // Screenshot supplies the compositor/readback barrier for synchronous Canvas 2D.
}
