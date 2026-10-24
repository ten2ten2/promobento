import type { Box, SceneContext, SceneRegion } from '../../../contracts/film-runtime.d.ts';
import { easeOut, clamp01 } from '../../film-runtime/src/motion.ts';
import '../../film-runtime/src/types.ts';
import {blockEvents} from './events.mjs';
import {panelProjection,paintProjectedMedia,PANEL_PERSPECTIVE} from './projected-media.ts';

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

window.PB.defineBlock<Record<string, unknown>>({id: 'hook-title', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx), box = safeBox(ctx);
  const orbit = node(ctx.root, {position: 'absolute', border: `2px solid ${ctx.style.palette.accent}`, borderRadius: '50%',
    width: ctx.target.width * 0.8 + 'px', height: ctx.target.width * 0.8 + 'px', left: '52%', top: '-28%', opacity: '0.2'});
  const title = node(safe, {position: 'absolute', left: '0', top: '24%', width: '100%', height: '53%'});
  text(ctx, params.textSlot, title);
  const line = node(safe, {position: 'absolute', left: '0', top: '17%', height: '8px', width: '12%', background: ctx.style.palette.accent ?? ''});
  if (params.subtitleSlot) text(ctx, params.subtitleSlot, node(safe, {position: 'absolute', top: '81%', width: '92%', height: '18%'}), 3);
  const timeline = window.gsap.timeline({paused: true});
  // At rest, use ordinary text painting instead of retaining an identity-transform raster surface.
  // A persistent will-change layer made the hidden/reverse glyph-edge discrepancy larger.
  ctx.OM.clock(timeline, time => { const p = easeOut(time / 0.6); title.style.transform = p === 1 ? 'none' : `translateY(${(1 - p) * Math.min(48, box.height * 0.04)}px)`;
    title.style.opacity = String(0.35 + 0.65 * p); line.style.width = 12 + p * 18 + '%'; orbit.style.transform = `rotate(${time * 4}deg) scale(${1 + clamp01(time / 5) * 0.15})`; }, (ctx.frames.end - ctx.frames.start) / 30);
  return {
    timeline,
    events: blockEvents('hook-title', ctx.frames, params), regions: [region('headline', title, ctx.root)]
  };
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'ui-showcase', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx), wide = ctx.target.aspect === 'landscape', hasText = typeof params.textSlot === 'string';
  if (hasText) text(ctx, params.textSlot, node(safe, {position: 'absolute', left: '0', top: wide ? '25%' : '2%',
    width: wide ? '37%' : '100%', height: wide ? '62%' : '28%'}), 4);
  const panel = node(safe, {position: 'absolute', left: wide && hasText ? '42%' : '2%', top: wide ? '8%' : hasText ? '35%' : '4%',
    width: wide && hasText ? '56%' : '96%', height: wide ? '84%' : hasText ? '60%' : '92%', borderRadius: '28px',
    background: ctx.style.palette.bg ?? '', border: `2px solid ${ctx.style.palette.accent}`, boxShadow: '0 32px 80px #0005', overflow: 'hidden'});
  const asset = ctx.asset(String(params.assetKey)), draw = picture(ctx, String(params.assetKey), panel);
  let highlight: HTMLDivElement | undefined;
  if (typeof params.focus === 'string') {
    const roi = asset.roi[Number(params.focus.slice(4))];
    if (!roi) throw Error('ASSET_ROI_UNKNOWN');
    const scale = Math.min(panel.clientWidth / asset.width, panel.clientHeight / asset.height);
    highlight = node(panel, {position: 'absolute', pointerEvents: 'none', border: `4px solid ${ctx.style.palette.accent}`,
      borderRadius: '12px', left: (panel.clientWidth - asset.width * scale) / 2 + roi.x * asset.width * scale + 'px',
      top: (panel.clientHeight - asset.height * scale) / 2 + roi.y * asset.height * scale + 'px',
      width: roi.width * asset.width * scale + 'px', height: roi.height * asset.height * scale + 'px'});
  }
  return {
    async render(time) { const p = easeOut(time / 0.7); panel.style.transform = p === 1 ? 'none' : `perspective(1800px) rotateY(${(1 - p) * (wide ? -9 : -4)}deg) translateY(${(1 - p) * 40}px) scale(${0.92 + p * 0.08})`;
      await draw(time);
      if (highlight) highlight.style.opacity = String(easeOut((time - 0.5) / 0.4)); },
    events: blockEvents('ui-showcase', ctx.frames, params), regions: [region('product', panel, ctx.root)]
  };
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'cta-endcard', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx);
  const accent = node(safe, {position: 'absolute', top: '9%', left: '0', width: '64px', height: '64px',
    borderRadius: '20px', background: ctx.style.palette.accent ?? '', transform: 'rotate(-12deg)'});
  if (params.logoKey) {
    const logo = ctx.asset(String(params.logoKey)); if (logo.kind === 'video') throw Error('LOGO_KIND_INVALID');
    const image = document.createElement('img'); image.src = logo.url; image.alt = '';
    Object.assign(image.style, {position: 'absolute', top: '8%', right: '0', width: '120px', height: '120px', objectFit: 'contain'}); safe.append(image);
  }
  const title = node(safe, {position: 'absolute', top: '30%', width: '100%', height: '44%'}); text(ctx, params.textSlot, title);
  if (params.subtitleSlot) text(ctx, params.subtitleSlot, node(safe, {position: 'absolute', top: '80%', width: '100%', height: '18%'}), 2);
  return {
    render(time) { const p = easeOut(time / 0.5); title.style.transform = p === 1 ? 'none' : `translateY(${(1 - p) * 24}px)`;
      accent.style.transform = p === 1 ? 'none' : `rotate(${-12 + p * 12}deg)`; },
    events: blockEvents('cta-endcard', ctx.frames, params), regions: [region('cta', title, ctx.root)]
  };
}});

type Item = {textSlot: string; subtitleSlot?: string; assetKey?: string};
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

for (const id of ['feature-grid', 'curriculum'] as const) window.PB.defineBlock<Record<string, unknown>>({id, version: id === 'feature-grid' ? '1.0.1' : '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx), wide = ctx.target.aspect === 'landscape', items = params.items as Item[];
  const heading = params.textSlot ? node(safe, {position: 'absolute', top: '0', width: '100%', height: '20%'}) : undefined;
  if (heading) text(ctx, params.textSlot, heading, 2);
  const grid = node(safe, {position: 'absolute', top: heading ? '25%' : '4%', width: '100%', height: heading ? '72%' : '92%',
    display: 'grid', gap: wide ? '24px' : '18px', gridTemplateColumns: wide ? `repeat(${id === 'curriculum' ? 2 : items.length}, minmax(0,1fr))` : 'minmax(0,1fr)',
    gridTemplateRows: wide ? id === 'curriculum' ? `repeat(${Math.ceil(items.length / 2)},minmax(0,1fr))` : 'minmax(0,1fr)' : `repeat(${items.length},minmax(0,1fr))`});
  const drawings: Array<(time: number) => Promise<void>> = [];
  const cards = items.map((item, index) => {
    const card = node(grid, {position: 'relative', minWidth: '0', minHeight: '0', borderRadius: '24px', overflow: 'hidden',
      border: `2px solid ${ctx.style.palette.accent}`, padding: wide ? '28px' : '22px', background: ctx.style.palette.bg ?? ''});
    const art = item.assetKey ? node(card, {position: 'absolute', right: '5%', top: '8%', width: wide ? '90%' : '24%', height: wide ? '38%' : '84%'}) : undefined;
    if (art && item.assetKey) drawings.push(picture(ctx, item.assetKey, art));
    // Image-above cards share one 40% copy band: 22% title, 3% gap, 15% subtitle.
    // The old 42% title area overlapped the subtitle that started at 61%.
    const copy = node(card, {position: 'absolute', left: '7%', top: art && wide ? '52%' : '12%', width: art && !wide ? '62%' : '86%', height: item.subtitleSlot ? (art && wide ? '22%' : '42%') : (art && wide ? '40%' : '76%')});
    text(ctx, item.textSlot, copy, 3, wide ? 84 : 64);
    if (item.subtitleSlot) text(ctx, item.subtitleSlot, node(card, {position: 'absolute', left: '7%', top: art && wide ? '77%' : '61%', width: art && !wide ? '62%' : '86%', height: art && wide ? '15%' : '30%'}), 2);
    // Pure geometry, not an unbound visible numeric module label.
    node(card, {position: 'absolute', left: '7%', bottom: '6%', width: `${Math.min(40, 10 + index * 6)}%`, height: '4px', background: ctx.style.palette.accent ?? ''});
    return card;
  });
  return {async render(time) { for (const draw of drawings) await draw(time); cards.forEach((card, i) => { const p = easeOut((time - i * .12) / .5);
    card.style.opacity = String(p); card.style.transform = p === 1 ? 'none' : `translateY(${(1 - p) * 32}px)`; }); },
  events: blockEvents(id, ctx.frames, params),
  regions: [region(id === 'curriculum' ? 'modules' : 'features', grid, ctx.root)]};
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'ui-journey', version: '1.0.1', build(ctx, params) {
  const safe = inSafe(ctx), wide = ctx.target.aspect === 'landscape', items = params.items as Item[];
  safe.style.overflow = 'hidden';
  safe.style.zIndex = '1';
  const surface = document.createElement('canvas'),scratch = document.createElement('canvas');
  surface.width = scratch.width = ctx.target.width; surface.height = scratch.height = ctx.target.height;
  Object.assign(surface.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none'});ctx.root.append(surface);
  const paint = surface.getContext('2d',{willReadFrequently:true}),work = scratch.getContext('2d',{willReadFrequently:true});
  if(!paint||!work)throw Error('IMAGE_CONTEXT_UNAVAILABLE');
  const safeRect=safe.getBoundingClientRect(),rootRect=ctx.root.getBoundingClientRect();
  const box={x:safeRect.x-rootRect.x,y:safeRect.y-rootRect.y,width:safeRect.width,height:safeRect.height};
  const camera = node(safe, {position: 'absolute', inset: '0', perspective: PANEL_PERSPECTIVE+'px'});
  const media:Array<{screen:Box;width:number;height:number;load:(time:number)=>Promise<CanvasImageSource>}>=[];
  const ready: Promise<void>[] = [];
  const panels = items.map(item => {
    const panel = node(camera, {position: 'absolute', inset: '0'});
    const heading = node(panel, {position: 'absolute', left: '2%', top: '2%', width: '96%', height: wide ? '20%' : '28%'});
    text(ctx, item.textSlot, heading, 3);
    const screen = node(panel, {position: 'absolute', left: '2%', top: wide ? '26%' : '34%', width: '96%', height: wide ? '69%' : '61%',
      borderRadius: '24px', border: `2px solid ${ctx.style.palette.accent}`, overflow: 'hidden'});
    const asset = ctx.asset(item.assetKey!);
    const rect=screen.getBoundingClientRect(),inner={x:rect.x-safeRect.x+2,y:rect.y-safeRect.y+2,width:rect.width-4,height:rect.height-4};
    if(asset.kind==='video'){
      if(!asset.frameAt)throw Error('VIDEO_FRAME_UNAVAILABLE');
      media.push({screen:inner,width:asset.width,height:asset.height,load:time=>asset.frameAt!(time)});
    }else{
      const image=new Image();image.src=asset.url;ready.push(image.decode());
      media.push({screen:inner,width:asset.width,height:asset.height,load:async()=>image});
    }
    return panel;
  });
  const duration = (ctx.frames.end - ctx.frames.start) / 30, travel = Math.max(1 / 30, duration - 1.2);
  return {ready: Promise.all(ready).then(() => {}), async render(time) {
    paint.clearRect(0,0,surface.width,surface.height);
    const position = clamp01((time - .4) / travel) * (panels.length - 1);
    const poses=panels.map((panel, index) => { const distance = index - position;
      const pose={x:distance*ctx.target.width*.8,z:-Math.abs(distance)*200,angle:-distance*12,opacity:clamp01(1-Math.abs(distance))};
      panel.style.visibility = Math.abs(distance) < 1 ? 'visible' : 'hidden';
      panel.style.opacity = String(pose.opacity);
      panel.style.transform = distance === 0 ? 'none' : `translateX(${pose.x}px) translateZ(${pose.z}px) rotateY(${pose.angle}deg)`;
      return pose;
    });
    paint.save();paint.beginPath();paint.rect(box.x,box.y,box.width,box.height);paint.clip();
    try{
      for(let index=0;index<media.length;index++){
        const pose=poses[index]!;if(!pose.opacity)continue;
        const item=media[index]!,image=await item.load(time);work.clearRect(0,0,scratch.width,scratch.height);
        paintProjectedMedia(work,image,item.width,item.height,item.screen,panelProjection(box,pose.x,pose.z,pose.angle*Math.PI/180));
        paint.globalAlpha=pose.opacity;paint.drawImage(scratch,0,0);
      }
    }finally{paint.restore();}
  }, events: blockEvents('ui-journey', ctx.frames, params), regions: [region('journey', safe, ctx.root)]};
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
