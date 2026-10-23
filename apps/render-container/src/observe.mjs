/** Trusted CDP snapshot and platform-font inspection; no page-supplied QA booleans. */
export async function observe(cdp, plan, renderId, frame) {
  const names = ['font-size', 'color', 'background-color', 'visibility', 'display', 'opacity', 'overflow'];
  const snapshot = await cdp.send('DOMSnapshot.captureSnapshot', {computedStyles: names, includePaintOrder: true});
  const strings = snapshot.strings, {nodes, layout} = snapshot.documents[0];
  const rowFor = new Map(layout.nodeIndex.map((node, row) => [node, row]));
  const attributes = node => new Map(Array.from({length: (nodes.attributes[node]?.length ?? 0) / 2}, (_, i) =>
    [strings[nodes.attributes[node][i * 2]], strings[nodes.attributes[node][i * 2 + 1]]]));
  const style = (node, key) => { const row = rowFor.get(node); return row === undefined ? null : strings[layout.styles[row][names.indexOf(key)]]; };
  const parent = node => nodes.parentIndex[node];
  const ancestor = (node, candidate) => { for (let current = node; current >= 0; current = parent(current)) if (current === candidate) return true; return false; };
  const color = text => {
    const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(text ?? '');
    return rgb ? {rgb: rgb.slice(1, 4).map(Number), alpha: rgb[4] === undefined ? 1 : Number(rgb[4])} : null;
  };
  const luminance = rgb => rgb.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; })
    .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const texts = [], regions = [], findings = [];
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable'); await cdp.send('DOM.getDocument');
  for (const [node, row] of rowFor) {
    const slotId = attributes(node).get('data-pb-slot'); if (!slotId) continue;
    let visible = true;
    for (let current = node; current >= 0; current = parent(current))
      if (style(current, 'visibility') === 'hidden' || style(current, 'display') === 'none' || style(current, 'opacity') === '0') visible = false;
    if (!visible) continue;
    const [x, y, width, height] = layout.bounds[row], box = {x, y, width, height};
    if (!width || !height) continue;
    const slot = plan.spec.texts[slotId]; if (!slot) throw Error('OBSERVATION_SLOT_UNKNOWN');
    const ref = plan.spec.style.type[['headline', 'cta', 'number'].includes(slot.role) ? 'display' : 'text'];
    const face = plan.fonts.find(face => face.fontId === ref.fontId && face.weight === ref.weight && face.style === (ref.style ?? 'normal'));
    if (!face?.codePoints) throw Error('FONT_CMAP_UNAVAILABLE');
    const coverage = new Set(face.codePoints);
    const descendants = nodes.nodeValue.map((value, index) => nodes.nodeType[index] === 3 && ancestor(index, node) ? strings[value] : '').join('');
    const missingGlyphs = [...descendants].filter(character => !/[\s\u200d\ufe0e\ufe0f]/u.test(character) && !coverage.has(character.codePointAt(0))).length;
    const {nodeIds} = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', {backendNodeIds: [nodes.backendNodeId[node]]});
    const {fonts} = await cdp.send('CSS.getPlatformFontsForNode', {nodeId: nodeIds[0]});
    const fallbackUsed = fonts.some(font => !font.isCustomFont) || Boolean(descendants.trim() && !fonts.length);
    let background;
    for (let current = node; current >= 0; current = parent(current)) { const candidate = color(style(current, 'background-color'));
      if (candidate?.alpha === 1) { background = candidate.rgb; break; } }
    const foreground = color(style(node, 'color'));
    if (!background || !foreground) throw Error('CONTRAST_OBSERVATION_UNAVAILABLE');
    const ratio = contrast(foreground.rgb, background), safe = plan.target.safeInsets;
    const insideSafeArea = x >= plan.target.width * safe.left - 2 && y >= plan.target.height * safe.top - 2
      && x + width <= plan.target.width * (1 - safe.right) + 2 && y + height <= plan.target.height * (1 - safe.bottom) + 2;
    let clipped = x < 0 || y < 0 || x + width > plan.target.width + 1 || y + height > plan.target.height + 1;
    for (let current = parent(node); current >= 0; current = parent(current)) {
      const parentRow = rowFor.get(current); if (parentRow === undefined || !['hidden', 'clip'].includes(style(current, 'overflow'))) continue;
      const [a, b, w, h] = layout.bounds[parentRow];
      if (x < a - 1 || y < b - 1 || x + width > a + w + 1 || y + height > b + h + 1) clipped = true;
    }
    const hit = await cdp.send('DOM.getNodeForLocation', {x: Math.round(x + width / 2), y: Math.round(y + height / 2), ignorePointerEventsNone: true});
    const hitNode = nodes.backendNodeId.indexOf(hit.backendNodeId);
    const covered = hitNode >= 0 && !ancestor(hitNode, node) && !ancestor(node, hitNode);
    texts.push({slotId, text: descendants, box, fonts: fonts.map(font => ({family: font.familyName, glyphCount: font.glyphCount})),
      fallbackUsed, missingGlyphs, contrastRatio: Math.max(1, Math.min(21, ratio)), largeText: Number.parseFloat(style(node, 'font-size')) >= 32,
      insideSafeArea, clipped, covered});
    regions.push({regionId: slotId, box});
    for (const [condition, code] of [[fallbackUsed, 'FONT_FALLBACK_USED'], [missingGlyphs > 0, 'FONT_GLYPH_MISSING'],
      [!insideSafeArea, 'outside-safe-area'], [clipped, 'text-clipped'], [covered, 'text-covered'], [ratio < 4.5, 'low-contrast']])
      if (condition) findings.push({code, severity: code === 'text-covered' ? 'REVIEW' : 'BLOCK', slotId});
  }
  return {schemaVersion: '3.0.0', kind: 'frame_observation', renderId, aspectId: plan.target.aspect, frame, texts, regions, findings};
}
