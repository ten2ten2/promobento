import type {SceneContext,CanvasTextTrace} from '../../../contracts/film-runtime.d.ts';
import {createClipStage} from '../../film-runtime/src/clip/stage.js';
import {blockEvents} from './events.mjs';
import {boundCanvasPair,type CanvasTitleTrace} from './canvas-title.ts';
import {assertCanvasTitle,assertCanvasSubtitle} from './canvas-title-validate.ts';

// The two text primitives and the grammar tag are private to this fixed block.
// Authored code never receives a Canvas text capability.
window.PB.defineBlock<{textSlot:string;subtitleSlot:string}>({id:'canvas-subtitle',version:'1.0.0',build(ctx:SceneContext,params){
 if(params.textSlot===params.subtitleSlot)throw Error('CANVAS_SUBTITLE_SLOTS_INVALID');
 const title=ctx.text(params.textSlot),subtitle=ctx.text(params.subtitleSlot),display=ctx.style.type.display,body=ctx.style.type.text;
 assertCanvasTitle(title.text,title.role,display.style);assertCanvasSubtitle(subtitle.text,subtitle.role,body.style);
 const titleFamily=`PBC-${display.fontId}-${display.weight}`,bodyFamily=`PBC-${body.fontId}-${body.weight}`;
 const canvas=document.createElement('canvas');canvas.width=ctx.target.width;canvas.height=ctx.target.height;
 Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});ctx.root.append(canvas);
 const paint=canvas.getContext('2d');if(!paint)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
 const clean=['title','subtitle'].map(()=>{const element=document.createElement('canvas');element.width=canvas.width;element.height=canvas.height;
  const context=element.getContext('2d');if(!context)throw Error('IMAGE_CONTEXT_UNAVAILABLE');return{element,context};});
 const probe=(slotId:string,text:string)=>{const span=document.createElement('span');span.dataset.pbCanvasSlot=slotId;span.textContent=text;
  Object.assign(span.style,{position:'absolute',left:'-10000px',top:'0',visibility:'hidden',whiteSpace:'pre',pointerEvents:'none'});ctx.root.append(span);return span;};
 const probes={title:probe(params.textSlot,title.text),subtitle:probe(params.subtitleSlot,subtitle.text)};
 const blank=():CanvasTitleTrace=>({boxes:[],fontSize:0,alpha:0,draws:0,font:'',letterSpacing:'0px'});
 const expected={title:title.text,subtitle:subtitle.text};let traces:{title:CanvasTitleTrace;subtitle:CanvasTitleTrace}|undefined,lastTime:number|undefined;
 let stage:ReturnType<typeof createClipStage>|undefined,active:ReturnType<typeof boundCanvasPair>|undefined;
 const ready=Promise.all([[titleFamily,title.text],[bodyFamily,subtitle.text]].map(async([family,text])=>{
  const faces=await document.fonts.load(`normal 400 36px "${family}"`,text);if(!faces.length||faces.some(face=>face.status!=='loaded'))throw Error('CANVAS_TITLE_FONT_UNAVAILABLE');
 })).then(()=>{const inset=ctx.target.safeInsets;
  stage=createClipStage({grammar:'y5_kinetic_type',duration:(ctx.frames.end-ctx.frames.start)/30,
   safe:{left:inset.left*canvas.width,right:inset.right*canvas.width,top:inset.top*canvas.height,bottom:inset.bottom*canvas.height},
   data:{safeText:true,safeSubtitle:true,boundTogether:true,palette:[[ctx.style.palette.bg!,ctx.style.palette.ink!]]},
   cues:[{kind:'title',at:0,text:title.text,sub:subtitle.text}]},{width:canvas.width,height:canvas.height,fontFamily:titleFamily,subtitleFontFamily:bodyFamily,
    textPart(part,draw){if(!active)throw Error('CANVAS_TEXT_BINDING_MISMATCH');active.tag(part,draw);}});
 });
 const metadata=(part:'title'|'subtitle'):CanvasTextTrace=>{
  if(!traces||lastTime===undefined)throw Error('CANVAS_TEXT_PROOF_UNAVAILABLE');const value=traces[part],face=part==='title'?display:body;
  return{slotId:part==='title'?params.textSlot:params.subtitleSlot,text:expected[part],fontId:face.fontId,weight:face.weight,style:'normal',
   boxes:value.boxes.map(box=>({...box})),fontSize:value.fontSize,alpha:value.alpha};
 };
 const draw=(context:CanvasRenderingContext2D,time:number,suppressed?:'title'|'subtitle')=>{
  const next={title:blank(),subtitle:blank()},pair=boundCanvasPair(context,expected,{title:suppressed==='title'?null:next.title,subtitle:suppressed==='subtitle'?null:next.subtitle});
  if(!stage)throw Error('CLIP_NOT_READY');active=pair;try{stage.draw(pair.canvas,time);pair.finish();}finally{active=undefined;}return next;
 };
 const region=(part:'title'|'subtitle',regionId:string)=>({regionId,boxAt(){
  // The rising subtitle is clipped during its entrance; expose its box only
  // once both supported lines have settled into the visible reading hold.
  if(part==='subtitle'&&(lastTime===undefined||lastTime<.8))return null;
  const boxes=traces?.[part].boxes;if(!boxes?.length)return null;
  const x=Math.min(...boxes.map(box=>box.x)),y=Math.min(...boxes.map(box=>box.y));
  return{x,y,width:Math.max(...boxes.map(box=>box.x+box.width))-x,height:Math.max(...boxes.map(box=>box.y+box.height))-y};
 }});
 return{ready,render(time:number){traces=draw(paint,time);lastTime=time;
   for(const part of ['title','subtitle'] as const){const value=traces[part];if(!value.boxes.length)throw Error('CANVAS_TEXT_NOT_DRAWN');
    probes[part].style.font=value.font;probes[part].style.letterSpacing=value.letterSpacing;}
  },canvasTextTrace(){return [metadata('title'),metadata('subtitle')];},
  canvasTextProof(){if(lastTime===undefined)throw Error('CANVAS_TEXT_PROOF_UNAVAILABLE');const withText=canvas.toDataURL('image/png');
   return (['title','subtitle'] as const).map((part,index)=>{draw(clean[index]!.context,lastTime!,part);return{...metadata(part),withText,withoutText:clean[index]!.element.toDataURL('image/png')};});
  },events:blockEvents('canvas-subtitle',ctx.frames,params),regions:[region('title','headline'),region('subtitle','supporting')]};
}});
