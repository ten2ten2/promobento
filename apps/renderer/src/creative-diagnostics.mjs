// Adapted from huashu-motion qa.js / swatch.js; see creative-tools-NOTICE.md.
import {execFileSync} from 'node:child_process';

export const creativeQaPolicy=Object.freeze({version:'creative-qa-v1',width:96,height:54,fps:30,
  popDifference:6,cutDifference:14,stillDifference:0.25,stillFrames:30});

/** Editorial findings, not a factual/safety verdict. Frame indexes refer to the decoded delivery. */
export function motionDiagnostics(frames,{width=96,height=54,fps=30}={}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>5184||fps!==30
    ||!Array.isArray(frames)||frames.length<2||frames.length>900
    ||frames.some(frame=>!(frame instanceof Uint8Array)||frame.length!==width*height))throw Error('CREATIVE_QA_INPUT_INVALID');
  const difference=(a,b)=>a.reduce((sum,value,i)=>sum+Math.abs(value-b[i]),0)/a.length;
  const differences=frames.slice(1).map((frame,i)=>difference(frame,frames[i]));
  const pops=[],cuts=[],stillSpans=[];
  for(let i=1;i<frames.length-1;i++) {
    const before=differences[i-1],after=differences[i];
    if(before>6&&after>6&&difference(frames[i-1],frames[i+1])<Math.min(before,after)/3)pops.push(i);
  }
  const median=items=>{const values=[...items].sort((a,b)=>a-b);return values[Math.floor(values.length/2)]??0;};
  for(let i=0;i<differences.length;i++) {
    const background=median([...differences.slice(Math.max(0,i-6),i),...differences.slice(i+1,i+7)]);
    if(differences[i]>14&&differences[i]>4*(background+1)&&!pops.some(frame=>Math.abs(frame-(i+1))<=2))cuts.push(i+1);
  }
  let start=null;
  for(let i=0;i<=differences.length;i++) {
    if(i<differences.length&&differences[i]<0.25){start??=i;continue;}
    if(start!==null&&i-start+1>=30)stillSpans.push({frameStart:start,frameEndExclusive:i+1});
    start=null;
  }
  const curve=Array.from({length:Math.ceil(frames.length/fps)},(_,second)=>{
    const values=differences.slice(second*fps,(second+1)*fps);
    return {frameStart:second*fps,meanDifference:values.length?values.reduce((a,b)=>a+b,0)/values.length:0};
  });
  const mean=differences.reduce((a,b)=>a+b,0)/differences.length;
  return {version:creativeQaPolicy.version,source:'decoded_delivery_luma',width,height,fps,frameCount:frames.length,
    policy:creativeQaPolicy,disposition:'editorial_review',pops,cuts,stillSpans,motionCurve:curve,
    meanDifference:mean,motionContrast:Math.sqrt(differences.reduce((sum,x)=>sum+(x-mean)**2,0)/differences.length),
    loopDifference:difference(frames[0],frames.at(-1)),
    interpretation:'Still holds and hard cuts can be intentional; these findings do not block admission.'};
}

/** Trusted encoded output only. This is called inside the capture container. */
export function inspectMotion(video,frameCount) {
  if(![450,900].includes(frameCount))throw Error('CREATIVE_QA_FRAME_COUNT');
  const size=96*54;
  const bytes=execFileSync('/usr/bin/ffmpeg',['-v','error','-nostdin','-threads','1','-i',video,
    '-map','0:v:0','-filter_threads','1','-vf','scale=96:54:flags=area,format=gray','-fps_mode','passthrough',
    '-frames:v',String(frameCount+1),'-threads','1','-f','rawvideo','pipe:1'],
  {timeout:30000,killSignal:'SIGKILL',maxBuffer:size*(frameCount+1)});
  if(bytes.length!==size*frameCount)throw Error('CREATIVE_QA_DECODE_COUNT');
  return motionDiagnostics(Array.from({length:frameCount},(_,i)=>bytes.subarray(i*size,(i+1)*size)));
}

function colour(hex) {
  if(typeof hex!=='string'||!/^#[a-f0-9]{6}$/iu.test(hex))throw Error('PALETTE_COLOUR_INVALID');
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;
  const hue=d===0?0:((max===rgb[0]?(rgb[1]-rgb[2])/d+(rgb[1]<rgb[2]?6:0):max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4)*60);
  const light=(min+max)/2,saturation=d===0?0:d/(1-Math.abs(2*light-1));
  const linear=rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  return {hex:hex.toUpperCase(),hue,saturation,light,luminance:linear[0]*.2126+linear[1]*.7152+linear[2]*.0722};
}

/** Ordered swatches only; no inferred foreground/background roles or text-contrast claims. */
export function paletteDiagnostics(palettes) {
  if(!Array.isArray(palettes)||!palettes.length||palettes.length>20
    ||palettes.some(p=>typeof p.id!=='string'||!p.id||p.id.length>128||!Array.isArray(p.colors)||!p.colors.length||p.colors.length>12)
    ||new Set(palettes.map(p=>p.id)).size!==palettes.length)throw Error('PALETTE_INPUT_INVALID');
  const items=palettes.map(p=>({id:p.id,colors:p.colors.map(colour)})),findings=[];
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++) {
    const a=items[i],b=items[j],common=a.colors.filter(x=>b.colors.some(y=>y.hex===x.hex)).length;
    if(common/Math.max(a.colors.length,b.colors.length)>=.75)findings.push({code:'SHARED_SWATCHES',ids:[a.id,b.id],common});
  }
  if(items.length>1&&items.every(p=>p.colors.some(c=>c.saturation>.35&&(c.hue<55||c.hue>340))))
    findings.push({code:'WARM_ACCENT_REPEATED',ids:items.map(p=>p.id)});
  return {version:'palette-review-v1',palettes:items,findings,disposition:'editorial_review'};
}
