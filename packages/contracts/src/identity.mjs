import { compareUtf16 } from './canonical.mjs';
import { digest } from './digest.mjs';

/** Pure functions: resolve the snapshot's pinned presets before passing rules here. */
export const targets = rules => rules.presets.flatMap(p => [p.defaultAspect, ...p.optionalAspects].map(aspectId => ({
  targetId: p.id + ':' + aspectId, presetId: p.id, aspectId, version: p.version,
  layout: rules.aspectLayouts[aspectId], encoding: rules.encodingProfiles[p.encodingProfile]
})));

export function factContentIdentity(f) {
  const { projectId, revisionId, exampleOnly, ...rest } = f;
  return { ...rest,
    facts: rest.facts.map(({ confirmedBy, confirmedAt, evidenceRefs, ...fact }) => fact),
    bindings: rest.bindings.map(({ coverage, ...binding }) => binding)
  };
}

export function contentIdentity(c) {
  const { projectId, revisionId, exampleOnly, releaseEligible, factManifestHash, styleLabel, renderProfile, ...rest } = c;
  return { ...rest, variants: rest.variants.map(({ qaReportHash, ...v }) => v)
    .sort((a, b) => compareUtf16(a.targetId, b.targetId)) };
}

function targetFor(variant, rules) {
  const target = targets(rules).find(t => t.targetId === variant.targetId);
  if (!target) throw new Error('INVALID_TARGET_PAIR');
  return target;
}

export function variantIdentity(c, v, rules) {
  const target = targetFor(v, rules);
  return {
    sourceHash: v.sourceHash, layoutRulesHash: c.layoutRulesHash, targetOverrideHash: v.targetOverrideHash,
    dependencyManifestHash: c.dependencyManifestHash, resourceManifestHash: v.resourceManifestHash,
    audioHash: v.audioHash, factContentHash: c.factContentHash, seed: c.seed,
    totalFrames: c.totalFrames, fps: c.fps, layout: target.layout
  };
}

export function artifactIdentity(c, v, rules) {
  const target = targetFor(v, rules);
  return {
    targetId: v.targetId, variantHash: digest(variantIdentity(c, v, rules)),
    runtimeVersion: c.runtimeVersion, rendererImageDigest: c.rendererImageDigest,
    renderProfile: c.renderProfile, encoding: target.encoding, layout: target.layout
  };
}

export function outputArtifactIdentity(c, v, kind, markingProfileVersion, rules) {
  if (typeof markingProfileVersion !== 'string' || !markingProfileVersion) throw new Error('MARKING_PROFILE_REQUIRED');
  const render = artifactIdentity(c, v, rules);
  if (kind === 'video') return { kind, render, markingProfileVersion };
  if (kind === 'cover') return { kind, render, markingProfileVersion, coverFrame: v.coverFrame, encoding: 'jpg_v1' };
  if (kind === 'mapping') return {
    kind, targetId: v.targetId, presetRulesVersion: c.presetRulesVersion,
    videoFingerprint: digest(outputArtifactIdentity(c, v, 'video', markingProfileVersion, rules)),
    coverFingerprint: digest(outputArtifactIdentity(c, v, 'cover', markingProfileVersion, rules)), encoding: 'mapping_v1'
  };
  throw new Error('INVALID_ARTIFACT_KIND');
}

export function qaInputIdentity(c, v, qaProfileVersion, rules) {
  if (typeof qaProfileVersion !== 'string' || !qaProfileVersion) throw new Error('QA_PROFILE_REQUIRED');
  return {
    targetId: v.targetId, coverFrame: v.coverFrame, artifact: artifactIdentity(c, v, rules),
    presetRulesVersion: c.presetRulesVersion, factManifestHash: c.factManifestHash, qaProfileVersion
  };
}

export const audioIdentity = manifest => ({ audioEvents: manifest.audioEvents, mixedAudio: manifest.mixedAudio });
