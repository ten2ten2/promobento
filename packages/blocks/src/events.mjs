/** The same local-frame landmarks are consumed by blocks and the immutable AudioPlan. */
export function blockEvents(id, frames, params) {
  const duration = frames.end - frames.start;
  const fixed = {'hook-title': ['title-land', 18], 'ui-showcase': ['product-land', 21], 'cta-endcard': ['cta-land', 15],
    metric: ['metric-land', 36], 'talking-head': ['speaker-land', 15], 'device-3d':['product-land',24]};
  let event = fixed[id];
  if (id === 'feature-grid' || id === 'curriculum') event = [id === 'curriculum' ? 'module-land' : 'feature-land', Math.round(((params.items.length - 1) * .12 + .5) * 30)];
  if (id === 'ui-journey') event = ['product-land', Math.max(0, duration - 24)];
  if (id === 'captions') event = ['caption-land', params.cues[0].start];
  if (!event) throw Error('BLOCK_UNKNOWN');
  return [{name: event[0], frame: Math.min(duration - 1, event[1])}];
}
export function filmBlockEvents(spec) {
  return spec.scenes.flatMap(scene => {
    if (scene.kind !== 'block') throw Error('CUSTOM_SCENES_NOT_IMPLEMENTED');
    return blockEvents(scene.block.split('@')[0], {start: scene.start, end: scene.end}, scene.params).map(event => ({...event, sceneId: scene.id}));
  });
}
