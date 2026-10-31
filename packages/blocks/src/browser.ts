import type { Box, SceneContext, SceneRegion } from '../../../contracts/film-runtime.d.ts';
import { easeOut, clamp01 } from '../../film-runtime/src/motion.ts';
import '../../film-runtime/src/types.ts';
import {blockEvents} from './events.mjs';
import {mediaPyramid,blendPyramids,paintProjectedMedia,PANEL_PERSPECTIVE} from './projected-media.ts';
import {brandRelayPose} from './brand-relay.ts';
import {journeyPose} from './journey-motion.ts';
import {focusPose,focusViewport,type FocusPoint} from './focus-motion.ts';
import {carriedPose,componentPose,readingPose,relayFit,relayPageOffset,relayPageOpacity,relayVisible,returnPose} from './component-relay.ts';
import {createClipStage} from '../../film-runtime/src/clip/stage.js';
import {boundCanvasTitle,type CanvasTitleTrace} from './canvas-title.ts';
import {assertCanvasTitle} from './canvas-title-validate.ts';

const node = (parent: HTMLElement, css: Partial<CSSStyleDeclaration>): HTMLDivElement => {
  const element = document.createElement('div'); Object.assign(element.style, css); parent.append(element); return element;
};
const safeBox = (ctx: SceneContext): Box => ({
  x: ctx.target.safeInsets.left * ctx.target.width, y: ctx.target.safeInsets.top * ctx.target.height,
  width: ctx.target.width * (1 - ctx.target.safeInsets.left - ctx.target.safeInsets.right),
  height: ctx.target.height * (1 - ctx.target.safeInsets.top - ctx.target.safeInsets.bottom)
});
const inSafe = (ctx: SceneContext): HTMLDivElement => {
  const box = safeBox(ctx);
  return node(ctx.root, {position: 'absolute', left: box.x + 'px', top: box.y + 'px', width: box.width + 'px', height: box.height + 'px'});
};
const region = (regionId: string, element: HTMLElement, root: HTMLElement): SceneRegion => ({regionId, boxAt() {
  if (!element.getClientRects().length || getComputedStyle(element).visibility !== 'visible') return null;
  for (let parent: HTMLElement | null = element; parent && parent !== root; parent = parent.parentElement)
    if (Number(getComputedStyle(parent).opacity) === 0) return null;
  const box = element.getBoundingClientRect(), scene = root.getBoundingClientRect();
  return {x: box.x - scene.x, y: box.y - scene.y, width: box.width, height: box.height};
}});
const text = (ctx: SceneContext, value: unknown, parent: HTMLElement, maxLines = 4, maxFontSize?: number): HTMLElement => {
  if (typeof value !== 'string') throw Error('TEXT_SLOT_UNKNOWN');
  return ctx.text(value).mount(parent, {maxLines, ...(maxFontSize === undefined ? {} : {maxFontSize})});
};

// Original Vox image-only grammar. Text-bearing cues stay unavailable until
// Canvas text has trusted fact binding and actual-frame observation.
window.PB.defineBlock<{items:Array<{assetKey:string;focus?:string}>;intervalFrames:number}>({id:'vox-clip',version:'1.0.0',build(ctx,params){
  const events=blockEvents('vox-clip',ctx.frames,params),images:Record<string,HTMLImageElement>=Object.create(null);
  const ready=Promise.all(params.items.map(async item=>{
    const asset=ctx.asset(item.assetKey);if(asset.kind==='video')throw Error('VOX_CLIP_IMAGE_REQUIRED');
    const image=new Image();image.src=asset.url;await image.decode();
    if(image.naturalWidth!==asset.width||image.naturalHeight!==asset.height)throw Error('ASSET_DIMENSIONS_MISMATCH');
    images[item.assetKey]=image;
  })).then(()=>{});
  const canvas=document.createElement('canvas');canvas.width=ctx.target.width;canvas.height=ctx.target.height;
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});ctx.root.append(canvas);
  const paint=canvas.getContext('2d');if(!paint)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  let stage:ReturnType<typeof createClipStage>|undefined;
  const prepared=ready.then(()=>{const {width,height,safeInsets}=ctx.target;
    stage=createClipStage({grammar:'y2_vox',duration:(ctx.frames.end-ctx.frames.start)/30,data:{accent:ctx.style.palette.accent,preserveContext:true},
      safe:{top:safeInsets.top*height,bottom:safeInsets.bottom*height,left:safeInsets.left*width,right:safeInsets.right*width},
      cues:params.items.flatMap((item,index)=>{const at=index*params.intervalFrames/30,image={kind:'image',at,image:item.assetKey};
        if(!item.focus)return[image];const roi=ctx.asset(item.assetKey).roi[Number(item.focus.slice(4))];if(!roi)throw Error('VOX_CLIP_ROI_INVALID');
        return[image,{kind:'highlight',at:at+36/30,data:{rect:[roi.x,roi.y,roi.width,roi.height]}}];})},{width,height,images});
  });
  return{ready:prepared,render(time){if(!stage)throw Error('CLIP_NOT_READY');stage.draw(paint,time);},events,
    regions:[region('product',canvas,ctx.root)]};
}});

// Original y3 image reveal, paired with a separately fact-bound DOM headline.
// The grammar never receives text; authored Canvas text stays prohibited.
window.PB.defineBlock<{assetKey:string;textSlot:string}>({id:'whiteboard-clip',version:'1.0.0',build(ctx,params){
  const asset=ctx.asset(params.assetKey);if(asset.kind==='video')throw Error('WHITEBOARD_IMAGE_REQUIRED');
  const image=new Image(),canvas=document.createElement('canvas');canvas.width=ctx.target.width;canvas.height=ctx.target.height;
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});ctx.root.append(canvas);
  const paint=canvas.getContext('2d');if(!paint)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  const box=safeBox(ctx),titleBox={x:box.x,y:box.y+box.height*.01,width:box.width*.96,height:box.height*.10};
  const heading=node(ctx.root,{position:'absolute',left:titleBox.x+'px',top:titleBox.y+'px',width:titleBox.width+'px',height:titleBox.height+'px',backgroundColor:'#FBFBFB'});
  text(ctx,params.textSlot,heading,3).style.color='#0A0503';
  let stage:ReturnType<typeof createClipStage>|undefined;
  const ready=(async()=>{image.src=asset.url;await image.decode();if(image.naturalWidth!==asset.width||image.naturalHeight!==asset.height)throw Error('ASSET_DIMENSIONS_MISMATCH');
   const {width,height,safeInsets}=ctx.target;stage=createClipStage({grammar:'y3_whiteboard',duration:(ctx.frames.end-ctx.frames.start)/30,
    data:{accent:ctx.style.palette.accent,imageHero:true},safe:{top:safeInsets.top*height,bottom:safeInsets.bottom*height,left:safeInsets.left*width,right:safeInsets.right*width},
    cues:[{kind:'image',at:0,image:params.assetKey}]},{width,height,images:{[params.assetKey]:image}});
  })();
  return{ready,render(time){if(!stage)throw Error('CLIP_NOT_READY');stage.draw(paint,time);
   const imageBox=stage.hit('image-0');
   if(imageBox&&(imageBox[0]<box.x-2||imageBox[1]<box.y-2||imageBox[0]+imageBox[2]>box.x+box.width+2||imageBox[1]+imageBox[3]>box.y+box.height+2))
     throw Error('WHITEBOARD_PRODUCT_OUTSIDE_SAFE_AREA:'+JSON.stringify({imageBox,box}));
   if(imageBox&&imageBox[0]<titleBox.x+titleBox.width&&imageBox[0]+imageBox[2]>titleBox.x
     &&imageBox[1]<titleBox.y+titleBox.height&&imageBox[1]+imageBox[3]>titleBox.y)throw Error('WHITEBOARD_LAYOUT_OVERLAP:'+JSON.stringify({imageBox,titleBox}));
  },events:blockEvents('whiteboard-clip',ctx.frames,params),
   regions:[region('product',canvas,ctx.root),region('headline',heading,ctx.root)]};
}});

// One short, fact-bound title through the original y5 Canvas grammar. This
// narrowly audited path has no custom scenes, nested clips, captions or numbers.
function buildCanvasTitles(ctx:SceneContext,items:Array<{textSlot:string;startFrame:number}>,id:'canvas-title'|'canvas-sequence'){
  const font=ctx.style.type.display,slots=items.map(item=>ctx.text(item.textSlot));
  for(const slot of slots)assertCanvasTitle(slot.text,slot.role,font.style);
  const selected=(time:number)=>Math.max(0,items.findLastIndex(item=>item.startFrame<=time*30+1e-6));
  let text=slots[0]!.text,currentSlot=items[0]!.textSlot;
  const family=`PBC-${font.fontId}-${font.weight}`,canvas=document.createElement('canvas');canvas.width=ctx.target.width;canvas.height=ctx.target.height;
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});ctx.root.append(canvas);
  // This hidden span is solely a platform-font probe; actual text visibility
  // is established separately by comparing Canvas pixels with the screenshot.
  const fontProbe=document.createElement('span');fontProbe.dataset.pbCanvasFont='1';fontProbe.textContent=text;
  Object.assign(fontProbe.style,{position:'absolute',left:'-10000px',top:'0',visibility:'hidden',whiteSpace:'pre',pointerEvents:'none'});ctx.root.append(fontProbe);
  const paint=canvas.getContext('2d');if(!paint)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  const without=document.createElement('canvas');without.width=canvas.width;without.height=canvas.height;const clean=without.getContext('2d');if(!clean)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  let stage:ReturnType<typeof createClipStage>|undefined,trace:CanvasTitleTrace|undefined,lastTime:number|undefined;
  const ready=document.fonts.load(`normal 400 36px "${family}"`,slots.map(slot=>slot.text).join('')).then(faces=>{
    if(!faces.length||faces.some(face=>face.status!=='loaded'))throw Error('CANVAS_TITLE_FONT_UNAVAILABLE');
    const inset=ctx.target.safeInsets;
    stage=createClipStage({grammar:'y5_kinetic_type',duration:(ctx.frames.end-ctx.frames.start)/30,
      safe:{left:inset.left*canvas.width,right:inset.right*canvas.width,top:inset.top*canvas.height,bottom:inset.bottom*canvas.height},
      data:{safeText:true,palette:[[ctx.style.palette.bg!,ctx.style.palette.ink!]]},
      cues:items.map((item,index)=>({kind:'title',at:item.startFrame/30,text:slots[index]!.text}))},{width:canvas.width,height:canvas.height,fontFamily:family});
  });
  const currentTrace=()=>{if(!trace||lastTime===undefined)throw Error('CANVAS_TEXT_PROOF_UNAVAILABLE');
    return{slotId:currentSlot,text,fontId:font.fontId,weight:font.weight,style:'normal' as const,boxes:trace.boxes.map(box=>({...box})),fontSize:trace.fontSize,alpha:trace.alpha};};
  return{ready,render(time:number){if(!stage)throw Error('CLIP_NOT_READY');const index=selected(time);text=slots[index]!.text;currentSlot=items[index]!.textSlot;fontProbe.textContent=text;trace={boxes:[],fontSize:0,alpha:0,draws:0,font:'',letterSpacing:'0px'};
    stage.draw(boundCanvasTitle(paint,text,trace),time);if(trace.draws!==1||!trace.boxes.length)throw Error('CANVAS_TEXT_NOT_DRAWN');
    fontProbe.style.font=trace.font;fontProbe.style.letterSpacing=trace.letterSpacing;lastTime=time;
  },canvasTextTrace:currentTrace,canvasTextProof(){if(!stage||!trace||lastTime===undefined)throw Error('CANVAS_TEXT_PROOF_UNAVAILABLE');
    stage.draw(boundCanvasTitle(clean,text,null),lastTime);
    return{...currentTrace(),withText:canvas.toDataURL('image/png'),withoutText:without.toDataURL('image/png')};
  },events:blockEvents(id,ctx.frames,id==='canvas-title'?{textSlot:currentSlot}:{items}),regions:[{regionId:'headline',boxAt(){
    if(!trace?.boxes.length)return null;const left=Math.min(...trace.boxes.map(box=>box.x)),top=Math.min(...trace.boxes.map(box=>box.y)),
      right=Math.max(...trace.boxes.map(box=>box.x+box.width)),bottom=Math.max(...trace.boxes.map(box=>box.y+box.height));
    return{x:left,y:top,width:right-left,height:bottom-top};
  }}]};
}
window.PB.defineBlock<{textSlot:string}>({id:'canvas-title',version:'1.0.0',build:(ctx,params)=>buildCanvasTitles(ctx,[{textSlot:params.textSlot,startFrame:0}],'canvas-title')});
window.PB.defineBlock<{items:Array<{textSlot:string;startFrame:number}>}>({id:'canvas-sequence',version:'1.0.0',build:(ctx,params)=>buildCanvasTitles(ctx,params.items,'canvas-sequence')});

function cpuSurface(ctx:SceneContext){
  const canvas=document.createElement('canvas');canvas.width=ctx.target.width;canvas.height=ctx.target.height;
  Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});ctx.root.append(canvas);
  const paint=canvas.getContext('2d',{willReadFrequently:true});if(!paint)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  const pixels=paint.createImageData(canvas.width,canvas.height);
  return{pixels,write:()=>paint.putImageData(pixels,0,0)};
}

function projectedAsset(ctx:SceneContext,key:string){
  const asset=ctx.asset(key),canvas=document.createElement('canvas');canvas.width=asset.width;canvas.height=asset.height;
  const reader=canvas.getContext('2d',{willReadFrequently:true});if(!reader)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  const read=(image:CanvasImageSource)=>{reader.clearRect(0,0,canvas.width,canvas.height);reader.drawImage(image,0,0);
    return mediaPyramid(reader.getImageData(0,0,canvas.width,canvas.height));};
  if(asset.kind==='video'){
    if(!asset.frameAt)throw Error('VIDEO_FRAME_UNAVAILABLE');
    return{asset,ready:Promise.resolve(),load:async(time:number)=>read(await asset.frameAt!(time))};
  }
  const image=new Image();image.src=asset.url;const decoded=image.decode().then(()=>read(image));
  return{asset,ready:decoded.then(()=>{}),load:(_time:number)=>decoded};
}

window.PB.defineBlock<Record<string, unknown>>({id: 'hook-title', version: '1.0.1', build(ctx, params) {
  const safe = inSafe(ctx), box = safeBox(ctx), group = node(safe, {position: 'absolute', inset: '0'});
  const orbit = node(ctx.root, {position: 'absolute', border: `2px solid ${ctx.style.palette.accent}`, borderRadius: '50%',
    width: ctx.target.width * 0.8 + 'px', height: ctx.target.width * 0.8 + 'px', left: '52%', top: '-28%', opacity: '0.2'});
  const title = node(group, {position: 'absolute', left: '0', width: '100%', height: '60%'}), titleText = text(ctx, params.textSlot, title);
  const line = node(group, {position: 'absolute', left: '0', height: '8px', width: '12%', background: ctx.style.palette.accent ?? ''});
  const subtitle = params.subtitleSlot ? node(group, {position: 'absolute', width: '92%', height: '24%'}) : undefined;
  const subtitleText = subtitle ? text(ctx, params.subtitleSlot, subtitle, 3) : undefined;
  return {
    render(time) {
      // Measure only after the engine makes this scene active, including on a cold/backward seek.
      const p = easeOut(time/.6), gap = Math.max(24,Math.min(40,box.height*.028)), titleHeight = titleText.offsetHeight;
      const height = 8 + 32 + titleHeight + (subtitleText ? gap + subtitleText.offsetHeight : 0), top = (box.height-height)/2;
      line.style.top=top+'px';title.style.top=top+40+'px';
      if(subtitle)subtitle.style.top=top+40+titleHeight+gap+'px';
      // No identity-transform raster surface at rest; motion and layout share one draw authority.
      group.style.transform = p === 1 ? 'none' : `translateY(${(1-p)*Math.min(48,box.height*.04)}px)`;
      title.style.opacity = String(.35+.65*p);line.style.width=12+p*18+'%';
      orbit.style.transform = `rotate(${time*4}deg) scale(${1+clamp01(time/5)*.15})`;
    },
    events: blockEvents('hook-title', ctx.frames, params), regions: [region('headline', titleText, ctx.root)]
  };
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'ui-showcase', version: '1.0.3', build(ctx, params) {
  const safe = inSafe(ctx), wide = ctx.target.aspect === 'landscape', hasText = typeof params.textSlot === 'string';
  safe.style.zIndex='1';
  if (hasText) text(ctx, params.textSlot, node(safe, {position: 'absolute', left: '0', top: wide ? '25%' : '2%',
    width: wide ? '37%' : '100%', height: wide ? '62%' : '28%'}), 4);
  const panel = node(safe, {position: 'absolute', left: wide && hasText ? '42%' : '2%', top: wide ? '8%' : hasText ? '35%' : '4%',
    width: wide && hasText ? '56%' : '96%', height: wide ? '84%' : hasText ? '60%' : '92%', borderRadius: '28px',
    border: '2px solid transparent', overflow: 'hidden'});
  const source=projectedAsset(ctx,String(params.assetKey)),{asset}=source,surface=cpuSurface(ctx);
  const rect=panel.getBoundingClientRect(),rootRect=ctx.root.getBoundingClientRect();
  const box={x:rect.x-rootRect.x,y:rect.y-rootRect.y,width:rect.width,height:rect.height};
  const clip={x:0,y:0,width:ctx.target.width,height:ctx.target.height},padding=192;
  const chrome=document.createElement('canvas');chrome.width=Math.ceil(box.width)+padding*2;chrome.height=Math.ceil(box.height)+padding*2;
  const draw=chrome.getContext('2d',{willReadFrequently:true});if(!draw)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  draw.fillStyle=ctx.style.palette.bg!;draw.shadowColor='#0005';draw.shadowBlur=80;draw.shadowOffsetY=32;
  draw.beginPath();draw.roundRect(padding,padding,box.width,box.height,28);draw.fill();
  draw.shadowColor='transparent';draw.lineWidth=2;draw.strokeStyle=ctx.style.palette.accent!;
  draw.beginPath();draw.roundRect(padding+1,padding+1,box.width-2,box.height-2,27);draw.stroke();
  const frame=mediaPyramid(draw.getImageData(0,0,chrome.width,chrome.height));
  const expanded={x:-padding,y:-padding,width:chrome.width,height:chrome.height};
  let highlight:ReturnType<typeof mediaPyramid>|undefined;
  if (typeof params.focus === 'string') {
    const roi = asset.roi[Number(params.focus.slice(4))];
    if (!roi) throw Error('ASSET_ROI_UNKNOWN');
    const scale = Math.min(panel.clientWidth / asset.width, panel.clientHeight / asset.height);
    draw.clearRect(0,0,chrome.width,chrome.height);draw.save();
    draw.beginPath();draw.roundRect(padding+2,padding+2,box.width-4,box.height-4,26);draw.clip();
    draw.lineWidth=4;draw.beginPath();draw.roundRect(padding+4+(panel.clientWidth-asset.width*scale)/2+roi.x*asset.width*scale,
      padding+4+(panel.clientHeight-asset.height*scale)/2+roi.y*asset.height*scale,Math.max(4,roi.width*asset.width*scale-4),Math.max(4,roi.height*asset.height*scale-4),10);draw.stroke();draw.restore();
    highlight=mediaPyramid(draw.getImageData(0,0,chrome.width,chrome.height));
  }
  // Static panels, including the ROI, need one projection during the entrance.
  // At rest retain the original full-resolution sample; only the ROI's changed pixels fade.
  const prepared=source.ready.then(async()=>{
    if(asset.kind==='video')return undefined;
    const media=await source.load(0),copy=(pixels:{width:number;height:number;data:Uint8ClampedArray})=>({width:pixels.width,height:pixels.height,data:new Uint8ClampedArray(pixels.data)});
    const localBox={x:padding,y:padding,width:box.width,height:box.height};
    const localClip={x:0,y:0,width:chrome.width,height:chrome.height};
    const texture={width:chrome.width,height:chrome.height,data:new Uint8ClampedArray(frame[0]!.data)};
    paintProjectedMedia(texture,media,{x:2,y:2,width:box.width-4,height:box.height-4},localBox,0,0,0,1,{radius:26,clip:localClip});
    const flatStart=mediaPyramid(copy(texture));
    if(highlight)paintProjectedMedia(texture,highlight,expanded,localBox,0,0,0,1,{radius:0,clip:localClip});
    const flat=blendPyramids(flatStart,highlight?mediaPyramid(texture):flatStart);
    paintProjectedMedia(surface.pixels,frame,expanded,box,0,0,0,1,{clip,radius:0});
    paintProjectedMedia(surface.pixels,media,{x:2,y:2,width:box.width-4,height:box.height-4},box,0,0,0,1,{clip,radius:26});
    const restStart=[copy(surface.pixels)];
    if(highlight)paintProjectedMedia(surface.pixels,highlight,expanded,box,0,0,0,1,{clip,radius:0});
    return{flat,rest:blendPyramids(restStart,[copy(surface.pixels)])};
  });
  let settledPixels=false;
  return {
    ready:prepared.then(()=>{}),async render(time) { const p = easeOut(time / 0.7),angle=(1-p)*(wide?-9:-4),translationY=(1-p)*40,zoom=.92+p*.08;
      panel.style.transform = p === 1 ? 'none' : `perspective(${PANEL_PERSPECTIVE}px) rotateY(${angle}deg) translateY(${translationY}px) scale(${zoom})`;
      const highlightOpacity=easeOut((time-.5)/.4),settled=asset.kind!=='video'&&p===1&&(!highlight||highlightOpacity===1);
      if(!settled||!settledPixels){
        surface.pixels.data.fill(0);const options={clip,translationY,zoom};
        const still=await prepared;
        if(still&&p===1)surface.pixels.data.set(still.rest.render(highlightOpacity)[0]!.data);
        else if(still)paintProjectedMedia(surface.pixels,still.flat.render(highlightOpacity),expanded,box,0,0,angle*Math.PI/180,1,{...options,radius:0});
        else{
          paintProjectedMedia(surface.pixels,frame,expanded,box,0,0,angle*Math.PI/180,1,{...options,radius:0});
          paintProjectedMedia(surface.pixels,await source.load(time),{x:2,y:2,width:box.width-4,height:box.height-4},box,0,0,angle*Math.PI/180,1,{...options,radius:26});
          if(highlight)paintProjectedMedia(surface.pixels,highlight,expanded,box,0,0,angle*Math.PI/180,highlightOpacity,{...options,radius:0});
        }
      }
      settledPixels=settled;
      // Always write, including after a hidden scene. Only the unchanged CPU sampling is reused.
      surface.write(); },
    events: blockEvents('ui-showcase', ctx.frames, params), regions: [region('product', panel, ctx.root)]
  };
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'cta-endcard', version: '1.0.1', build(ctx, params) {
  const safe = inSafe(ctx), box = safeBox(ctx), group = node(safe, {position: 'absolute', inset: '0'});
  const accent = node(group, {position: 'absolute', left: '0', width: '96px', height: '6px',
    borderRadius: '3px', background: ctx.style.palette.accent ?? ''});
  let logo:HTMLImageElement|undefined;
  if (params.logoKey) {
    const asset = ctx.asset(String(params.logoKey)); if (asset.kind === 'video') throw Error('LOGO_KIND_INVALID');
    logo = document.createElement('img'); logo.src = asset.url; logo.alt = '';
    Object.assign(logo.style, {position: 'absolute', left: '0', width: '120px', height: '120px', objectFit: 'contain'}); group.append(logo);
    accent.style.display='none';
  }
  const title = node(group, {position: 'absolute', width: '100%', height: '60%'}), titleText = text(ctx, params.textSlot, title);
  const subtitle = params.subtitleSlot ? node(group, {position: 'absolute', width: '100%', height: '18%'}) : undefined;
  const subtitleText = subtitle ? text(ctx, params.subtitleSlot, subtitle, 2) : undefined;
  return {
    render(time) {
      // Fitted text has its natural height; group the URL with it instead of anchoring it to the screen bottom.
      const p = easeOut(time / 0.5), gap = Math.max(24,Math.min(40,box.height*.028)), anchor = logo ? 120 : 6;
      const titleHeight=titleText.offsetHeight, subtitleHeight=subtitleText?.offsetHeight??0;
      const height=anchor+32+titleHeight+(subtitle?gap+subtitleHeight:0), top=(box.height-height)/2;
      if(logo)logo.style.top=top+'px';else{accent.style.top=top+'px';accent.style.width=Math.round(64+32*p)+'px';}
      title.style.top=top+anchor+32+'px';
      if(subtitle)subtitle.style.top=top+anchor+32+titleHeight+gap+'px';
      group.style.transform=p===1?'none':`translateY(${(1-p)*24}px)`;
    },
    events: blockEvents('cta-endcard', ctx.frames, params), regions: [region('cta', titleText, ctx.root)]
  };
}});

type Item = {textSlot: string; subtitleSlot?: string; assetKey?: string; icon?:string};
function picture(ctx: SceneContext, key: string, parent: HTMLElement): (time: number) => Promise<void> {
  const asset = ctx.asset(key);
  if (asset.kind === 'video') {
    const canvas = document.createElement('canvas'); canvas.width = asset.width; canvas.height = asset.height;
    Object.assign(canvas.style, {display: 'block', width: '100%', height: '100%', objectFit: 'contain'}); parent.append(canvas);
    const context = canvas.getContext('2d'); if (!context || !asset.frameAt) throw Error('VIDEO_FRAME_UNAVAILABLE');
    return async time => { const bitmap = await asset.frameAt!(time); context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); };
  }
  const image = document.createElement('img'); image.src = asset.url; image.alt = ''; image.draggable = false;
  Object.assign(image.style, {display: 'block', width: '100%', height: '100%', objectFit: 'contain'}); parent.append(image);
  return async () => {};
}

window.PB.defineBlock<Record<string, unknown>>({id:'continuous-focus',version:'1.0.0',build(ctx,params){
  const safe=inSafe(ctx),wide=ctx.target.aspect==='landscape',hasText=typeof params.textSlot==='string';
  if(hasText)text(ctx,params.textSlot,node(safe,{position:'absolute',left:'0',top:wide?'22%':'0',
    width:wide?'33%':'100%',height:wide?'56%':'21%'}),3);
  const panel=node(safe,{position:'absolute',left:wide&&hasText?'37%':'0',top:wide?'3%':hasText?'25%':'3%',
    width:wide&&hasText?'63%':'100%',height:wide?'94%':hasText?'72%':'94%',overflow:'hidden',borderRadius:'18px'});
  const asset=ctx.asset(String(params.assetKey)),sourceStart=Number(params.sourceStartFrame??0);
  if(asset.kind!=='video'&&sourceStart)throw Error('FOCUS_SOURCE_OFFSET_REQUIRES_VIDEO');
  const track=((params.aspectTracks as Partial<Record<string,FocusPoint[]>>|undefined)?.[ctx.target.aspect]
    ??params.focusTrack??[]) as FocusPoint[];
  let element:HTMLImageElement|HTMLCanvasElement,ready=Promise.resolve(),draw:((time:number)=>Promise<void>)|undefined;
  if(asset.kind==='video'){
    if(!asset.frameAt)throw Error('VIDEO_FRAME_UNAVAILABLE');
    const canvas=document.createElement('canvas');canvas.width=asset.width;canvas.height=asset.height;
    const paint=canvas.getContext('2d');if(!paint)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
    draw=async time=>{const frame=await asset.frameAt!(time+sourceStart/30);paint.clearRect(0,0,canvas.width,canvas.height);paint.drawImage(frame,0,0,canvas.width,canvas.height);};
    element=canvas;
  }else{
    const image=new Image();image.src=asset.url;image.alt='';image.draggable=false;ready=image.decode();element=image;
  }
  Object.assign(element.style,{position:'absolute',maxWidth:'none',pointerEvents:'none'});panel.append(element);
  return {ready,async render(time){
    const pose=focusPose(time*30,track),box=focusViewport(asset,{width:panel.clientWidth,height:panel.clientHeight},pose);
    Object.assign(element.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
    if(draw)await draw(time);
  },events:blockEvents('continuous-focus',ctx.frames,params),regions:[region('product',panel,ctx.root)]};
}});

// Adapted from huashu-motion@52467f99c602b76ba86d511d37acdfe93fa1e16e
// runtime/clip/grammars/y5_kinetic_type.js and y3_whiteboard.js, Copyright (c) 2026 Huashu, MIT.
// See ../../film-runtime/src/LICENSE.huashu. Text stays in fact-bound slots instead of canvas.
window.PB.defineBlock<Record<string,unknown>>({id:'kinetic-title',version:'1.0.0',build(ctx,params){
  const safe=inSafe(ctx),box=safeBox(ctx),group=node(safe,{position:'absolute',left:'0',width:'100%',top:'22%',height:'56%'});
  const title=node(group,{position:'absolute',width:'100%',top:'4%',height:params.subtitleSlot?'62%':'92%'});
  const titleText=text(ctx,params.textSlot,title,3);
  const sub=params.subtitleSlot?node(group,{position:'absolute',width:'100%',top:'72%',height:'25%',overflow:'hidden'}):undefined;
  if(sub)text(ctx,params.subtitleSlot,sub,2);
  const underline=node(safe,{position:'absolute',left:'0',top:'81%',height:'8px',width:'28%',background:ctx.style.palette.accent??'',transformOrigin:'left'});
  let fittedSize:number|undefined;
  return {render(time){
    const k=ctx.CLIP.MO.springHz!(time,2,8),rise=easeOut((time-.22)/.35);
    fittedSize??=parseFloat(titleText.style.fontSize);
    titleText.style.fontSize=Math.round(fittedSize*(.88+.12*clamp01(k)))+'px';
    title.style.top=`calc(4% + ${Math.round((1-clamp01(k))*Math.min(50,box.height*.05))}px)`;
    if(sub){sub.style.visibility=rise===0?'hidden':'visible';sub.style.top=`calc(72% + ${Math.round((1-rise)*20)}px)`;sub.style.clipPath=`inset(0 ${Math.round((1-rise)*100)}% 0 0)`;}
    underline.style.transform=`scaleX(${easeOut(time/.45)})`;
  },events:blockEvents('kinetic-title',ctx.frames,params),regions:[region('headline',titleText,ctx.root)]};
}});

window.PB.defineBlock<Record<string,unknown>>({id:'drawn-steps',version:'1.0.0',build(ctx,params){
  const safe=inSafe(ctx),wide=ctx.target.aspect==='landscape',items=params.items as Item[];
  const heading=params.textSlot?node(safe,{position:'absolute',left:'0',top:'0',width:'100%',height:'19%'}):undefined;
  if(heading)text(ctx,params.textSlot,heading,2);
  const board=node(safe,{position:'absolute',left:'0',top:heading?'25%':'10%',width:'100%',height:heading?'70%':'80%',
    display:'grid',gridTemplateColumns:wide?`repeat(${items.length},minmax(0,1fr))`:'1fr',
    gridTemplateRows:wide?'1fr':`repeat(${items.length},minmax(0,1fr))`,gap:wide?'28px':'16px'});
  const pieces=items.map((item,index)=>{
    const cell=node(board,{position:'relative',minWidth:'0',minHeight:'0'});
    // The paths adapt the upstream whiteboard's unit-box icon strokes; all labels remain real text slots.
    const paths:Record<string,string>={circle:'M 0 -35 A 35 35 0 1 1 -1 -35',
      document:'M 14 -42 L -30 -42 L -30 42 L 30 42 L 30 -26 L 14 -42 L 14 -26 L 30 -26 M -18 -12 L 18 -12 M -18 4 L 18 4 M -18 20 L 6 20',
      screen:'M -44 -36 L 44 -36 L 44 20 L -44 20 Z M 0 20 L 0 34 M -20 36 L 20 36 M -32 -22 L 6 -22 M -24 -10 L 24 -10 M -24 2 L 12 2',
      chat:'M -30 -36 L 30 -36 L 42 -24 L 42 10 L 30 22 L -6 22 L -24 40 L -20 22 L -30 22 L -42 10 L -42 -24 Z M -18 -7 L -17 -7 M 0 -7 L 1 -7 M 18 -7 L 19 -7',
      check:'M -32 0 L -8 26 L 36 -32',target:'M 0 -36 A 40 40 0 1 1 -1 -36 M 0 -21 A 25 25 0 1 1 -1 -21 M 0 -5 A 9 9 0 1 1 -1 -5 M 46 -42 L 2 2 M 30 -42 L 46 -42 L 46 -26',
      person:'M 0 -43 A 13 13 0 1 1 -1 -43 M 0 -17 L 0 14 M -24 -4 L 0 -10 L 24 -4 M -17 44 L 0 14 L 17 44',
      cat:'M -16 -22 L -24 -43 L -8 -35 L 8 -35 L 24 -43 L 16 -22 M -22 -20 Q -27 -4 -20 0 M 22 -20 Q 27 -4 20 0 M -21 0 Q -30 22 -29 42 L 29 42 Q 30 22 21 0 M 29 37 Q 50 33 48 10 Q 44 -2 37 -6 M -10 -19 L -9 -19 M 10 -19 L 11 -19 M -8 -7 L -30 -10 M 8 -7 L 30 -10',
      network:'M -38 -28 A 6 6 0 1 1 -39 -28 M -38 0 A 6 6 0 1 1 -39 0 M -38 28 A 6 6 0 1 1 -39 28 M 0 -33 A 6 6 0 1 1 -1 -33 M 0 -11 A 6 6 0 1 1 -1 -11 M 0 11 A 6 6 0 1 1 -1 11 M 0 33 A 6 6 0 1 1 -1 33 M 38 -14 A 6 6 0 1 1 37 -14 M 38 14 A 6 6 0 1 1 37 14 M -32 -28 L -6 -33 M -32 -28 L -6 -11 M -32 0 L -6 -11 M -32 0 L -6 11 M -32 28 L -6 11 M -32 28 L -6 33 M 6 -33 L 32 -14 M 6 -11 L 32 -14 M 6 11 L 32 14 M 6 33 L 32 14',
      bulb:'M -18 6 A 26 26 0 1 1 18 6 M -11 12 L -11 27 L 11 27 L 11 12 M -8 36 L 8 36 M -31 -36 L -39 -44 M 0 -43 L 0 -50 M 31 -36 L 39 -44',
      cross:'M -28 -28 L 28 28 M 28 -28 L -28 28',
      stack:'M -22 -40 L 38 -40 L 38 12 M -31 -31 L 29 -31 L 29 21 M -40 -22 L 20 -22 L 20 30 L -40 30 Z M -30 20 L -14 2 L 0 14 L 10 6 L 20 20',
      gear:'M 0 -40 L 8 -39 L 11 -31 L 18 -28 L 25 -32 L 32 -25 L 28 -18 L 31 -11 L 39 -8 L 40 0 L 39 8 L 31 11 L 28 18 L 32 25 L 25 32 L 18 28 L 11 31 L 8 39 L 0 40 L -8 39 L -11 31 L -18 28 L -25 32 L -32 25 L -28 18 L -31 11 L -39 8 L -40 0 L -39 -8 L -31 -11 L -28 -18 L -32 -25 L -25 -32 L -18 -28 L -11 -31 L -8 -39 Z M 0 -12 A 12 12 0 1 1 -1 -12',
      clock:'M 0 -40 A 40 40 0 1 1 -1 -40 M 0 -26 L 0 0 L 18 10',
      chart:'M -42 -42 L -42 38 L 44 38 M -32 22 L -12 4 L 6 12 L 34 -26 M 18 -26 L 34 -26 L 34 -10'};
    const mark=document.createElementNS('http://www.w3.org/2000/svg','svg');mark.setAttribute('viewBox','-50 -50 100 100');
    Object.assign(mark.style,{position:'absolute',left:'0',top:wide?'12%':'32%',width:wide?'120px':'64px',height:wide?'120px':'64px',overflow:'visible'});
    const stroke=document.createElementNS('http://www.w3.org/2000/svg','path');stroke.setAttribute('d',paths[item.icon??'circle']!);
    stroke.setAttribute('fill','none');stroke.setAttribute('stroke',ctx.style.palette.accent??'');stroke.setAttribute('stroke-width','3.5');
    stroke.setAttribute('stroke-linecap','round');stroke.setAttribute('stroke-linejoin','round');stroke.setAttribute('pathLength','1');
    stroke.style.strokeDasharray='1';mark.append(stroke);cell.append(mark);
    const line=index<items.length-1?node(cell,{position:'absolute',left:wide?'140px':'30px',top:wide?'calc(12% + 58px)':'calc(32% + 80px)',
      width:wide?'calc(100% - 110px)':'4px',height:wide?'4px':'calc(100% - 60px)',
      background:ctx.style.palette.accent??'',transformOrigin:wide?'left center':'center top'}):undefined;
    if(line)node(line,{position:'absolute',right:wide?'0':'-5px',bottom:wide?'-5px':'0',width:'14px',height:'14px',
      borderTop:`3px solid ${ctx.style.palette.accent}`,borderRight:`3px solid ${ctx.style.palette.accent}`,transform:wide?'rotate(45deg)':'rotate(135deg)'});
    const copy=node(cell,{position:'absolute',left:wide?'0':'88px',top:wide?'46%':'28%',width:wide?'94%':'calc(100% - 88px)',height:wide?'50%':'65%'});
    const title=node(copy,{position:'absolute',width:'100%',top:'0',height:item.subtitleSlot?'56%':'90%'});
    text(ctx,item.textSlot,title,3,wide?84:68);
    if(item.subtitleSlot)text(ctx,item.subtitleSlot,node(copy,{position:'absolute',width:'100%',top:'62%',height:'34%'}),2);
    return {stroke,line,copy};
  });
  return {render(time){pieces.forEach((piece,index)=>{
    const p=easeOut((time-index*.55)/.4),stroke=easeOut((time-index*.55-.18)/.4);
    piece.stroke.style.strokeDashoffset=String(1-p);piece.copy.style.visibility=p===0?'hidden':'visible';
    piece.copy.style.top=`calc(${wide?'46%':'28%'} + ${Math.round((1-p)*16)}px)`;
    piece.copy.style.clipPath=`inset(0 ${Math.round((1-p)*100)}% 0 0)`;
    if(piece.line)piece.line.style.transform=stroke===1?'none':wide?`scaleX(${stroke})`:`scaleY(${stroke})`;
  });},events:blockEvents('drawn-steps',ctx.frames,params),regions:[region('steps',board,ctx.root)]};
}});

for (const id of ['feature-grid', 'curriculum'] as const) window.PB.defineBlock<Record<string, unknown>>({id, version: id === 'feature-grid' ? '1.1.0' : '1.0.1', build(ctx, params) {
  const safe = inSafe(ctx), box = safeBox(ctx), wide = ctx.target.aspect === 'landscape', items = params.items as Item[], compact = items.every(item=>!item.assetKey);
  const relayKey=id==='feature-grid'&&typeof params.logoKey==='string'?params.logoKey:undefined;
  if(relayKey&&!compact)throw Error('BRAND_RELAY_TEXT_ROLES_REQUIRED');
  const beatFrames=id==='feature-grid'&&typeof params.beatFrames==='number'?params.beatFrames:undefined;
  const logoSize=wide?112:96,copyTop=relayKey&&wide?logoSize+32:28;
  const heading = params.textSlot ? node(safe, {position: 'absolute', top: '0', width: '100%', height: '20%'}) : undefined;
  const headingText = heading ? text(ctx, params.textSlot, heading, 2) : undefined;
  const grid = node(safe, {position: 'absolute', top: heading ? '25%' : '4%', width: '100%', height: heading ? '72%' : '92%',
    display: 'grid', gap: wide ? '24px' : '18px', gridTemplateColumns: wide ? `repeat(${id === 'curriculum' ? 2 : items.length}, minmax(0,1fr))` : 'minmax(0,1fr)',
    gridTemplateRows: wide ? id === 'curriculum' ? `repeat(${Math.ceil(items.length / 2)},minmax(0,1fr))` : 'minmax(0,1fr)' : `repeat(${items.length},minmax(0,1fr))`});
  const drawings: Array<(time: number) => Promise<void>> = [];
  const copyLayouts: Array<{title:HTMLElement; subtitle?:HTMLElement; detail?:HTMLElement}> = [];
  const cards = items.map((item, index) => {
    const card = node(grid, {position: 'relative', minWidth: '0', minHeight: '0', borderRadius: compact ? '0' : '24px', overflow: 'hidden',
      border: compact ? 'none' : `2px solid ${ctx.style.palette.accent}`, padding: compact ? '0' : wide ? '28px' : '22px', background: ctx.style.palette.bg ?? ''});
    const art = item.assetKey ? node(card, {position: 'absolute', right: '5%', top: '8%', width: wide ? '90%' : '24%', height: wide ? '38%' : '84%'}) : undefined;
    if (art && item.assetKey) drawings.push(picture(ctx, item.assetKey, art));
    // Image-above cards share one 40% copy band: 22% title, 3% gap, 15% subtitle.
    // The old 42% title area overlapped the subtitle that started at 61%.
    const available = compact ? card.clientHeight-copyTop-(item.subtitleSlot?20:0) : 0;
    const textLeft=relayKey&&!wide?logoSize+32+'px':compact?'0':'7%',textWidth=relayKey&&!wide?`calc(100% - ${logoSize+32}px)`:compact?'100%':art&&!wide?'62%':'86%';
    const copy = node(card, {position: 'absolute', left: textLeft, top: compact ? copyTop+'px' : art && wide ? '52%' : '12%', width: textWidth,
      height: compact ? available*(item.subtitleSlot ? .6 : 1)+'px' : item.subtitleSlot ? (art && wide ? '22%' : '42%') : (art && wide ? '40%' : '76%')});
    const title = text(ctx, item.textSlot, copy, 3, wide ? 84 : 64);
    const subtitle = item.subtitleSlot ? node(card, {position: 'absolute', left: textLeft, top: art && wide ? '77%' : '61%', width: textWidth,
      height: compact ? available*.4+'px' : art && wide ? '15%' : '30%'}) : undefined;
    const detail = subtitle ? text(ctx, item.subtitleSlot, subtitle, 2) : undefined;
    // Pure geometry, not an unbound visible numeric module label.
    node(card, {position: 'absolute', left: compact ? '0' : '7%', ...(compact ? {top:'0',width:'48px'} : {bottom:'6%',width:`${Math.min(40, 10 + index * 6)}%`}), height: '4px', background: ctx.style.palette.accent ?? '',...(relayKey?{display:'none'}:{})});
    copyLayouts.push({title,...(subtitle?{subtitle}:{}),...(detail?{detail}:{})});
    return card;
  });
  let logo:HTMLImageElement|undefined;
  if(relayKey){
    const asset=ctx.asset(relayKey);if(asset.kind==='video')throw Error('LOGO_KIND_INVALID');
    logo=document.createElement('img');logo.src=asset.url;logo.alt='';logo.draggable=false;
    Object.assign(logo.style,{position:'absolute',width:logoSize+'px',height:logoSize+'px',objectFit:'contain',pointerEvents:'none',zIndex:'1'});grid.append(logo);
  }
  return {async render(time) {
    if(compact){
      // Text-only features are an editorial band, not empty image-card shells.
      // Keep fit capacities fixed, then size/centre the group from the actual fitted lines.
      const rowHeight=Math.max(relayKey&&!wide?logoSize+16:0,...copyLayouts.map(item=>copyTop+item.title.offsetHeight+(item.detail?20+item.detail.offsetHeight:0)));
      const rows=wide?(id==='curriculum'?Math.ceil(items.length/2):1):items.length, gap=wide?24:18;
      const height=rows*rowHeight+(rows-1)*gap, headingHeight=headingText?.offsetHeight??0, top=(box.height-height-(heading?headingHeight+32:0))/2;
      if(heading)heading.style.top=top+'px';grid.style.top=top+(heading?headingHeight+32:0)+'px';grid.style.height=height+'px';
      for(const item of copyLayouts)if(item.subtitle)item.subtitle.style.top=copyTop+item.title.offsetHeight+20+'px';
    }
    for (const draw of drawings) await draw(time); cards.forEach((card, i) => { const p = easeOut((time - i * (beatFrames === undefined ? .12 : beatFrames/30)) / .5);
    card.style.opacity = String(p); card.style.transform = p === 1 ? 'none' : `translateY(${(1 - p) * 32}px)`; });
    if(logo&&beatFrames!==undefined){
      const pose=brandRelayPose(time*30,beatFrames,cards.map(card=>({x:card.offsetLeft+8,y:card.offsetTop+(wide?0:Math.max(0,(card.offsetHeight-logoSize)/2))})));
      logo.style.left=pose.x+'px';logo.style.top=pose.y+'px';logo.style.opacity=String(clamp01(time/.5));
      logo.style.transform=pose.moving?`scale(${pose.scale}) rotate(${pose.rotation}deg)`:'none';
    }
  },
  events: blockEvents(id, ctx.frames, params),
  regions: [region(id === 'curriculum' ? 'modules' : 'features', grid, ctx.root),...(logo?[region('brand-relay',logo,ctx.root)]:[])]};
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'ui-journey', version: '1.1.0', build(ctx, params) {
  if (typeof params.beatFrames === 'number') return beatJourney(ctx, params as {beatFrames:number;items:Item[]});
  const safe = inSafe(ctx), wide = ctx.target.aspect === 'landscape', items = params.items as Item[];
  safe.style.overflow = 'hidden';
  safe.style.zIndex = '1';
  const surface=cpuSurface(ctx),{pixels}=surface;
  const safeRect=safe.getBoundingClientRect(),rootRect=ctx.root.getBoundingClientRect();
  const box={x:safeRect.x-rootRect.x,y:safeRect.y-rootRect.y,width:safeRect.width,height:safeRect.height};
  const camera = node(safe, {position: 'absolute', inset: '0', perspective: PANEL_PERSPECTIVE+'px'});
  const media:Array<{screen:Box;load:(time:number)=>Promise<ReturnType<typeof mediaPyramid>>}>=[];
  const ready: Promise<void>[] = [];
  const panels = items.map(item => {
    const panel = node(camera, {position: 'absolute', inset: '0'});
    const heading = node(panel, {position: 'absolute', left: '2%', top: '2%', width: '96%', height: wide ? '20%' : '28%'});
    text(ctx, item.textSlot, heading, 3);
    const screen = node(panel, {position: 'absolute', left: '2%', top: wide ? '26%' : '34%', width: '96%', height: wide ? '69%' : '61%',
      borderRadius: '24px', border: `2px solid ${ctx.style.palette.accent}`, overflow: 'hidden'});
    const source=projectedAsset(ctx,item.assetKey!);
    const rect=screen.getBoundingClientRect(),inner={x:rect.x-safeRect.x+2,y:rect.y-safeRect.y+2,width:rect.width-4,height:rect.height-4};
    ready.push(source.ready);media.push({screen:inner,load:source.load});
    return panel;
  });
  const duration = (ctx.frames.end - ctx.frames.start) / 30, travel = Math.max(1 / 30, duration - 1.2);
  return {ready: Promise.all(ready).then(() => {}), async render(time) {
    pixels.data.fill(0);
    const position = clamp01((time - .4) / travel) * (panels.length - 1);
    const poses=panels.map((panel, index) => { const distance = index - position;
      const pose={x:distance*ctx.target.width*.8,z:-Math.abs(distance)*200,angle:-distance*12,opacity:clamp01(1-Math.abs(distance))};
      panel.style.visibility = Math.abs(distance) < 1 ? 'visible' : 'hidden';
      panel.style.opacity = String(pose.opacity);
      panel.style.transform = distance === 0 ? 'none' : `translateX(${pose.x}px) translateZ(${pose.z}px) rotateY(${pose.angle}deg)`;
      return pose;
    });
    for(let index=0;index<media.length;index++){
      const pose=poses[index]!;if(!pose.opacity)continue;
      const item=media[index]!;
      paintProjectedMedia(pixels,await item.load(time),item.screen,box,pose.x,pose.z,pose.angle*Math.PI/180,pose.opacity);
    }
    surface.write();
  }, events: blockEvents('ui-journey', ctx.frames, params), regions: [region('journey', safe, ctx.root)]};
}});

function beatJourney(ctx:SceneContext,params:{beatFrames:number;items:Item[]}) {
  const safe=inSafe(ctx),box=safeBox(ctx),wide=ctx.target.aspect==='landscape';
  safe.style.zIndex='1';
  const surface=cpuSurface(ctx),events=blockEvents('ui-journey',ctx.frames,params);
  const items=params.items.map((item,index)=>{
    const flipped=index%2===1;
    const heading=node(safe,{position:'absolute',left:wide?(flipped?'2%':'64%'):'2%',top:wide?'28%':'2%',
      width:wide?'34%':'96%',height:wide?'48%':'23%'});
    text(ctx,item.textSlot,heading,3);
    const screen={x:box.width*(wide?(flipped?.40:0):.02),y:box.height*(wide?.03:.28),
      width:box.width*(wide?.60:.96),height:box.height*(wide?.94:.70)};
    return{heading,screen,source:projectedAsset(ctx,item.assetKey!)};
  });
  return{ready:Promise.all(items.map(item=>item.source.ready)).then(()=>{}),async render(time:number){
    surface.pixels.data.fill(0);
    for(const [index,item]of items.entries()){
      const pose=journeyPose(time*30,index,items.length,params.beatFrames);
      item.heading.style.visibility=pose.textOpacity>0?'visible':'hidden';
      item.heading.style.opacity=String(pose.textOpacity);
      item.heading.style.transform=pose.textY===0?'none':`translateY(${pose.textY}px)`;
      if(pose.opacity){
        const from=Math.floor(pose.position),to=Math.min(items.length-1,from+1),progress=pose.position-from;
        const a=items[from]!.screen,b=items[to]!.screen;
        const screen={x:a.x+(b.x-a.x)*progress,y:a.y+(b.y-a.y)*progress,
          width:a.width+(b.width-a.width)*progress,height:a.height+(b.height-a.height)*progress};
        paintProjectedMedia(surface.pixels,await item.source.load(time),screen,box,0,0,pose.angle*Math.PI/180,1,{zoom:pose.zoom,radius:0});
      }
    }
    surface.write();
  },events,regions:[region('journey',safe,ctx.root)]};
}

window.PB.defineBlock<Record<string, unknown>>({id:'component-relay',version:'1.1.0',build(ctx,params){
  const safe=inSafe(ctx),box=safeBox(ctx),wide=ctx.target.aspect==='landscape',hasText=typeof params.textSlot==='string';
  safe.style.zIndex='1';
  if(hasText)text(ctx,params.textSlot,node(safe,{position:'absolute',left:'0',top:wide?'29%':'1%',
    width:wide?'35%':'100%',height:wide?'42%':'22%'}),3);
  const bounds:Box={x:box.x+box.width*(wide&&hasText?.40:.02),y:box.y+box.height*(wide?.04:hasText?.25:.03),
    width:box.width*(wide&&hasText?.58:.96),height:box.height*(wide?.92:hasText?.72:.94)};
  const surface=cpuSurface(ctx),stage={x:0,y:0,width:ctx.target.width,height:ctx.target.height};
  const returning=params.componentBehavior==='return-to-source';
  const items=(params.items as Array<{assetKey:string}>).map((item,index)=>{
    const asset=ctx.asset(item.assetKey);if(asset.kind==='video')throw Error('RELAY_IMAGE_REQUIRED');
    const pageBounds=index===0||returning?bounds:{...bounds,width:bounds.width*.62};
    return{asset,source:projectedAsset(ctx,item.assetKey),box:relayFit(pageBounds,asset.width,asset.height)};
  });
  const first=items[0]!,roi=first.asset.roi[Number(String(params.focus).slice(4))];
  if(!roi||roi.x+roi.width>1||roi.y+roi.height>1)throw Error('RELAY_ROI_INVALID');
  const beat=Number(params.beatFrames),events=blockEvents('component-relay',ctx.frames,params);
  const left=Math.floor(roi.x*first.asset.width),top=Math.floor(roi.y*first.asset.height);
  const right=Math.min(first.asset.width,Math.ceil((roi.x+roi.width)*first.asset.width));
  const bottom=Math.min(first.asset.height,Math.ceil((roi.y+roi.height)*first.asset.height));
  const exactRoi={x:left/first.asset.width,y:top/first.asset.height,width:(right-left)/first.asset.width,height:(bottom-top)/first.asset.height};
  let images:Array<ReturnType<typeof mediaPyramid>>=[],detail:ReturnType<typeof mediaPyramid>;
  const ready=Promise.all(items.map(item=>item.source.load(0))).then(levels=>{
    images=levels;const original=levels[0]![0]!,width=right-left,height=bottom-top,data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)data.set(original.data.subarray(((top+y)*original.width+left)*4,((top+y)*original.width+right)*4),y*width*4);
    detail=mediaPyramid({width,height,data});
  });
  // Deterministic pixel-space drop shadow, composited before each real image.
  const shadow=(rect:Box,opacity:number)=>{
    const data=surface.pixels.data,dx=Math.max(2,Math.round(bounds.width*.008)),dy=Math.max(3,Math.round(bounds.height*.012));
    const x0=Math.max(0,Math.floor(bounds.x),Math.floor(rect.x+dx)),y0=Math.max(0,Math.floor(bounds.y),Math.floor(rect.y+dy));
    const x1=Math.min(ctx.target.width,Math.ceil(bounds.x+bounds.width),Math.ceil(rect.x+rect.width+dx));
    const y1=Math.min(ctx.target.height,Math.ceil(bounds.y+bounds.height),Math.ceil(rect.y+rect.height+dy));
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const i=(y*ctx.target.width+x)*4,remaining=data[i+3]!/255*(1-opacity),alpha=opacity+remaining;
      for(let channel=0;channel<3;channel++)data[i+channel]=data[i+channel]!*remaining/alpha;
      data[i+3]=alpha*255;
    }
  };
  const draw=(levels:ReturnType<typeof mediaPyramid>,rect:Box,opacity:number,imageOpacity=1)=>{
    if(imageOpacity<=0)return;
    shadow(rect,opacity);paintProjectedMedia(surface.pixels,levels,rect,stage,0,0,0,imageOpacity,{clip:bounds,radius:0});
  };
  return {ready,render(time){
    const frame=time*30;surface.pixels.data.fill(0);
    for(const [index,item]of items.entries()){
      if(!relayVisible(frame,index,items.length,beat))continue;
      const x=relayPageOffset(frame,index,items.length,beat,returning?item.box.width*1.12:bounds.width*1.2);
      const opacity=returning?relayPageOpacity(frame,index,items.length,beat):1;
      if(index===0){
        const pose=returning?returnPose(frame,beat,item.box,exactRoi,bounds):componentPose(frame,beat,item.box,exactRoi,bounds),page={...pose.page,x:pose.page.x+x};
        draw(images[index]!,page,.12*opacity,opacity);
      }else{
        const page=returning?readingPose(frame,index,items.length,beat,item.box):item.box;
        draw(images[index]!,{...page,x:page.x+x},.12*opacity,opacity);
      }
    }
    // The same detail remains the visual carrier across every page handoff.
    if(returning){const pose=returnPose(frame,beat,first.box,exactRoi,bounds);
      if(pose.opacity>0)draw(detail,pose.component,.22*pose.opacity,pose.opacity);
    }else{const pose=componentPose(frame,beat,first.box,exactRoi,bounds);
      if(pose.lift>0)draw(detail,carriedPose(frame,beat,pose.component,bounds),.22*pose.lift);}
    surface.write();
  },events,regions:[region('journey',safe,ctx.root)]};
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'metric', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx), title = node(safe, {position: 'absolute', top: '20%', width: '100%', height: '44%'});
  const handle = ctx.text(String(params.textSlot)), element = handle.mount(title, {maxLines: 2});
  const match = /^(\D*?)([-+]?\d+(?:[.,]\d+)?)(\D*)$/.exec(handle.text);
  if (!match || !Number.isFinite(Number(match[2]!.replace(',', '.')))) throw Error('METRIC_NUMBER_INVALID');
  const number = Number(match[2]!.replace(',', '.')), decimals = match[2]!.split(/[.,]/)[1]?.length ?? 0;
  element.dataset.pbFinalText = handle.text;
  if (params.subtitleSlot) text(ctx, params.subtitleSlot, node(safe, {position: 'absolute', top: '72%', width: '100%', height: '22%'}), 3);
  const line = node(safe, {position: 'absolute', top: '12%', height: '6px', width: '0', background: ctx.style.palette.accent ?? ''});
  return {render(time) { const p = easeOut(time / 1.2);
    element.textContent = p === 1 ? handle.text : match[1] + (number * p).toFixed(decimals).replace('.', match[2]!.includes(',') ? ',' : '.') + match[3];
    element.dataset.pbCounting = String(p < 1); line.style.width = `${p * 80}%`;
  }, events: blockEvents('metric', ctx.frames, params), regions: [region('metric', title, ctx.root)]};
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'captions', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx);
  const draw = params.assetKey ? picture(ctx, String(params.assetKey), node(safe, {position: 'absolute', inset: '0'})) : undefined;
  const track = node(safe, {position: 'absolute', bottom: '3%', left: '3%', width: '94%', height: '25%', padding: '24px',
    background: ctx.style.palette.bg ?? '', borderRadius: '20px'});
  const cues = (params.cues as Array<{textSlot: string; start: number; end: number}>).map(cue => {
    const root = node(track, {position: 'absolute', inset: '24px'}); text(ctx, cue.textSlot, root, 3); return {...cue, root};
  });
  return {async render(time) { await draw?.(time); const frame = Math.round(time * 30);
    cues.forEach(cue => { cue.root.style.visibility = frame >= cue.start && frame < cue.end ? 'visible' : 'hidden'; });
  }, events: blockEvents('captions', ctx.frames, params), regions: [region('captions', track, ctx.root)]};
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'talking-head', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx), wide = ctx.target.aspect === 'landscape';
  const portrait = node(safe, {position: 'absolute', top: '0', left: wide ? '2%' : '0', width: wide ? '58%' : '100%', height: wide ? '100%' : '70%',
    borderRadius: '28px', overflow: 'hidden'});
  const draw = picture(ctx, String(params.assetKey), portrait);
  const title = node(safe, {position: 'absolute', left: wide ? '65%' : '0', top: wide ? '34%' : '75%', width: wide ? '35%' : '100%', height: wide ? '38%' : '17%'});
  text(ctx, params.textSlot, title, 3, wide ? 96 : 72);
  if (params.subtitleSlot) text(ctx, params.subtitleSlot, node(safe, {position: 'absolute', left: wide ? '65%' : '0', top: wide ? '76%' : '93%',
    width: wide ? '35%' : '100%', height: wide ? '20%' : '7%'}), 2);
  return {async render(time) { await draw(time); const p = easeOut(time / .5);
    title.style.transform = p === 1 ? 'none' : `translateY(${(1 - p) * 20}px)`; title.style.opacity = String(p);
  }, events: blockEvents('talking-head', ctx.frames, params), regions: [region('speaker', portrait, ctx.root)]};
}});
