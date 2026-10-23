import type { Box, SceneContext, SceneRegion } from '../../../contracts/film-runtime.d.ts';
import { easeOut, clamp01 } from '../../film-runtime/src/motion.ts';
import '../../film-runtime/src/types.ts';

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
  const box = element.getBoundingClientRect(), scene = root.getBoundingClientRect();
  return {x: box.x - scene.x, y: box.y - scene.y, width: box.width, height: box.height};
}});
const text = (ctx: SceneContext, value: unknown, parent: HTMLElement, maxLines = 4): HTMLElement => {
  if (typeof value !== 'string') throw Error('TEXT_SLOT_UNKNOWN');
  return ctx.text(value).mount(parent, {maxLines});
};

window.PB.defineBlock<Record<string, unknown>>({id: 'hook-title', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx), box = safeBox(ctx);
  const orbit = node(ctx.root, {position: 'absolute', border: `2px solid ${ctx.style.palette.accent}`, borderRadius: '50%',
    width: ctx.target.width * 0.8 + 'px', height: ctx.target.width * 0.8 + 'px', left: '52%', top: '-28%', opacity: '0.2'});
  const title = node(safe, {position: 'absolute', left: '0', top: '24%', width: '100%', height: '53%'});
  text(ctx, params.textSlot, title);
  const line = node(safe, {position: 'absolute', left: '0', top: '17%', height: '8px', width: '12%', background: ctx.style.palette.accent ?? ''});
  if (params.subtitleSlot) text(ctx, params.subtitleSlot, node(safe, {position: 'absolute', top: '81%', width: '92%', height: '18%'}), 3);
  return {
    render(time) { const p = easeOut(time / 0.6); title.style.transform = `translateY(${(1 - p) * Math.min(48, box.height * 0.04)}px)`;
      title.style.opacity = String(0.35 + 0.65 * p); line.style.width = 12 + p * 18 + '%'; orbit.style.transform = `rotate(${time * 4}deg) scale(${1 + clamp01(time / 5) * 0.15})`; },
    events: [{name: 'title-land', frame: 18}], regions: [region('headline', title, ctx.root)]
  };
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'ui-showcase', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx), wide = ctx.target.aspect === 'landscape', hasText = typeof params.textSlot === 'string';
  if (hasText) text(ctx, params.textSlot, node(safe, {position: 'absolute', left: '0', top: wide ? '25%' : '2%',
    width: wide ? '37%' : '100%', height: wide ? '62%' : '28%'}), 4);
  const panel = node(safe, {position: 'absolute', left: wide && hasText ? '42%' : '2%', top: wide ? '8%' : hasText ? '35%' : '4%',
    width: wide && hasText ? '56%' : '96%', height: wide ? '84%' : hasText ? '60%' : '92%', borderRadius: '28px',
    background: ctx.style.palette.bg ?? '', border: `2px solid ${ctx.style.palette.accent}`, boxShadow: '0 32px 80px #0005', overflow: 'hidden'});
  const asset = ctx.asset(String(params.assetKey)), image = document.createElement('img');
  image.src = asset.url; image.alt = ''; image.draggable = false;
  Object.assign(image.style, {display: 'block', width: '100%', height: '100%', objectFit: 'contain'}); panel.append(image);
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
    render(time) { const p = easeOut(time / 0.7); panel.style.transform = `perspective(1800px) rotateY(${(1 - p) * (wide ? -9 : -4)}deg) translateY(${(1 - p) * 40}px) scale(${0.92 + p * 0.08})`;
      if (highlight) highlight.style.opacity = String(easeOut((time - 0.5) / 0.4)); },
    events: [{name: 'product-land', frame: 21}], regions: [region('product', panel, ctx.root)]
  };
}});

window.PB.defineBlock<Record<string, unknown>>({id: 'cta-endcard', version: '1.0.0', build(ctx, params) {
  const safe = inSafe(ctx);
  const accent = node(safe, {position: 'absolute', top: '9%', left: '0', width: '64px', height: '64px',
    borderRadius: '20px', background: ctx.style.palette.accent ?? '', transform: 'rotate(-12deg)'});
  if (params.logoKey) {
    const image = document.createElement('img'); image.src = ctx.asset(String(params.logoKey)).url; image.alt = '';
    Object.assign(image.style, {position: 'absolute', top: '8%', right: '0', width: '120px', height: '120px', objectFit: 'contain'}); safe.append(image);
  }
  const title = node(safe, {position: 'absolute', top: '30%', width: '100%', height: '44%'}); text(ctx, params.textSlot, title);
  if (params.subtitleSlot) text(ctx, params.subtitleSlot, node(safe, {position: 'absolute', top: '80%', width: '100%', height: '18%'}), 2);
  return {
    render(time) { const p = easeOut(time / 0.5); title.style.transform = `translateY(${(1 - p) * 24}px)`; accent.style.transform = `rotate(${-12 + p * 12}deg)`; },
    events: [{name: 'cta-land', frame: 15}], regions: [region('cta', title, ctx.root)]
  };
}});
