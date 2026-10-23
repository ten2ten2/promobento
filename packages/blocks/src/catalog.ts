const slot = { type: 'string', pattern: '^[a-z][a-z0-9-]{0,47}$' };
const common = {
  schemaVersion: '3.0.0', version: '1.0.0', kind: 'block_manifest',
  aspects: ['landscape', 'portrait', 'feed', 'square'], cost: 'low', usesGsap: false, usesWebgl: false,
  goldenFrames: [0, 12, 45], editable: []
};
export const blockCatalog = [
  { ...common, id: 'hook-title', category: 'opening', regions: ['headline'],
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
      properties: { textSlot: slot, subtitleSlot: slot, logoKey: slot } } }
] as const;
