import {isCanvasTextScene} from '@promobento/contracts/canvas-text';
import { canonical, parseCanonicalJson } from '@promobento/contracts/canonical';
import { digest } from '@promobento/contracts/digest';
import {assertCustomSources,extractCustomSfx,customStudioAssets} from '@promobento/contracts/custom-source';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {filmUsesWebgl,isStudioRuntime} from '@promobento/contracts/render';
import { filmSpecErrors } from '@promobento/contracts/film';
import { validate as validateBlockParams } from '@promobento/contracts/validators/block-params';
import { validate } from '@promobento/contracts/validators/film';
import { blockCatalog, blockReferences } from '../../blocks/src/catalog.ts';
import {blockEvents} from '../../blocks/src/events.mjs';
import {assertCanvasTitle,assertCanvasNumber,assertCanvasSubtitle} from '../../blocks/src/canvas-title-validate.ts';
import type { FilmSpec } from '../../../contracts/film-runtime.d.ts';
import type { PageOptions, PagePlan } from './types.ts';

const blocks = new Map(blockCatalog.map(block => [block.id as string, {
  major: 1, validateParams: (params: object) => validateBlockParams({block: block.id + '@1', params}) ? [] : ['BLOCK_PARAMS_INVALID']
}]));
const safeJson = (value: unknown): string => canonical(value).replace(/</g, '\\u003c');

/** Trusted data-to-page builder, not an authorization service. No author code is evaluated. */
export function generateFilmPage(raw: string | Uint8Array, options: PageOptions): { html: string; csp: string; plan: PagePlan } {
  const maxBytes = 8 * 1024 * 1024;
  if (typeof raw === 'string' ? raw.length > maxBytes || new TextEncoder().encode(raw).byteLength > maxBytes : raw.byteLength > maxBytes)
    throw Error('FILM_SOURCE_TOO_LARGE');
  const data = parseCanonicalJson(raw);
  if (!validate(data)) throw Error('FILM_SCHEMA_INVALID: ' + (validate.errors?.[0]?.instancePath ?? ''));
  const spec = data as FilmSpec;
  assertCustomSources(spec,options?.customSources);
  if (spec.style.texture && spec.style.texture.kind !== 'none') throw Error('TEXTURE_NOT_IMPLEMENTED');
  if (!options || !Array.isArray(options.confirmedFactIds) || !Array.isArray(options.resources) || !Array.isArray(options.fonts))
    throw Error('FILM_TRUSTED_CONTEXT_REQUIRED');
  const resources = new Map(options.resources.map(resource => [resource.resourceId, resource]));
  const result = filmSpecErrors(spec, {
    blocks, resources, confirmedFactIds: new Set(options.confirmedFactIds), fontIds: new Set(options.fonts.map(font => font.fontId))
  });
  if (result.errors.length) throw Error(result.errors.map(issue => issue.code + ':' + issue.path).join('; '));
  const target = {...options.target, safeInsets: {...options.target.safeInsets}};
  const hasCanvasTitle=spec.scenes.some(scene=>isCanvasTextScene(scene));
  if(hasCanvasTitle&&spec.scenes.some(scene=>scene.kind==='custom'))throw Error('CANVAS_TITLE_CUSTOM_MIX_UNSUPPORTED');
  if (!['landscape', 'portrait', 'feed', 'square'].includes(target.aspect) || target.fps !== 30 || target.totalFrames !== spec.totalFrames
    || !Number.isSafeInteger(target.width) || target.width < 1 || !Number.isSafeInteger(target.height) || target.height < 1
    || ![options.initTimeoutMs, options.frameTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0)
    || typeof options.seed !== 'string') throw Error('FILM_PAGE_OPTIONS_INVALID');
  for (const side of ['top', 'right', 'bottom', 'left'] as const)
    if (!Number.isFinite(target.safeInsets[side]) || target.safeInsets[side] < 0 || target.safeInsets[side] >= 0.5) throw Error('SAFE_INSETS_INVALID');
  for (const scene of spec.scenes) {
    if (scene.layout && Object.keys(scene.layout).length) throw Error('LAYOUT_OVERRIDES_NOT_IMPLEMENTED');
    if (scene.transitionIn && !['cut', 'crossfade', 'fade-through', 'push', 'whip'].includes(scene.transitionIn.type)) throw Error('TRANSITION_NOT_IMPLEMENTED');
    if (scene.kind === 'custom') {
      if(isStudioRuntime(scene.runtime3D))for(const key of customStudioAssets(scene,options.customSources![scene.module]!)!){
        if(!['image','svg'].includes(resources.get(spec.assets[key]!.resourceId)?.kind??''))throw Error('CUSTOM_3D_IMAGE_REQUIRED');}
      if(scene.runtime3D==='om3-studio-v4')for(const [key,focus] of Object.entries(scene.params?.panelFocus as Record<string,string>)){
        const roi=spec.assets[key]?.roi?.[Number(focus.slice(4))];
        if(!roi||roi.x+roi.width>1||roi.y+roi.height>1)throw Error('CUSTOM_3D_PANEL_ROI_INVALID');
      }
      continue;
    }
    const references = blockReferences(scene.params);
    for (const id of references.texts) if (!Object.hasOwn(spec.texts, id)) throw Error('TEXT_SLOT_UNKNOWN');
    for (const id of references.assets) if (!Object.hasOwn(spec.assets, id)) throw Error('ASSET_SLOT_UNKNOWN');
    if(scene.block==='canvas-title@1'){
      const slot=spec.texts[String(scene.params.textSlot)]!;assertCanvasTitle(slot.text,slot.role,spec.style.type.display.style);
    }
    if(scene.block==='canvas-number@1'){
      const slot=spec.texts[String(scene.params.textSlot)]!;assertCanvasNumber(slot.text,slot.role,spec.style.type.display.style);
      if(!slot.factIds.length)throw Error('CANVAS_NUMBER_FACT_REQUIRED');
      blockEvents('canvas-number',scene,scene.params);
    }
    if(scene.block==='canvas-subtitle@1'){
      const title=spec.texts[String(scene.params.textSlot)]!,subtitle=spec.texts[String(scene.params.subtitleSlot)]!;
      if(scene.params.textSlot===scene.params.subtitleSlot)throw Error('CANVAS_SUBTITLE_SLOTS_INVALID');
      assertCanvasTitle(title.text,title.role,spec.style.type.display.style);assertCanvasSubtitle(subtitle.text,subtitle.role,spec.style.type.text.style);
      if(!title.factIds.length||!subtitle.factIds.length)throw Error('CANVAS_SUBTITLE_FACT_REQUIRED');
      blockEvents('canvas-subtitle',scene,scene.params);
    }
    if(scene.block==='canvas-sequence@1'){
      const items=scene.params.items as Array<{textSlot:string;startFrame:number}>;
      blockEvents('canvas-sequence',scene,scene.params);
      for(const item of items){const slot=spec.texts[item.textSlot]!;assertCanvasTitle(slot.text,slot.role,spec.style.type.display.style);
        if(!slot.factIds.length)throw Error('CANVAS_SEQUENCE_FACT_REQUIRED');}
    }
    if (scene.block === 'captions@1') {
      let end = -1;
      for (const cue of scene.params.cues as Array<{textSlot: string; start: number; end: number}>) {
        if (cue.start < end || cue.end <= cue.start || cue.end > scene.end - scene.start) throw Error('CAPTION_TIMING_INVALID');
        if (spec.texts[cue.textSlot]!.role !== 'caption' || !spec.texts[cue.textSlot]!.factIds.length) throw Error('CAPTION_UNCONFIRMED');
        end = cue.end;
      }
    }
    if (scene.block === 'metric@1') {
      const slot = spec.texts[String(scene.params.textSlot)];
      const match = /^(\D*?)([-+]?\d+(?:[.,]\d+)?)(\D*)$/.exec(slot?.text ?? '');
      if (slot?.role !== 'number' || !match || !Number.isFinite(Number(match[2]!.replace(',', '.')))) throw Error('METRIC_NUMBER_INVALID');
    }
    if (scene.params.logoKey && resources.get(spec.assets[String(scene.params.logoKey)]!.resourceId)?.kind === 'video') throw Error('LOGO_KIND_INVALID');
    if(scene.block==='keynote-clip@1'){
      for(const item of scene.params.items as Array<{assetKey:string;focus?:string}>){const asset=spec.assets[item.assetKey];
        if(!asset||!['image','svg'].includes(resources.get(asset.resourceId)?.kind??''))throw Error('KEYNOTE_IMAGE_REQUIRED');
        if(item.focus){const roi=asset.roi?.[Number(item.focus.slice(4))];if(!roi||roi.x+roi.width>1||roi.y+roi.height>1)throw Error('KEYNOTE_CLIP_ROI_INVALID');}}
      blockEvents('keynote-clip',scene,scene.params);
    }
    if(scene.block==='whiteboard-clip@1'){
      const asset=spec.assets[String(scene.params.assetKey)];
      if(!asset||!['image','svg'].includes(resources.get(asset.resourceId)?.kind??''))throw Error('WHITEBOARD_IMAGE_REQUIRED');
      blockEvents('whiteboard-clip',scene,scene.params);
    }
    if(scene.block==='vox-clip@1'){
      for(const item of scene.params.items as Array<{assetKey:string;focus?:string}>){
        if(!['image','svg'].includes(resources.get(spec.assets[item.assetKey]!.resourceId)?.kind??''))throw Error('VOX_CLIP_IMAGE_REQUIRED');
        if(item.focus){const roi=spec.assets[item.assetKey]!.roi?.[Number(item.focus.slice(4))];
          if(!roi||roi.x+roi.width>1||roi.y+roi.height>1)throw Error('VOX_CLIP_ROI_INVALID');}
      }
      blockEvents('vox-clip',scene,scene.params);
    }
    if(['device-3d@1','object-studio@1'].includes(scene.block)&&resources.get(spec.assets[String(scene.params.assetKey)]!.resourceId)?.kind==='video')throw Error('DEVICE_TEXTURE_IMAGE_REQUIRED');
    if (scene.block === 'ui-showcase@1' && typeof scene.params.focus === 'string') {
      const asset = spec.assets[String(scene.params.assetKey)];
      if (!asset?.roi?.[Number(scene.params.focus.slice(4))]) throw Error('ASSET_ROI_UNKNOWN');
    }
    if (scene.block === 'component-relay@1') {
      const items=scene.params.items as Array<{assetKey:string}>;
      for(const item of items){
        const asset=spec.assets[item.assetKey];
        if(!asset||!['image','svg'].includes(resources.get(asset.resourceId)?.kind ?? ''))throw Error('RELAY_IMAGE_REQUIRED');
      }
      const first=spec.assets[items[0]!.assetKey]!,roi=first.roi?.[Number(String(scene.params.focus).slice(4))];
      if(!roi||roi.x+roi.width>1||roi.y+roi.height>1)throw Error('RELAY_ROI_INVALID');
      blockEvents('component-relay',scene,scene.params);
    }
  }
  const fonts = Object.values(spec.style.type).filter((value): value is NonNullable<typeof spec.style.type.mono> => typeof value === 'object')
    .map(ref => {
      const font = options.fonts.find(item => item.fontId === ref.fontId && item.weight === ref.weight && item.style === (ref.style ?? 'normal'));
      if (!font?.rightsCleared || !font.licenseRef) throw Error('FONT_RIGHTS_OR_FACE_MISSING');
      return font;
    });
  if(spec.scenes.some(scene=>scene.kind==='block'&&scene.block==='canvas-number@1')){
    const ref=spec.style.type.display,face=fonts.find(font=>font.fontId===ref.fontId&&font.weight===ref.weight&&font.style===(ref.style??'normal'));
    if(face?.codePoints&&[...'0123456789'].some(character=>!face.codePoints!.includes(character.codePointAt(0)!)))throw Error('CANVAS_NUMBER_DIGIT_COVERAGE_REQUIRED');
  }
  for (const slot of Object.values(spec.texts)) {
    const display = ['headline', 'cta', 'number'].includes(slot.role), ref = spec.style.type[display ? 'display' : 'text'];
    const face = fonts.find(font => font.fontId === ref.fontId && font.weight === ref.weight && font.style === (ref.style ?? 'normal'))!;
    if (face.codePoints) {
      const coverage = new Set(face.codePoints);
      for (const character of slot.text) if (!/[\s\u200d\ufe0e\ufe0f]/u.test(character) && !coverage.has(character.codePointAt(0)!))
        throw Error('FONT_GLYPH_MISSING:' + face.fontId + ':U+' + character.codePointAt(0)!.toString(16));
    }
  }
  const assets: PagePlan['assets'] = {};
  for (const [key, slot] of Object.entries(spec.assets)) {
    if (slot.crop) throw Error('ASSET_CROP_NOT_IMPLEMENTED');
    const resource = resources.get(slot.resourceId);
    if (!resource?.rightsCleared || !resource.licenseRef) throw Error('ASSET_RIGHTS_PENDING');
    if (!['image', 'svg', 'video'].includes(resource.kind)) throw Error('ASSET_KIND_NOT_IMPLEMENTED');
    if (![resource.width, resource.height].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('ASSET_DIMENSIONS_INVALID');
    assets[key] = {resourceId: slot.resourceId, kind: resource.kind, width: resource.width, height: resource.height,
      url: '/r/' + slot.resourceId, roi: slot.roi ?? []};
    if (resource.kind === 'video') {
      const frames = resource.videoFrames, offset = resource.videoStartSeconds ?? 0;
      if (!frames?.length || frames.length > 1800 || !Number.isFinite(offset) || offset < 0) throw Error('VIDEO_FRAME_MANIFEST_INVALID');
      let previous = -1;
      const indices = new Set<number>();
      for (const frame of frames) {
        if (!Number.isFinite(frame.pts) || frame.pts < 0 || frame.pts <= previous || !Number.isFinite(frame.duration) || frame.duration <= 0
          || !Number.isSafeInteger(frame.index) || frame.index < 0 || indices.has(frame.index)) throw Error('VIDEO_FRAME_MANIFEST_INVALID');
        previous = frame.pts; indices.add(frame.index);
      }
      assets[key]!.videoFrames = frames.map(frame => ({pts: frame.pts, duration: frame.duration, index: frame.index}));
      assets[key]!.videoStartSeconds = offset;
    }
  }
  const usesWebgl=filmUsesWebgl(spec);
  const plan: PagePlan = {spec, usesWebgl, target: {aspect:target.aspect,width:target.width,height:target.height,
    safeInsets:{top:target.safeInsets.top,right:target.safeInsets.right,bottom:target.safeInsets.bottom,left:target.safeInsets.left},
    fps:30,totalFrames:spec.totalFrames}, seed: options.seed, manifestHash: digest(spec), assets, fonts,
    initTimeoutMs: options.initTimeoutMs, frameTimeoutMs: options.frameTimeoutMs};
  if (options.observeAssets === true) plan.observeAssets = true;
  const customSfx=Object.fromEntries(spec.scenes.flatMap(scene=>scene.kind==='custom'&&scene.params?.sourceSfx===true
    ?[[scene.id,extractCustomSfx(scene,options.customSources![scene.module]!,spec)] as const]:[]));
  if(Object.keys(customSfx).length)plan.customSfx=customSfx;
  if(spec.scenes.some(scene=>scene.kind==='custom'))plan.manifestHash=filmSourceHash(raw,options.customSources);
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const css = [...new Map(fonts.map(font => [`${font.fontId}/${font.weight}/${font.style}`, font])).values()].map(font =>
    `@font-face{font-family:"PB-${font.fontId}";font-weight:${font.weight};font-style:${font.style};src:url("/f/${font.fontId}/${font.weight}-${font.style}.woff2") format("woff2");font-display:block}`).join('');
  const display=spec.style.type.display,canvasFaces=hasCanvasTitle?[display,...(spec.scenes.some(scene=>scene.kind==='block'&&scene.block==='canvas-subtitle@1')?[spec.style.type.text]:[])]:[];
  const canvasFont=canvasFaces.filter((face,index)=>canvasFaces.findIndex(item=>item.fontId===face.fontId&&item.weight===face.weight)===index)
   .map(face=>`@font-face{font-family:"PBC-${face.fontId}-${face.weight}";font-weight:400;font-style:normal;src:url("/f/${face.fontId}/${face.weight}-${face.style??'normal'}.woff2") format("woff2");font-display:block}`).join('');
  const html = `<!doctype html><html data-om-signature="off"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}${canvasFont}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:${spec.style.palette.roles.bg}}#film{position:relative;width:${target.width}px;height:${target.height}px;overflow:hidden}</style><script src="/runtime/shim.js"></script><script defer src="/runtime/engine.js"></script><script defer src="/runtime/gsap.js"></script><script defer src="/runtime/compat.js"></script><script defer src="/runtime/blocks.js"></script>${usesWebgl?'<script defer src="/runtime/blocks-3d.js"></script>':''}${spec.scenes.filter(scene=>scene.kind==='custom').map(scene=>`<script defer src="/${scene.module}"></script>`).join('')}<script defer src="/runtime/boot.js"></script></head><body><main id="film"></main><script type="application/json" id="pb-plan">${safeJson(plan)}</script></body></html>`;
  return {html, csp, plan};
}
