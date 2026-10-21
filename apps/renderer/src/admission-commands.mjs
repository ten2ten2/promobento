import {readFileSync} from 'node:fs';
import {canonical,createSchemaValidator,parseCanonicalJson,targets} from '@promobento/contracts';
import {checkedRegions} from '@promobento/composition-runtime';
import {admissionTextMeasurement} from './admission-fonts.mjs';

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
  let points=0,glyphCount=0;const textIds=new Set();
  for(const command of result.commands) {
    if(command.op==='polygon') {
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
        const metrics=admissionTextMeasurement(declarations,command.fontId,command.text,command.fontSize,command.weight);
        glyphCount+=metrics.glyphs.length;
        if(metrics.width>command.width+0.001||metrics.ascent+metrics.descent>command.height+0.001)throw Error('ADMISSION_TEXT_OVERFLOW');
        if(command.opacity>0&&(command.x<0||command.y<0||command.x+command.width>width||command.y+command.height>height))throw Error('ADMISSION_TEXT_OUT_OF_BOUNDS');
        const safe=target.layout.safeInsets;
        if(command.opacity>0&&command.text&&(command.x<safe.left*width||command.y<safe.top*height
          ||command.x+metrics.width>(1-safe.right)*width||command.y+metrics.ascent+metrics.descent>(1-safe.bottom)*height))
          throw Error('ADMISSION_TEXT_OUTSIDE_SAFE_AREA');
      } else if(command.op==='image') {
        if(!['screen-still','screen-detail'].includes(command.resourceId)||!resourceRequest?.resourceIds.includes(command.resourceId))throw Error('ADMISSION_IMAGE_UNAUTHORIZED');
      } else if(command.op==='video'&&!declarations.videoUses.some(use=>use.id===command.useId))throw Error('ADMISSION_VIDEO_UNAUTHORIZED');
    }
  }
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
