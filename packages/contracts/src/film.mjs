// Cross-field rules for FilmSpec (film-v1). The JSON Schema checks shape; these check coverage,
// references and fact binding. Pure functions: the caller supplies what the project actually has.

const CLAIM_PATTERN = /[0-9%$€£¥₹]/u;
const CLAIM_ROLES = new Set(['number', 'quote', 'cta']);

/** Aspect-level render identity: targets that share an aspect share one rendered film (plan D9). */
export const ASPECTS = Object.freeze(['landscape', 'portrait', 'feed', 'square']);

/**
 * @param {object} spec a FilmSpec that already passed film.schema.json
 * @param {object} [context]
 * @param {Set<string>} [context.confirmedFactIds] facts the user confirmed for this revision
 * @param {Map<string,{rightsCleared:boolean, kind?:string}>} [context.resources]
 * @param {Map<string,{major:number, validateParams?:(params:object)=>string[]}>} [context.blocks]
 * @param {Set<string>} [context.fontIds]
 * @returns {{errors: {code:string, path:string}[], reviews: {code:string, path:string}[]}}
 */
export function filmSpecErrors(spec, context = {}) {
  const errors = [], reviews = [];
  const fail = (code, path) => errors.push({code, path});
  const review = (code, path) => reviews.push({code, path});
  const total = spec.totalFrames;

  // Scenes: unique ids, positive length, full coverage of [0,total) with overlaps only at transitions.
  const ids = new Set();
  spec.scenes.forEach((scene, i) => {
    if (ids.has(scene.id)) fail('SCENE_ID_DUPLICATE', `/scenes/${i}/id`);
    ids.add(scene.id);
    if (scene.end <= scene.start) fail('SCENE_EMPTY', `/scenes/${i}`);
    if (scene.end > total) fail('SCENE_AFTER_END', `/scenes/${i}/end`);
  });
  const ordered = spec.scenes.map((scene, index) => ({scene, index})).sort((a, b) => a.scene.start - b.scene.start || a.index - b.index);
  if (ordered[0].scene.start !== 0) fail('COVERAGE_GAP', `/scenes/${ordered[0].index}/start`);
  if ((ordered[0].scene.transitionIn?.frames ?? 0) > 0) fail('TRANSITION_WITHOUT_PREVIOUS', `/scenes/${ordered[0].index}/transitionIn`);
  if (Math.max(...spec.scenes.map(s => s.end)) !== total) fail('COVERAGE_SHORT', '/scenes');
  for (let k = 1; k < ordered.length; k++) {
    const prev = ordered[k - 1].scene, {scene, index} = ordered[k];
    if (scene.start > prev.end) fail('COVERAGE_GAP', `/scenes/${index}/start`);
    const overlap = prev.end - scene.start;
    const transition = scene.transitionIn;
    if (ordered.slice(0, k).filter(item => item.scene.end > scene.start).length > 1) fail('TRANSITION_TRIPLE_OVERLAP', `/scenes/${index}/start`);
    if (transition?.type === 'cut' && transition.frames !== 0) fail('CUT_WITH_DURATION', `/scenes/${index}/transitionIn`);
    if (transition && transition.type !== 'cut' && transition.frames === 0) fail('TRANSITION_EMPTY', `/scenes/${index}/transitionIn`);
    if (overlap <= 0 && (transition?.frames ?? 0) > 0) fail('TRANSITION_WITHOUT_OVERLAP', `/scenes/${index}/transitionIn`);
    if (overlap > 0) {
      const frames = scene.transitionIn?.frames ?? 0;
      if (overlap !== frames || !transition || transition.type === 'cut') fail('OVERLAP_WITHOUT_TRANSITION', `/scenes/${index}/start`);
      if (frames >= Math.min(prev.end - prev.start, scene.end - scene.start)) fail('TRANSITION_TOO_LONG', `/scenes/${index}/transitionIn`);
    }
  }
  spec.scenes.forEach((scene, i) => {
    if (scene.kind === 'custom' && scene.module !== `scenes/${scene.id}/index.js`) fail('SCENE_MODULE_ID_MISMATCH', `/scenes/${i}/module`);
  });

  // Text slots: commercial claims must be bound to confirmed facts (PRD 14 §8).
  for (const [slotId, slot] of Object.entries(spec.texts)) {
    const path = `/texts/${slotId}`;
    const claim = CLAIM_ROLES.has(slot.role) || CLAIM_PATTERN.test(slot.text);
    if (claim && slot.factIds.length === 0) fail('CLAIM_UNBOUND', path);
    if (context.confirmedFactIds) for (const factId of slot.factIds)
      if (!context.confirmedFactIds.has(factId)) fail('FACT_UNCONFIRMED', `${path}/factIds`);
  }

  // Assets: every slot points at a rights-cleared resource.
  if (context.resources) for (const [key, slot] of Object.entries(spec.assets)) {
    const resource = context.resources.get(slot.resourceId);
    if (!resource) fail('ASSET_UNKNOWN', `/assets/${key}`);
    else if (!resource.rightsCleared) fail('ASSET_RIGHTS_PENDING', `/assets/${key}`);
  }
  if (context.resources) {
    const kinds = Object.values(spec.assets).map(slot => context.resources.get(slot.resourceId)?.kind).filter(Boolean);
    if (kinds.length === 0) review('no-real-material', '/assets');
    else if (kinds.every(kind => kind === 'logo')) review('only-logo', '/assets');
  }

  // Blocks and fonts exist; block params satisfy the block's own Schema.
  if (context.blocks) spec.scenes.forEach((scene, i) => {
    if (scene.kind !== 'block') return;
    const [id, major] = scene.block.split('@');
    const block = context.blocks.get(id);
    if (!block || block.major !== Number(major)) { fail('BLOCK_UNKNOWN', `/scenes/${i}/block`); return; }
    for (const message of block.validateParams?.(scene.params) ?? []) fail('BLOCK_PARAMS_INVALID', `/scenes/${i}/params${message.startsWith('/') ? message : ''}`);
  });
  if (context.fontIds) for (const role of ['display', 'text', 'mono']) {
    const font = spec.style.type[role];
    if (font && !context.fontIds.has(font.fontId)) fail('FONT_UNKNOWN', `/style/type/${role}`);
  }

  // Treatment timing stays inside the film.
  spec.treatment.energyCurve.forEach((point, i) => { if (point.frame > total) fail('TREATMENT_AFTER_END', `/treatment/energyCurve/${i}`); });
  (spec.treatment.holds ?? []).forEach((hold, i) => {
    if (hold.end <= hold.start || hold.end > total) fail('TREATMENT_HOLD_INVALID', `/treatment/holds/${i}`);
  });
  return {errors, reviews};
}
