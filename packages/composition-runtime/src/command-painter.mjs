/** Trusted, bounded Canvas implementation. Adapted from huashu-art-motion
 * util/paint/collage (MIT); see vendor/huashu-motion/CLIP-LICENSE and NOTICE. */
const rng=seed=>{let a=seed>>>0;return()=>{a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};};
const lerp=(a,b,t)=>a+(b-a)*t;
const permutation=(()=>{const random=rng(1337),p=Array.from({length:256},(_,i)=>i);for(let i=255;i>0;i--){const j=Math.floor(random()*(i+1));[p[i],p[j]]=[p[j],p[i]];}return [...p,...p];})();
function noise(x,y) {
  const X=Math.floor(x)&255,Y=Math.floor(y)&255;x-=Math.floor(x);y-=Math.floor(y);
  const fade=t=>t*t*t*(t*(t*6-15)+10),grad=(h,x,y)=>{const u=h&1?x:-x,v=h&2?y:-y;return h&4?u+v*0.5:u*0.5+v;};
  const u=fade(x),v=fade(y),a=permutation[X]+Y,b=permutation[X+1]+Y;
  return lerp(lerp(grad(permutation[a],x,y),grad(permutation[b],x-1,y),u),lerp(grad(permutation[a+1],x,y-1),grad(permutation[b+1],x-1,y-1),u),v);
}
const hex=value=>[1,3,5].map(at=>parseInt(value.slice(at,at+2),16));
/** A fixed 128² tile bounds synthesis cost independently of canvas resolution. */
export function texturePixels({style,color,accent,seed}) {
  const size=128,pixels=new Uint8ClampedArray(size*size*4),base=hex(color),ink=hex(accent),random=rng(seed);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    let mix=0;
    if(style==='paper') {let sum=0,amplitude=0.5,frequency=0.04;for(let octave=0;octave<4;octave++){sum+=amplitude*noise(x*frequency+seed%997,y*frequency);amplitude*=0.5;frequency*=2;}mix=Math.max(0,0.14+sum*0.25+(random()-0.5)*0.08);}
    else if(style==='grain')mix=random()<0.12?random()*0.6:0;
    else if(style==='halftone')mix=Math.hypot(x%8-4,y%8-4)<2.1?1:0;
    else if(style==='mosaic')mix=(x%16===0||y%16===0)?0.8:(noise(Math.floor(x/16)+seed%997,Math.floor(y/16)+0.25)+1)*0.25;
    else if(style==='brush')mix=Math.max(0,noise(x*0.025+seed%997,y*0.33)*0.8+(random()-0.5)*0.12);
    else throw Error('ADMISSION_TEXTURE_STYLE_INVALID');
    const offset=(y*size+x)*4;for(let channel=0;channel<3;channel++)pixels[offset+channel]=lerp(base[channel],ink[channel],mix);pixels[offset+3]=255;
  }
  return {width:size,height:size,pixels};
}
const tiles=new Map(),effects=new Map();
const retain=(cache,key,value)=>{if(cache.size>=32)cache.delete(cache.keys().next().value);cache.set(key,value);return value;};
function texture(command) {
  const key=[command.style,command.color,command.accent,command.seed].join(':');if(tiles.has(key))return tiles.get(key);
  const tile=texturePixels(command),canvas=document.createElement('canvas');canvas.width=tile.width;canvas.height=tile.height;
  canvas.getContext('2d').putImageData(new ImageData(tile.pixels,tile.width,tile.height),0,0);return retain(tiles,key,canvas);
}
export function beginCommand(context,command) {
  context.save();if(command.transform)context.transform(...command.transform);
  context.globalAlpha=command.opacity;
  if(command.clip){const {x,y,width,height,radius}=command.clip;context.beginPath();if(radius)context.roundRect(x,y,width,height,radius);else context.rect(x,y,width,height);context.clip();}
  let fill=command.color??'#000000';
  if(command.gradient) {
    const g=command.gradient;
    fill=g.kind==='linear'?context.createLinearGradient(g.x0,g.y0,g.x1,g.y1):context.createRadialGradient(g.x0,g.y0,g.r0,g.x1,g.y1,g.r1);
    for(const stop of g.stops)fill.addColorStop(stop.offset,stop.color);
  }
  context.fillStyle=fill;
  if(command.stroke) {
    const stroke=command.stroke;context.strokeStyle=stroke.color;context.lineWidth=stroke.width;
    context.lineCap=stroke.cap??'butt';context.lineJoin=stroke.join??'round';context.miterLimit=4;
    context.setLineDash(stroke.dash??[]);context.lineDashOffset=stroke.dashOffset??0;
  }
}
export function paintGeometryCommand(context,command) {
  if(command.op==='texture') {
    const pattern=context.createPattern(texture(command),'repeat'),scale=command.scale??1;
    pattern.setTransform(new DOMMatrix([scale,0,0,scale,command.x,command.y]));context.fillStyle=pattern;
    context.fillRect(command.x,command.y,command.width,command.height);return;
  }
  context.beginPath();
  if(command.op==='rect'){if(command.radius)context.roundRect(command.x,command.y,command.width,command.height,command.radius);else context.rect(command.x,command.y,command.width,command.height);}
  else if(command.op==='circle')context.arc(command.x,command.y,command.radius,0,Math.PI*2);
  else if(command.op==='polygon'){command.points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath();}
  else if(command.op==='path')for(const s of command.segments) {
    if(s.kind==='move')context.moveTo(s.x,s.y);else if(s.kind==='line')context.lineTo(s.x,s.y);
    else if(s.kind==='quadratic')context.quadraticCurveTo(s.cx,s.cy,s.x,s.y);
    else if(s.kind==='cubic')context.bezierCurveTo(s.cx1,s.cy1,s.cx2,s.cy2,s.x,s.y);else if(s.kind==='close')context.closePath();
  }
  else throw Error('ADMISSION_DRAW_OPERATION_INVALID');
  if(command.fill!==false)context.fill();if(command.stroke)context.stroke();
}
/** Source-image colour sampling at a maximum 256² raster. Cell count <=4096,
 * fixed seeded jitter; no animation history and no per-frame pixel feedback. */
export function artisticImage(image,key,effect) {
  if(!effect)return image;
  const identity=[key,effect.style,effect.cell,effect.seed].join(':');if(effects.has(identity))return effects.get(identity);
  const scale=Math.min(1,256/Math.max(image.width,image.height)),w=Math.max(1,Math.round(image.width*scale)),h=Math.max(1,Math.round(image.height*scale));
  const source=document.createElement('canvas');source.width=w;source.height=h;const s=source.getContext('2d');s.drawImage(image,0,0,w,h);
  const pixels=s.getImageData(0,0,w,h).data,out=document.createElement('canvas');out.width=w;out.height=h;const c=out.getContext('2d'),random=rng(effect.seed),cell=effect.cell;
  c.fillStyle=effect.style==='mosaic'?'#3b352e':'#f4ecd8';c.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=cell)for(let x=0;x<w;x+=cell) {
    const sx=Math.min(w-1,Math.floor(x+cell/2)),sy=Math.min(h-1,Math.floor(y+cell/2)),i=(sy*w+sx)*4;
    const rgb=[pixels[i],pixels[i+1],pixels[i+2]],colour='rgb('+rgb.join(',')+')';
    if(effect.style==='halftone') {
      const luma=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;c.fillStyle='#1b1b1b';c.beginPath();c.arc(x+cell/2,y+cell/2,Math.sqrt(1-luma)*cell*0.5,0,Math.PI*2);c.fill();
    } else if(effect.style==='mosaic'){c.fillStyle=colour;const jitter=(random()-0.5)*cell*0.15;c.fillRect(x+1+jitter,y+1,cell-1.5,cell-1.5);}
    else if(effect.style==='brush'){c.strokeStyle=colour;c.lineWidth=cell*0.65;c.lineCap='round';const jitter=(random()-0.5)*cell;c.beginPath();c.moveTo(x+jitter,y+cell);c.lineTo(x+cell+jitter,y-cell*0.25);c.stroke();}
    else throw Error('ADMISSION_IMAGE_EFFECT_INVALID');
  }
  return retain(effects,identity,out);
}
export function paintCommandImage(context,image,command) {
  const c=command.crop??{x:0,y:0,width:1,height:1};
  context.drawImage(image,c.x*image.width,c.y*image.height,c.width*image.width,c.height*image.height,command.x,command.y,command.width,command.height);
}
