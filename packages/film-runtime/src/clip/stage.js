// Scene-local adaptation of huashu-motion@52467f99 runtime/clip/clip.js.
// Internal building block: facts, assets, fonts and the eventual drawn text must
// be admitted and observed by the caller before any template is delivered.
import {createGrammar} from './grammars/index.js';
import {createClipHelpers} from './helpers.js';

export function createClipStage(spec,{width:W,height:H,images={},fontFamily}){
 if(!spec||typeof spec!=='object'||!Number.isFinite(spec.duration)||spec.duration<=0||spec.duration>30
  ||spec.fps!==undefined&&spec.fps!==30||![W,H].every(n=>Number.isInteger(n)&&n>0&&n<=4096)
  ||!Array.isArray(spec.cues)||!spec.data||typeof spec.data!=='object'||Array.isArray(spec.data))throw Error('CLIP_SPEC_INVALID');
 const safe={top:0,bottom:0,left:0,right:0,...spec.safe};
 if(!['top','bottom','left','right'].every(k=>Number.isFinite(safe[k])&&safe[k]>=0)
  ||safe.left+safe.right>=W||safe.top+safe.bottom>=H)throw Error('CLIP_SAFE_INVALID');
 const cues=spec.cues.map((q,i)=>{
  if(!q||typeof q!=='object'||!Number.isFinite(q.at)||q.at<0||q.at>spec.duration||typeof q.kind!=='string')throw Error('CLIP_CUE_INVALID');
  return {...q,i};
 }).sort((a,b)=>a.at-b.at||a.i-b.i);
 for(const q of cues)if(q.kind==='number'){
  const caption=q.text??q.sub??q.data?.text;if(caption!=null){q.text=caption;q.sub=caption;}
 }
 let hits=new Map();
 // The image-only keynote uses a fixed CPU Canvas path for cold/forward/reverse
 // seeks; its glass and gradient layers otherwise differ by one channel level.
 const helpers=createClipHelpers(spec.grammar==='t2_keynote_ui'&&spec.data.imageOnly?{forceCpuCanvas:true}:{});helpers.U.setStage(W,H);
 const clip={
  helpers,
  lt:(t,at,fps)=>t-at+1/fps,
  p:(t,at,duration,fps)=>Math.max(0,Math.min(1,(t-at+1/fps)/duration)),
  fit:(iw,ih,bx,by,bw,bh)=>{const s=Math.min(bw/iw,bh/ih),w=iw*s,h=ih*s;return{x:bx+(bw-w)/2,y:by+(bh-h)/2,w,h,s};},
  sub:(r,box)=>({x:box.x+r[0]*box.w,y:box.y+r[1]*box.h,w:r[2]*box.w,h:r[3]*box.h}),
  text:(cue,...fallback)=>(cue&&(cue.text??cue.data?.text))??fallback.find(v=>v!=null)??'',
  beats:(items,name)=>{const counts={};return items.map(q=>{const base=name(q);if(!base)return null;
   counts[base]=(counts[base]||0)+1;return{id:base==='title'&&counts[base]===1?'title':`${base}-${counts[base]}`,at:q.at};}).filter(Boolean);},
  rid:(base,i)=>`${base}-${i}`,
  mark:(c,id,x,y,w,h)=>{if(!(w>0&&h>0))return;const m=c.getTransform(),xs=[],ys=[];
   for(const [px,py]of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){xs.push(m.a*px+m.c*py+m.e);ys.push(m.b*px+m.d*py+m.f);}
   let x0=Math.min(...xs),y0=Math.min(...ys),x1=Math.max(...xs),y1=Math.max(...ys);const old=hits.get(id);
   if(old){x0=Math.min(x0,old[0]);y0=Math.min(y0,old[1]);x1=Math.max(x1,old[0]+old[2]);y1=Math.max(y1,old[1]+old[3]);}
   hits.set(id,[x0,y0,x1-x0,y1-y0]);}
 };
 const ctx={spec,data:spec.data,theme:spec.theme||{},cues,W,H,FPS:30,u:Math.min(W,H)/1080,portrait:H>W,alpha:!!spec.alpha,IMG:images,...(fontFamily?{fontFamily}:{}),
  dur:spec.duration,safe,box:{x:safe.left,y:safe.top,w:W-safe.left-safe.right,h:H-safe.top-safe.bottom},
  of:(...kinds)=>cues.filter(q=>kinds.includes(q.kind)),lt:(t,at)=>clip.lt(t,at,30),p:(t,at,d)=>clip.p(t,at,d,30)};
 const grammar=createGrammar(spec.grammar,clip);
 grammar.init?.(ctx);
 return{
  scenes:()=>grammar.scenes?.(ctx)??[],regions:()=>grammar.regions?.(ctx)??[],
  draw(c,t){if(!Number.isFinite(t)||t<0||t>spec.duration)throw Error('CLIP_TIME_INVALID');hits=new Map();
   c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);c.save();try{grammar.draw(c,t,ctx);}finally{c.restore();}
   if(safe.fill&&!ctx.alpha){c.save();try{c.setTransform(1,0,0,1,0,0);c.fillStyle=safe.fill;
    if(safe.top)c.fillRect(0,0,W,safe.top);if(safe.bottom)c.fillRect(0,H-safe.bottom,W,safe.bottom);
    if(safe.left)c.fillRect(0,0,safe.left,H);if(safe.right)c.fillRect(W-safe.right,0,safe.right,H);
   }finally{c.restore();}}
  },
  // Interactive geometry only; these author-supplied boxes do not attest text visibility.
  hit:(id)=>hits.get(id)??null
 };
}
