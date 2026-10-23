import {filmFixture} from './fixture.mjs';
/** Original engineering material, not a product claim or a speaker's likeness. */
export function galleryFixture() {
  const spec = filmFixture();
  const slot = (text, role = 'headline', factIds = []) => ({text, role, factIds});
  spec.texts = {title: slot('Make room\nfor a good idea.'), feature: slot('A clearer view.'), second: slot('A little momentum.'),
    third: slot('A useful next step.'), metric: slot('30 fps', 'number', ['fixture-capture-rate']),
    caption: slot('Every frame has its place.', 'caption', ['fixture-caption']), speaker: slot('An original frame study.'),
    cta: slot('Make your next move.', 'cta', ['fixture-cta'])};
  const scenes = [
    ['hook-title', {textSlot: 'title'}], ['ui-showcase', {assetKey: 'dashboard', textSlot: 'feature'}],
    ['feature-grid', {items: [{textSlot: 'feature'}, {textSlot: 'second'}]}],
    ['curriculum', {items: [{textSlot: 'feature'}, {textSlot: 'second'}, {textSlot: 'third'}]}],
    ['ui-journey', {items: [{assetKey: 'dashboard', textSlot: 'feature'}, {assetKey: 'dashboard', textSlot: 'second'}]}],
    ['metric', {textSlot: 'metric'}], ['captions', {assetKey: 'dashboard', cues: [{textSlot: 'caption', start: 0, end: 50}]}],
    ['talking-head', {assetKey: 'dashboard', textSlot: 'speaker'}], ['cta-endcard', {textSlot: 'cta'}]
  ];
  spec.scenes = scenes.map(([id, params], index) => ({id, kind: 'block', block: id + '@1', start: index * 50, end: (index + 1) * 50,
    params, purpose: 'Exercise the trusted ' + id + ' block with original engineering material.'}));
  spec.audio = {music: {kind: 'procedural', style: 'mallet'}, sfx: 'auto', captions: 'off'};
  return spec;
}
