import { canonical, parseCanonicalJson } from '@promobento/contracts/canonical';
import { digest } from '@promobento/contracts/digest';
import { filmSpecErrors } from '@promobento/contracts/film';
import { createSchemaValidator } from '@promobento/contracts/validation';
import { validate } from '@promobento/contracts/validators/film';
import { blockCatalog } from '../../blocks/src/catalog.ts';
import type { FilmSpec } from '../../../contracts/film-runtime.d.ts';
import type { PageOptions, PagePlan } from './types.ts';

const blocks = new Map(blockCatalog.map(block => [block.id as string, {
  major: 1, validateParams: createSchemaValidator({$id: 'https://promobento.com/blocks/' + block.id + '/1', ...block.params})
}]));
const safeJson = (value: unknown): string => canonical(value).replace(/</g, '\\u003c');

/** Trusted Node build entry, never a Worker endpoint or an authorization service. No author code is evaluated. */
export function generateFilmPage(raw: string | Uint8Array, options: PageOptions): { html: string; csp: string; plan: PagePlan } {
  const maxBytes = 8 * 1024 * 1024;
  if (typeof raw === 'string' ? raw.length > maxBytes || new TextEncoder().encode(raw).byteLength > maxBytes : raw.byteLength > maxBytes)
    throw Error('FILM_SOURCE_TOO_LARGE');
  const data = parseCanonicalJson(raw);
  if (!validate(data)) throw Error('FILM_SCHEMA_INVALID: ' + (validate.errors?.[0]?.instancePath ?? ''));
  const spec = data as FilmSpec;
  if (spec.style.texture && spec.style.texture.kind !== 'none') throw Error('TEXTURE_NOT_IMPLEMENTED');
  if (!options || !Array.isArray(options.confirmedFactIds) || !Array.isArray(options.resources) || !Array.isArray(options.fonts))
    throw Error('FILM_TRUSTED_CONTEXT_REQUIRED');
  const resources = new Map(options.resources.map(resource => [resource.resourceId, resource]));
  const result = filmSpecErrors(spec, {
    blocks, resources, confirmedFactIds: new Set(options.confirmedFactIds), fontIds: new Set(options.fonts.map(font => font.fontId))
  });
  if (result.errors.length) throw Error(result.errors.map(issue => issue.code + ':' + issue.path).join('; '));
  const target = {...options.target, safeInsets: {...options.target.safeInsets}};
  if (!['landscape', 'portrait', 'feed', 'square'].includes(target.aspect) || target.fps !== 30 || target.totalFrames !== spec.totalFrames
    || !Number.isSafeInteger(target.width) || target.width < 1 || !Number.isSafeInteger(target.height) || target.height < 1
    || ![options.initTimeoutMs, options.frameTimeoutMs].every(value => Number.isSafeInteger(value) && value > 0)
    || typeof options.seed !== 'string') throw Error('FILM_PAGE_OPTIONS_INVALID');
  for (const side of ['top', 'right', 'bottom', 'left'] as const)
    if (!Number.isFinite(target.safeInsets[side]) || target.safeInsets[side] < 0 || target.safeInsets[side] >= 0.5) throw Error('SAFE_INSETS_INVALID');
  for (const scene of spec.scenes) {
    if (scene.kind === 'custom') throw Error('CUSTOM_SCENES_NOT_IMPLEMENTED');
    if (scene.layout && Object.keys(scene.layout).length) throw Error('LAYOUT_OVERRIDES_NOT_IMPLEMENTED');
    if (scene.transitionIn && !['cut', 'crossfade', 'push', 'whip'].includes(scene.transitionIn.type)) throw Error('TRANSITION_NOT_IMPLEMENTED');
    for (const key of ['textSlot', 'subtitleSlot'])
      if (typeof scene.params[key] === 'string' && !Object.hasOwn(spec.texts, scene.params[key])) throw Error('TEXT_SLOT_UNKNOWN');
    for (const key of ['assetKey', 'logoKey'])
      if (typeof scene.params[key] === 'string' && !Object.hasOwn(spec.assets, scene.params[key])) throw Error('ASSET_SLOT_UNKNOWN');
    if (typeof scene.params.focus === 'string') {
      const asset = spec.assets[String(scene.params.assetKey)];
      if (!asset?.roi?.[Number(scene.params.focus.slice(4))]) throw Error('ASSET_ROI_UNKNOWN');
    }
  }
  const fonts = Object.values(spec.style.type).filter((value): value is NonNullable<typeof spec.style.type.mono> => typeof value === 'object')
    .map(ref => {
      const font = options.fonts.find(item => item.fontId === ref.fontId && item.weight === ref.weight && item.style === (ref.style ?? 'normal'));
      if (!font?.rightsCleared || !font.licenseRef) throw Error('FONT_RIGHTS_OR_FACE_MISSING');
      return font;
    });
  const assets: PagePlan['assets'] = {};
  for (const [key, slot] of Object.entries(spec.assets)) {
    if (slot.crop) throw Error('ASSET_CROP_NOT_IMPLEMENTED');
    const resource = resources.get(slot.resourceId);
    if (!resource?.rightsCleared || !resource.licenseRef) throw Error('ASSET_RIGHTS_PENDING');
    if (!['image', 'svg'].includes(resource.kind)) throw Error('ASSET_KIND_NOT_IMPLEMENTED');
    if (![resource.width, resource.height].every(value => Number.isSafeInteger(value) && value > 0)) throw Error('ASSET_DIMENSIONS_INVALID');
    assets[key] = {resourceId: slot.resourceId, kind: resource.kind, width: resource.width, height: resource.height,
      url: '/r/' + slot.resourceId, roi: slot.roi ?? []};
  }
  const plan: PagePlan = {spec, target: {aspect:target.aspect,width:target.width,height:target.height,
    safeInsets:{top:target.safeInsets.top,right:target.safeInsets.right,bottom:target.safeInsets.bottom,left:target.safeInsets.left},
    fps:30,totalFrames:spec.totalFrames}, seed: options.seed, manifestHash: digest(spec), assets, fonts,
    initTimeoutMs: options.initTimeoutMs, frameTimeoutMs: options.frameTimeoutMs};
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const css = [...new Map(fonts.map(font => [`${font.fontId}/${font.weight}/${font.style}`, font])).values()].map(font =>
    `@font-face{font-family:"PB-${font.fontId}";font-weight:${font.weight};font-style:${font.style};src:url("/f/${font.fontId}/${font.weight}.woff2") format("woff2");font-display:block}`).join('');
  const html = `<!doctype html><html data-om-signature="off"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:${spec.style.palette.roles.bg}}#film{position:relative;width:${target.width}px;height:${target.height}px;overflow:hidden}</style><script src="/runtime/shim.js"></script><script defer src="/runtime/engine.js"></script><script defer src="/runtime/blocks.js"></script><script defer src="/runtime/boot.js"></script></head><body><main id="film"></main><script type="application/json" id="pb-plan">${safeJson(plan)}</script></body></html>`;
  return {html, csp, plan};
}
