import {readFileSync} from 'node:fs';
import {canonical,createSchemaValidator,parseCanonicalJson} from '@promobento/contracts';
import {checkedRegions} from '@promobento/composition-runtime';

export const ADMISSION_DRAW_MAX_BYTES=1024*1024;
export const ADMISSION_DRAW_MAX_POINTS=16384;
const schema=parseCanonicalJson(readFileSync(new URL('../../../contracts/admission-commands.schema.json',import.meta.url)));
const validateSchema=createSchemaValidator(schema);

/** This boundary accepts data, never browser commands, markup, URLs or script text. */
export function validateAdmissionDraw(value,{width,height,declarations={regions:[]}}) {
  if (![width,height].every(dimension=>Number.isSafeInteger(dimension)&&dimension>0&&dimension<=4096))
    throw new Error('ADMISSION_CANVAS_DIMENSIONS_INVALID');
  if (typeof value==='string' || value instanceof Uint8Array) {
    if (Buffer.byteLength(value)>ADMISSION_DRAW_MAX_BYTES) throw new Error('ADMISSION_DRAW_TOO_LARGE');
    value=parseCanonicalJson(value);
  }
  const errors=validateSchema(value);
  if(errors.length)throw new Error('ADMISSION_DRAW_INVALID: '+errors.slice(0,8).join('; '));
  const bytes=canonical(value);
  if(Buffer.byteLength(bytes)>ADMISSION_DRAW_MAX_BYTES)throw new Error('ADMISSION_DRAW_TOO_LARGE');
  const result=parseCanonicalJson(bytes),limit=4*Math.max(width,height);
  let points=0;
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
    }
  }
  if(points>ADMISSION_DRAW_MAX_POINTS)throw new Error('ADMISSION_DRAW_TOO_MANY_POINTS');
  result.regions=checkedRegions(result.regions??[],declarations.regions,width,height);
  return result;
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
