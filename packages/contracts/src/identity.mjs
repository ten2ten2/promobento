import { canonical, compareUtf16 } from './canonical.mjs';
import { digest } from './digest.mjs';

/** Pure functions: resolve the snapshot's pinned presets before passing rules here. */
export const targets = rules => rules.presets.flatMap(p => [p.defaultAspect, ...p.optionalAspects].map(aspectId => ({
  targetId: p.id + ':' + aspectId, presetId: p.id, aspectId, version: p.version,
  layout: rules.aspectLayouts[aspectId], encoding: rules.encodingProfiles[p.encodingProfile]
})));

/** Immutable fact-version key for trusted classification and live revocation registries; not billing identity. */
export const factVersionKey = (projectId, fact) => digest({
  projectId, factId: fact.factId, version: fact.version, textHash: digest(fact.text)
});

export function factContentIdentity(f) {
  const ordered = values => values.sort((a, b) => compareUtf16(canonical(a), canonical(b)));
  return {
    identityVersion: 1,
    facts: ordered(f.facts.map(({ factId, text }) => ({ factId, text }))),
    bindings: ordered(f.bindings.map(({ targetId, frameStart, frameEndExclusive, expectedText, factIds }) => ({
      targetId, frameStart, frameEndExclusive, expectedText, factIds: [...factIds].sort(compareUtf16)
    })))
  };
}

/** Resource bytes used by the work, independent of protocol and rights-record bookkeeping. */
export function resourceContentIdentity(manifest) {
  return { identityVersion: 1, resources: manifest.resources.map(({ path, sha256, byteLength, mediaType }) => ({
    path, sha256, byteLength, mediaType
  })).sort((a, b) => compareUtf16(a.path, b.path)) };
}

export function contentIdentity(c) {
  const identity = {
    identityVersion: c.identityVersion,
    durationSeconds: c.durationSeconds, fps: c.fps, totalFrames: c.totalFrames, seed: c.seed,
    sourceArchiveHash: c.sourceArchiveHash, dependencyManifestHash: c.dependencyManifestHash,
    resourceContentHash: c.resourceContentHash, layoutRulesHash: c.layoutRulesHash,
    factContentHash: c.factContentHash, runtimeVersion: c.runtimeVersion,
    variants: c.variants.map(({ targetId, entrypoint, sourceHash, targetOverrideHash, resourceContentHash, audioHash, variantHash, coverFrame }) => ({
      targetId, entrypoint, sourceHash, targetOverrideHash, resourceContentHash, audioHash, variantHash, coverFrame
    })).sort((a, b) => compareUtf16(a.targetId, b.targetId))
  };
  if (c.identityVersion === 2) identity.capabilityProfile = c.capabilityProfile;
  return identity;
}

function targetFor(variant, rules) {
  const target = targets(rules).find(t => t.targetId === variant.targetId);
  if (!target) throw new Error('INVALID_TARGET_PAIR');
  return target;
}

export function variantIdentity(c, v, rules) {
  const target = targetFor(v, rules);
  return {
    ...(c.identityVersion === 2 ? {identityVersion:2,capabilityProfile:c.capabilityProfile,aspectId:v.aspectId} : {}),
    sourceHash: v.sourceHash, layoutRulesHash: c.layoutRulesHash, targetOverrideHash: v.targetOverrideHash,
    dependencyManifestHash: c.dependencyManifestHash, resourceContentHash: v.resourceContentHash,
    audioHash: v.audioHash, factContentHash: c.factContentHash, seed: c.seed,
    totalFrames: c.totalFrames, fps: c.fps, layout: target.layout
  };
}

export function artifactIdentity(c, v, rules) {
  const target = targetFor(v, rules);
  return {
    ...(c.identityVersion === 2 ? {identityVersion:2,aspectId:v.aspectId} : {targetId:v.targetId}), variantHash: digest(variantIdentity(c, v, rules)),
    resourceManifestHash: v.resourceManifestHash,
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
    presetRulesVersion: c.presetRulesVersion, factContentHash: c.factContentHash, qaProfileVersion
  };
}

export const audioIdentity = manifest => ({
  audioEvents: manifest.audioEvents.map(event => Object.fromEntries([
    'kind', 'frameStart', 'frameEndExclusive', 'sourceHash', 'sourceOffsetFrames',
    'gainDb', 'fadeInFrames', 'fadeOutFrames', 'gainAutomation'
  ].filter(key => Object.hasOwn(event, key)).map(key => [key, event[key]]))),
  mixedAudio: manifest.mixedAudio === null ? null : {
    resourcePath: manifest.mixedAudio.resourcePath, sha256: manifest.mixedAudio.sha256,
    sampleRate: manifest.mixedAudio.sampleRate, channels: manifest.mixedAudio.channels
  }
});
