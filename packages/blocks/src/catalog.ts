const slot = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' };
const common = {
  schemaVersion: '3.0.0', version: '1.0.0', kind: 'block_manifest',
  aspects: ['landscape', 'portrait', 'feed', 'square'], cost: 'low', usesGsap: false, usesWebgl: false,
  goldenFrames: [0, 12, 45], editable: []
};
export const blockCatalog = [
  { ...common, id: 'hook-title', category: 'opening', usesGsap: true, regions: ['headline'],
    events: [{name: 'title-land', description: 'Headline settles into its reading position.'}],
    params: { type: 'object', additionalProperties: false, required: ['textSlot'],
      properties: { textSlot: slot, subtitleSlot: slot } } },
  { ...common, id: 'ui-showcase', category: 'software', regions: ['product'],
    events: [{name: 'product-land', description: 'The real product image settles.'}],
    params: { type: 'object', additionalProperties: false, required: ['assetKey'],
      properties: { assetKey: slot, textSlot: slot, focus: {type: 'string', pattern: '^roi:[0-7]$'} } } },
  { ...common, id: 'cta-endcard', category: 'closing', regions: ['cta'],
    events: [{name: 'cta-land', description: 'Call to action reaches its reading hold.'}],
    params: { type: 'object', additionalProperties: false, required: ['textSlot'],
      properties: { textSlot: slot, subtitleSlot: slot, logoKey: slot } } },
  { ...common, id: 'feature-grid', version: '1.0.1', category: 'software', regions: ['features'],
    events: [{name: 'feature-land', description: 'Feature cards finish their staggered reveal.'}],
    params: {type: 'object', additionalProperties: false, required: ['items'], properties: {
      textSlot: slot, items: {type: 'array', minItems: 2, maxItems: 4, items: {type: 'object', additionalProperties: false,
        required: ['textSlot'], properties: {textSlot: slot, subtitleSlot: slot, assetKey: slot}}}}}},
  { ...common, id: 'curriculum', category: 'course', regions: ['modules'],
    events: [{name: 'module-land', description: 'The final curriculum module is revealed.'}],
    params: {type: 'object', additionalProperties: false, required: ['items'], properties: {
      textSlot: slot, items: {type: 'array', minItems: 2, maxItems: 4, items: {type: 'object', additionalProperties: false,
        required: ['textSlot'], properties: {textSlot: slot, subtitleSlot: slot}}}}}},
  { ...common, id: 'ui-journey', category: 'software', cost: 'medium', regions: ['journey'],
    events: [{name: 'product-land', description: 'The camera arrives at the final interface.'}],
    params: {type: 'object', additionalProperties: false, required: ['items'], properties: {
      items: {type: 'array', minItems: 2, maxItems: 4, items: {type: 'object', additionalProperties: false,
        required: ['assetKey', 'textSlot'], properties: {textSlot: slot, assetKey: slot}}}}}},
  { ...common, id: 'metric', category: 'data', regions: ['metric'],
    events: [{name: 'metric-land', description: 'The fact-bound number reaches its final value.'}],
    params: {type: 'object', additionalProperties: false, required: ['textSlot'], properties: {textSlot: slot, subtitleSlot: slot}}},
  { ...common, id: 'captions', category: 'course', regions: ['captions'],
    events: [{name: 'caption-land', description: 'The first confirmed caption is shown.'}],
    params: {type: 'object', additionalProperties: false, required: ['cues'], properties: {assetKey: slot,
      cues: {type: 'array', minItems: 1, maxItems: 100, items: {type: 'object', additionalProperties: false,
        required: ['textSlot', 'start', 'end'], properties: {textSlot: slot, start: {type: 'integer', minimum: 0, maximum: 899},
          end: {type: 'integer', minimum: 1, maximum: 900}}}}}}},
  { ...common, id: 'talking-head', category: 'course', cost: 'medium', regions: ['speaker'],
    events: [{name: 'speaker-land', description: 'The speaker nameplate settles.'}],
    params: {type: 'object', additionalProperties: false, required: ['assetKey', 'textSlot'], properties: {
      assetKey: slot, textSlot: slot, subtitleSlot: slot}}},
  { ...common, id: 'device-3d', category: '3d', cost: 'high', usesWebgl: true, regions: ['product'],
    events: [{name:'product-land',description:'The real product screen settles on an original 3D display.'}],
    params:{type:'object',additionalProperties:false,required:['assetKey'],properties:{assetKey:slot,textSlot:slot}}}
] as const;

export {blockReferences} from '@promobento/contracts/film';
