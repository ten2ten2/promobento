/** Enumerate the supplied platform rules for configuration checks and offline cost estimates. */
export const targets = rules => rules.presets.flatMap(p => [p.defaultAspect, ...p.optionalAspects].map(aspectId => ({
  targetId: p.id + ':' + aspectId, presetId: p.id, aspectId, version: p.version,
  layout: rules.aspectLayouts[aspectId], encoding: rules.encodingProfiles[p.encodingProfile]
})));
