import type {SceneContext,CanvasTextTrace} from '../../../contracts/film-runtime.d.ts';
import {createClipStage} from '../../film-runtime/src/clip/stage.js';
import {blockEvents} from './events.mjs';
import {boundCanvasPair,type CanvasTitleTrace} from './canvas-title.ts';
import {assertCanvasTitle,assertCanvasSubtitle} from './canvas-title-validate.ts';

type Page={textSlot:string;subtitleSlot:string;startFrame:number};
// Fixed y5 paths only: the author never receives the Canvas text primitive.
function buildCanvasSubtitles(ctx:SceneContext,items:Page[],id:'canvas-subtitle'|'canvas-subtitle-sequence'){
 const display=ctx.style.type.display,body=ctx.style.type.text;
 const pages=items.map(item=>{
  if(item.textSlot===item.subtitleSlot)throw Error('CANVAS_SUBTITLE_SLOTS_INVALID');
  const title=ctx.text(item.textSlot),subtitle=ctx.text(item.subtitleSlot);
  assertCanvasTitle(title.text,title.role,display.style);assertCanvasSubtitle(subtitle.text,subtitle.role,body.style);
  return{...item,title,subtitle};
 });
 const events=blockEvents(id,ctx.frames,id==='canvas-subtitle'?{textSlot:items[0]!.textSlot,subtitleSlot:items[0]!.subtitleSlot}:{items});
 const selected=(time:number)=>Math.max(0,items.findLastIndex(item=>item.startFrame<=time*30+1e-6));
 let current=0,expected={title:pages[0]!.title.text,subtitle:pages[0]!.subtitle.text};
 const titleFamily=`PBC-${display.fontId}-${display.weight}`,bodyFamily=`PBC-${body.fontId}-${body.weight}`;
 const canvas=document.createElement('canvas');canvas.width=ctx.target.width;canvas.height=ctx.target.height;
 Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});ctx.root.append(canvas);
 const paint=canvas.getContext('2d');if(!paint)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
 const clean=['title','subtitle'].map(()=>{const element=document.createElement('canvas');element.width=canvas.width;element.height=canvas.height;
  const context=element.getContext('2d');if(!context)throw Error('IMAGE_CONTEXT_UNAVAILABLE');return{element,context};});
 const probe=(slotId:string,text:string)=>{const span=document.createElement('span');span.dataset.pbCanvasSlot=slotId;span.textContent=text;
  Object.assign(span.style,{position:'absolute',left:'-10000px',top:'0',visibility:'hidden',whiteSpace:'pre',pointerEvents:'none'});ctx.root.append(span);return span;};
 const probes={title:probe(pages[0]!.textSlot,expected.title),subtitle:probe(pages[0]!.subtitleSlot,expected.subtitle)};
 const blank=():CanvasTitleTrace=>({boxes:[],fontSize:0,alpha:0,draws:0,font:'',letterSpacing:'0px'});
 let traces:{title:CanvasTitleTrace;subtitle:CanvasTitleTrace}|undefined,lastTime:number|undefined;
 let stage:ReturnType<typeof createClipStage>|undefined,active:ReturnType<typeof boundCanvasPair>|undefined;
 const ready=Promise.all([[titleFamily,pages.map(page=>page.title.text).join('')],[bodyFamily,pages.map(page=>page.subtitle.text).join('')]].map(async([family,text])=>{
  const faces=await document.fonts.load(`normal 400 36px "${family}"`,text);if(!faces.length||faces.some(face=>face.status!=='loaded'))throw Error('CANVAS_TITLE_FONT_UNAVAILABLE');
 })).then(()=>{const inset=ctx.target.safeInsets;
  stage=createClipStage({grammar:'y5_kinetic_type',duration:(ctx.frames.end-ctx.frames.start)/30,
   safe:{left:inset.left*canvas.width,right:inset.right*canvas.width,top:inset.top*canvas.height,bottom:inset.bottom*canvas.height},
   data:{safeText:true,safeSubtitle:true,boundTogether:true,palette:[[ctx.style.palette.bg!,ctx.style.palette.ink!]]},
   cues:pages.map(page=>({kind:'title',at:page.startFrame/30,text:page.title.text,sub:page.subtitle.text}))},{width:canvas.width,height:canvas.height,fontFamily:titleFamily,subtitleFontFamily:bodyFamily,
    textPart(part,draw){if(!active)throw Error('CANVAS_TEXT_BINDING_MISMATCH');active.tag(part,draw);}});
 });
 const metadata=(part:'title'|'subtitle'):CanvasTextTrace=>{
  if(!traces||lastTime===undefined)throw Error('CANVAS_TEXT_PROOF_UNAVAILABLE');const value=traces[part],face=part==='title'?display:body,page=pages[current]!;
  return{slotId:part==='title'?page.textSlot:page.subtitleSlot,text:expected[part],fontId:face.fontId,weight:face.weight,style:'normal',
   boxes:value.boxes.map(box=>({...box})),fontSize:value.fontSize,alpha:value.alpha};
 };
 const draw=(context:CanvasRenderingContext2D,time:number,suppressed?:'title'|'subtitle')=>{
  const next={title:blank(),subtitle:blank()},pair=boundCanvasPair(context,expected,{title:suppressed==='title'?null:next.title,subtitle:suppressed==='subtitle'?null:next.subtitle});
  if(!stage)throw Error('CLIP_NOT_READY');active=pair;try{stage.draw(pair.canvas,time);pair.finish();}finally{active=undefined;}return next;
 };
 const region=(part:'title'|'subtitle',regionId:string)=>({regionId,boxAt(){
  if(part==='subtitle'&&(lastTime===undefined||lastTime-pages[current]!.startFrame/30<.8))return null;
  const boxes=traces?.[part].boxes;if(!boxes?.length)return null;
  const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y));
  return{x,y,width:Math.max(...boxes.map(box=>box.x+box.width))-x,height:Math.max(...boxes.map(box=>box.y+box.height))-y};
 }});
 return{ready,render(time:number){current=selected(time);const page=pages[current]!;expected={title:page.title.text,subtitle:page.subtitle.text};
   probes.title.dataset.pbCanvasSlot=page.textSlot;probes.title.textContent=expected.title;probes.subtitle.dataset.pbCanvasSlot=page.subtitleSlot;probes.subtitle.textContent=expected.subtitle;
   traces=draw(paint,time);lastTime=time;
   for(const part of ['title','subtitle'] as const){const value=traces[part];if(!value.boxes.length)throw Error('CANVAS_TEXT_NOT_DRAWN');
    probes[part].style.font=value.font;probes[part].style.letterSpacing=value.letterSpacing;}
  },canvasTextTrace(){return [metadata('title'),metadata('subtitle')];},
  canvasTextProof(){if(lastTime===undefined)throw Error('CANVAS_TEXT_PROOF_UNAVAILABLE');const withText=canvas.toDataURL('image/png');
   return (['title','subtitle'] as const).map((part,index)=>{draw(clean[index]!.context,lastTime!,part);return{...metadata(part),withText,withoutText:clean[index]!.element.toDataURL('image/png')};});
  },events,regions:[region('title','headline'),region('subtitle','supporting')]};
}
window.PB.defineBlock<{textSlot:string;subtitleSlot:string}>({id:'canvas-subtitle',version:'1.0.0',build:(ctx,params)=>
 buildCanvasSubtitles(ctx,[{...params,startFrame:0}],'canvas-subtitle')});
window.PB.defineBlock<{items:Page[]}>({id:'canvas-subtitle-sequence',version:'1.0.0',build:(ctx,params)=>
 buildCanvasSubtitles(ctx,params.items,'canvas-subtitle-sequence')});
