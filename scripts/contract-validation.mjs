// Specification/fixture checker, not a production authorization or browser sandbox.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const ROOT = new URL('../', import.meta.url);
export const load = path => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
export const schema = load('contracts/production.schema.json');
export const presets = load('config/platform-presets.json');
/** Configuration gate only; this does not enforce live account/project rolling ledgers. */
export function hasCalibratedCostLimits(policy) {
  const cost = policy?.cost, patch = policy?.patch;
  if (!cost || !patch || !['maxMicrosPerUserWindow','maxMicrosPerProjectWindow'].every(key => Object.hasOwn(cost,key))) return false;
  const limits = Object.entries(cost).filter(([key]) => key.startsWith('maxMicros') || ['dailySoftAlertMicros','maxDailyFreeMicros'].includes(key));
  return limits.every(([,value]) => Number.isSafeInteger(value) && value > 0)
    && cost.usageWindowHours === 24 && cost.usageWindowMode === 'rolling_all_actual_and_unsettled_costs'
    && typeof cost.priceVersion === 'string' && cost.priceVersion.length > 0
    && Number.isSafeInteger(patch.maxInputTokensPerRound) && patch.maxInputTokensPerRound > 0
    && Number.isSafeInteger(patch.maxOutputTokensPerRound) && patch.maxOutputTokensPerRound > 0;
}
export const canonical = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error('NON_FINITE'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw Error('NOT_JSON');
};
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const supported = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'anyOf', 'oneOf']);
// Fail closed on unsupported schema vocabulary. CI/app must also validate with a full Draft 2020-12 implementation.
export function validateSchema(value, rule = schema, at = '$', depth = 0) {
  if (depth > 64) throw Error('MAX_DEPTH');
  for (const key of Object.keys(rule)) if (!supported.has(key)) throw Error('UNSUPPORTED_SCHEMA_KEYWORD:' + key);
  if (rule.$ref) {
    if (!rule.$ref.startsWith('#/$defs/')) throw Error('REMOTE_SCHEMA_REF');
    const name = rule.$ref.slice(8);
    if (!Object.hasOwn(schema.$defs,name)) throw Error('UNKNOWN_SCHEMA_REF');
    const target = schema.$defs[name];
    return validateSchema(value, target, at, depth + 1);
  }
  if (rule.oneOf || rule.anyOf) {
    const choices = rule.oneOf ?? rule.anyOf;
    const ok = choices.filter(s => validateSchema(value, s, at, depth + 1).length === 0).length;
    return (rule.oneOf ? ok === 1 : ok > 0) ? [] : [at + ': union mismatch'];
  }
  const errors = [], add = message => errors.push(at + ': ' + message);
  if ('const' in rule && canonical(value) !== canonical(rule.const)) add('const');
  if (rule.enum && !rule.enum.some(x => canonical(value) === canonical(x))) add('enum');
  if (rule.type) {
    const t = rule.type;
    const matches = t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : t === 'integer' ? Number.isSafeInteger(value) : t === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === t;
    if (!matches) return errors.concat(at + ': type ' + t);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (rule.minLength !== undefined && length < rule.minLength) add('minLength');
    if (rule.maxLength !== undefined && length > rule.maxLength) add('maxLength');
    if (rule.pattern && !new RegExp(rule.pattern, 'u').test(value)) add('pattern');
  }
  if (typeof value === 'number') {
    if (rule.minimum !== undefined && value < rule.minimum) add('minimum');
    if (rule.maximum !== undefined && value > rule.maximum) add('maximum');
  }
  if (Array.isArray(value)) {
    if (rule.minItems !== undefined && value.length < rule.minItems) add('minItems');
    if (rule.maxItems !== undefined && value.length > rule.maxItems) add('maxItems');
    if (rule.uniqueItems && new Set(value.map(canonical)).size !== value.length) add('uniqueItems');
    if (rule.items) value.forEach((x, i) => errors.push(...validateSchema(x, rule.items, at + '[' + i + ']', depth + 1)));
  } else if (value && typeof value === 'object') {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) add('missing ' + key);
    for (const [key, x] of Object.entries(value)) {
      if (rule.properties && Object.hasOwn(rule.properties,key)) errors.push(...validateSchema(x, rule.properties[key], at + '.' + key, depth + 1));
      else if (rule.additionalProperties === false) add('unknown ' + key);
      else if (rule.additionalProperties && typeof rule.additionalProperties === 'object') errors.push(...validateSchema(x, rule.additionalProperties, at + '.' + key, depth + 1));
    }
  }
  return errors;
}
export const targets = (rules = presets) => rules.presets.flatMap(p => [p.defaultAspect, ...p.optionalAspects].map(aspectId => ({targetId: p.id + ':' + aspectId, presetId: p.id, aspectId, version: p.version, layout: rules.aspectLayouts[aspectId], encoding: rules.encodingProfiles[p.encodingProfile]})));
/** Billing identities exclude attestations and transport identities, never user-visible text. */
export function factContentIdentity(f) {
  const {projectId, revisionId, exampleOnly, ...rest} = f;
  return {...rest,
    facts: rest.facts.map(({confirmedBy, confirmedAt, evidenceRefs, ...fact}) => fact),
    bindings: rest.bindings.map(({coverage, ...binding}) => binding)};
}
export function contentIdentity(c) {
  const {projectId, revisionId, exampleOnly, releaseEligible, factManifestHash, styleLabel, ...rest} = c;
  return {...rest, variants: rest.variants.map(({qaReportHash, ...v}) => v).sort((a, b) => a.targetId.localeCompare(b.targetId, 'en'))};
}
export function variantIdentity(c, v, rules = presets) {
  const target = targets(rules).find(t => t.targetId === v.targetId);
  if (!target) throw Error('INVALID_TARGET_PAIR');
  return {sourceHash:v.sourceHash, layoutRulesHash:c.layoutRulesHash, targetOverrideHash:v.targetOverrideHash,
    dependencyManifestHash:c.dependencyManifestHash,
    resourceManifestHash:v.resourceManifestHash, audioHash:v.audioHash,
    factContentHash:c.factContentHash, seed:c.seed, totalFrames:c.totalFrames, fps:c.fps,
    layout:target.layout};
}
export function artifactIdentity(c, v, rules = presets) {
  const target = targets(rules).find(t => t.targetId === v.targetId);
  if (!target) throw Error('INVALID_TARGET_PAIR');
  return {variantHash:digest(variantIdentity(c,v,rules)), runtimeVersion:c.runtimeVersion,
    rendererImageDigest:c.rendererImageDigest, encoding:target.encoding, layout:target.layout};
}
/** The cache key for an output includes all choices that can change that output. */
export function outputArtifactIdentity(c, v, kind, markingProfileVersion, rules = presets) {
  if (typeof markingProfileVersion !== 'string' || !markingProfileVersion) throw Error('MARKING_PROFILE_REQUIRED');
  const render = artifactIdentity(c, v, rules);
  if (kind === 'video') return {kind, render, markingProfileVersion};
  if (kind === 'cover') return {kind, render, markingProfileVersion, coverFrame:v.coverFrame, encoding:'jpg_v1'};
  if (kind === 'mapping') return {kind, targetId:v.targetId, presetRulesVersion:c.presetRulesVersion,
    videoFingerprint:digest(outputArtifactIdentity(c,v,'video',markingProfileVersion,rules)),
    coverFingerprint:digest(outputArtifactIdentity(c,v,'cover',markingProfileVersion,rules)), encoding:'mapping_v1'};
  throw Error('INVALID_ARTIFACT_KIND');
}
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
/** Run at the asset broker before first use, including preview. Context comes from trusted storage, never a request body. */
export function resourceRightsErrors(resource, context = {}) {
  const errors = validateSchema(resource, schema.$defs.resource);
  if (errors.length) return errors;
  const fail = (ok, code) => { if (!ok) errors.push(code); };
  fail(!!context.workspaceId && !!context.projectId, 'RESOURCE_SCOPE_REQUIRED');
  fail(['preview','commercial_export'].includes(context.intendedUse), 'RESOURCE_USE_REQUIRED');
  fail(own(context.assetBindings, resource.sha256) === resource.licenseRef, 'RESOURCE_LICENSE_BINDING_MISMATCH');
  const version = own(context.licenseVersions, resource.licenseRef);
  const record = own(own(context.licenseRegistry, resource.licenseRef), version);
  fail(!!record, 'LICENSE_RECORD_UNAVAILABLE');
  if (!record) return errors;
  if (context.production) fail(record.exampleOnly !== true, 'FIXTURE_LICENSE_IN_PRODUCTION');
  fail(record.assetHash === resource.sha256, 'LICENSE_ASSET_MISMATCH');
  fail(record.scope === 'platform' || (record.scope === 'customer' && !!context.workspaceId && !!context.projectId
    && record.workspaceId === context.workspaceId && record.projectId === context.projectId), 'LICENSE_SCOPE_MISMATCH');
  fail(['platform_created','third_party_license','customer_declaration'].includes(record.basis)
    && !(record.scope === 'platform' && record.basis === 'customer_declaration') && hash(record.evidenceHash), 'LICENSE_BASIS_MISSING');
  fail(record.allowedUses?.includes(context.intendedUse), 'LICENSE_USE_NOT_ALLOWED');
  return errors;
}
/** This checks stored decisions and byte bindings; it does not detect AI content or certify a legal conclusion. */
function markingErrors(output, context) {
  const errors = [], fail = (ok, code) => { if (!ok) errors.push(code); };
  const profile = own(context.markingProfiles, output.markingProfileVersion);
  fail(!!profile && !!profile.decisionRef, 'MARKING_PROFILE_UNAVAILABLE');
  if (!profile) return errors;
  if (context.production) fail(profile.exampleOnly !== true, 'FIXTURE_MARKING_IN_PRODUCTION');
  for (const field of ['machineMarking','audienceDisclosure']) fail(['required','not_applicable'].includes(profile[field]), 'MARKING_DECISION_REQUIRED');
  const evidence = own(context.markingEvidence, output.markingEvidenceRef);
  fail(!!evidence, 'MARKING_EVIDENCE_REQUIRED');
  if (!evidence) return errors;
  if (context.production) fail(evidence.exampleOnly !== true, 'FIXTURE_MARKING_IN_PRODUCTION');
  fail(hash(output.sha256) && evidence.sha256 === output.sha256 && evidence.outputId === output.id
    && evidence.profileVersion === output.markingProfileVersion, 'MARKING_BYTES_MISMATCH');
  fail(!!context.workspaceId && evidence.workspaceId === context.workspaceId && evidence.projectId === output.projectId
    && evidence.revisionId === output.revisionId, 'MARKING_SCOPE_MISMATCH');
  if (output.artifactFingerprint) fail(evidence.artifactFingerprint === output.artifactFingerprint, 'MARKING_FINGERPRINT_MISMATCH');
  else {
    fail(typeof output.screenshotAssetId === 'string' && evidence.assetId === output.screenshotAssetId, 'MARKING_ASSET_MISMATCH');
    fail(evidence.targetId === output.targetId && evidence.frameStart === output.frameStart
      && evidence.frameEndExclusive === output.frameEndExclusive, 'MARKING_PREVIEW_IDENTITY_MISMATCH');
  }
  for (const field of ['machineMarking','audienceDisclosure']) fail(evidence[field] === (profile[field] === 'required' ? 'verified' : 'not_applicable'), 'MARKING_CHECK_INCOMPLETE');
  return errors;
}
export function semanticErrors(v, context = {}) {
  const errors = validateSchema(v);
  if (errors.length) return errors;
  const fail = (ok, message) => { if (!ok) errors.push(message); };
  if (v.kind === 'run_result') {
    const t = v.treatment, a = v.audioPlan, outer = context.composition?.totalFrames;
    if (t) {
      if (outer) fail(t.totalFrames === outer, 'TREATMENT_DURATION_MISMATCH');
      for (const beat of t.beats) fail(beat.frameEndExclusive > beat.frameStart && beat.frameEndExclusive <= t.totalFrames, 'TREATMENT_INTERVAL_INVALID');
    }
    if (a) {
      if (outer) fail(a.totalFrames === outer, 'AUDIO_PLAN_DURATION_MISMATCH');
      if (t) fail(a.totalFrames === t.totalFrames, 'CREATIVE_PLAN_DURATION_MISMATCH');
      for (const cue of a.events) fail(cue.frameEndExclusive > cue.frameStart && cue.frameEndExclusive <= a.totalFrames, 'AUDIO_EVENT_INTERVAL_INVALID');
    }
  }
  const rules = context.presetConfig ?? presets;
  const all = targets(rules), allowed = new Map(all.map(t => [t.targetId, t]));
  const composition = context.composition;
  if (v.kind === 'resource_manifest') {
    fail(new Set(v.resources.map(x => x.path)).size === v.resources.length, 'DUPLICATE_RESOURCE_PATH');
    for (const resource of v.resources) {
      fail(safePath(resource.path), 'UNSAFE_RESOURCE_PATH');
      if (context.production || context.licenseRegistry) errors.push(...resourceRightsErrors(resource, context));
    }
    for (const event of v.audioEvents) {
      fail(event.frameEndExclusive > event.frameStart && (!composition || event.frameEndExclusive <= composition.totalFrames), 'AUDIO_EVENT_INTERVAL_INVALID');
      fail(v.resources.some(x => x.sha256 === event.sourceHash && x.licenseRef === event.licenseRef), 'AUDIO_RESOURCE_NOT_COVERED');
    }
    // The renderer/broker supplies its observed inventory. An Agent's own manifest cannot establish completeness.
    if (context.observedResources) for (const actual of context.observedResources) {
      fail(v.resources.some(x => x.path === actual.path && x.sha256 === actual.sha256), 'RESOURCE_NOT_DECLARED');
    }
    if (context.observedAudioEvents) fail(canonical(context.observedAudioEvents) === canonical(v.audioEvents), 'AUDIO_INVENTORY_MISMATCH');
  }
  if (v.kind === 'edit_request') {
    fail(v.comments.reduce((n, comment) => n + [...comment.comment].length, 0) <= 4000, 'COMMENTS_TOO_LONG');
    for (const comment of v.comments) {
      fail(comment.comment.trim().length > 0, 'EMPTY_COMMENT');
      fail(allowed.has(comment.targetId), 'INVALID_COMMENT_TARGET');
      if (composition) fail(comment.frameIndex < composition.totalFrames, 'COMMENT_FRAME_OUT_OF_RANGE');
    }
  }
  if (v.kind === 'checkout_request') {
    const catalog = load('config/agent-policy.json').quota[v.sku];
    fail(catalog?.allowedPurchaseIntents?.includes(v.purchaseIntent), 'PURCHASE_INTENT_NOT_ALLOWED');
    fail(v.purchaseIntent === 'purchase_and_export' ? !!v.snapshotId : !Object.hasOwn(v, 'snapshotId'), 'SNAPSHOT_INTENT_MISMATCH');
    fail(v.sku === 'project_upgrade' ? !!v.upgradeFromOrderId : !Object.hasOwn(v, 'upgradeFromOrderId'), 'UPGRADE_SOURCE_MISMATCH');
  }
  if (v.kind === 'create_project_request' && v.requestTrial && context.role !== undefined) fail(context.role === 'owner', 'TRIAL_OWNER_REQUIRED');
  if (context.production) fail(v.exampleOnly !== true, 'FIXTURE_IN_PRODUCTION');
  if ('totalFrames' in v) fail(v.totalFrames === v.durationSeconds * 30, 'DURATION_FRAME_MISMATCH');
  const ownTargets = new Set((v.variants ?? []).map(x => x.targetId));
  if (v.variants) {
    fail(ownTargets.size === v.variants.length, 'DUPLICATE_TARGET');
    for (const x of v.variants) {
      const t = allowed.get(x.targetId);
      fail(t && t.presetId === x.presetId && t.aspectId === x.aspectId && t.version === x.presetVersion, 'INVALID_TARGET_PAIR');
      fail(safePath(x.entrypoint), 'UNSAFE_ENTRYPOINT');
      fail(x.coverFrame < v.totalFrames, 'COVER_OUT_OF_RANGE');
    }
    if (v.releaseEligible || v.kind === 'release_snapshot') fail(all.every(t => ownTargets.has(t.targetId)), 'VARIANTS_NOT_READY');
    fail(v.presetRulesVersion === rules.rulesVersion, 'PRESET_VERSION_UNAVAILABLE');
    if (v.kind === 'composition') for (const variant of v.variants) {
      if (allowed.has(variant.targetId)) fail(variant.variantHash === digest(variantIdentity(v, variant, rules)), 'VARIANT_HASH_MISMATCH');
    }
  }
  if (v.initialTargetIds) for (const id of v.initialTargetIds) fail(allowed.has(id), 'INVALID_INITIAL_TARGET');
  if (v.targetId) fail(allowed.has(v.targetId), 'INVALID_TARGET');
  if (v.targetIds) for (const id of v.targetIds) fail(allowed.has(id), 'INVALID_TARGET');
  if (composition) {
    if (v.projectId) fail(v.projectId === composition.projectId, 'PROJECT_MISMATCH');
    if (v.revisionId) fail(v.revisionId === composition.revisionId, 'REVISION_MISMATCH');
    if (v.baseRevision) fail(v.baseRevision === composition.revisionId, 'STALE_BASE');
    if (v.frameIndex !== undefined) fail(v.frameIndex < composition.totalFrames, 'FRAME_OUT_OF_RANGE');
    if (v.frameStart !== undefined) fail(v.frameStart < composition.totalFrames, 'FRAME_OUT_OF_RANGE');
    if (v.targetId && !['agent_request','edit_request'].includes(v.kind)) fail(composition.variants.some(x => x.targetId === v.targetId), 'TARGET_SOURCE_UNAVAILABLE');
    if (v.frameEndExclusive !== undefined) fail(v.frameEndExclusive <= composition.totalFrames && v.frameEndExclusive > v.frameStart, 'INTERVAL_OUT_OF_RANGE');
  }
  if (v.command === 'init') {
    const t = allowed.get(v.targetId);
    fail(t && v.width === t.layout.width && v.height === t.layout.height, 'RENDER_SIZE_NOT_FROM_PRESET');
    if (composition) {
      fail(v.frameCount === composition.totalFrames, 'RENDER_FRAME_COUNT_MISMATCH');
      fail(v.manifestHash === digest(composition), 'RENDER_MANIFEST_MISMATCH');
      fail(v.seed === composition.seed, 'RENDER_SEED_MISMATCH');
    }
  }
  if (context.factManifest && 'factManifestHash' in v) {
    fail(v.factManifestHash === digest(context.factManifest), 'FACT_MANIFEST_HASH_MISMATCH');
    if ('factContentHash' in v) fail(v.factContentHash === digest(factContentIdentity(context.factManifest)), 'FACT_CONTENT_HASH_MISMATCH');
  }
  if (v.kind === 'release_snapshot') {
    fail(new Set(v.usagePolicy.licenseVersions.map(x => x.licenseRef)).size === v.usagePolicy.licenseVersions.length, 'DUPLICATE_LICENSE_VERSION');
  }
  if (context.production && v.markingProfileVersion) {
    const profile = own(context.markingProfiles, v.markingProfileVersion);
    fail(!!profile && !!profile.decisionRef && ['machineMarking','audienceDisclosure'].every(field => ['required','not_applicable'].includes(profile[field])), 'MARKING_PROFILE_UNAVAILABLE');
    if (profile) fail(profile.exampleOnly !== true, 'FIXTURE_MARKING_IN_PRODUCTION');
  }
  const delivery = ['composition','release_snapshot','export_manifest','preview_result'].includes(v.kind);
  if (context.production && delivery) {
    const source = v.kind === 'composition' ? v : composition;
    fail(!!source && source.exampleOnly !== true, 'PRODUCTION_COMPOSITION_REQUIRED');
    const frozen = v.kind === 'release_snapshot' ? v : context.snapshot;
    if (v.kind === 'export_manifest') fail(!!frozen && frozen.exampleOnly !== true, 'PRODUCTION_SNAPSHOT_REQUIRED');
    const commercial = ['release_snapshot','export_manifest'].includes(v.kind);
    const usage = commercial ? 'commercial_export' : 'preview';
    let licenseVersions = context.licenseVersions;
    if (commercial && frozen) {
      const policy = own(context.usagePolicies, frozen.usagePolicy?.rightsPolicyVersion);
      fail(!!policy && policy.termsVersion === frozen.usagePolicy?.termsVersion
        && policy.allowedUses?.includes(frozen.usagePolicy?.intendedUse), 'USAGE_POLICY_UNAVAILABLE');
      if (policy) fail(policy.exampleOnly !== true, 'FIXTURE_POLICY_IN_PRODUCTION');
      licenseVersions = Object.fromEntries((frozen.usagePolicy?.licenseVersions ?? []).map(x => [x.licenseRef,x.recordVersion]));
    }
    if (source) {
      const hashes = new Set([source.resourceManifestHash,...source.variants.map(x => x.resourceManifestHash)]);
      const references = new Set();
      for (const resourceHash of hashes) {
        const manifest = own(context.resourceManifests, resourceHash);
        fail(!!manifest, 'RESOURCE_MANIFEST_UNAVAILABLE');
        if (!manifest) continue;
        fail(digest(manifest) === resourceHash, 'RESOURCE_MANIFEST_HASH_MISMATCH');
        for (const variant of source.variants.filter(x => x.resourceManifestHash === resourceHash)) {
          fail(Array.isArray(manifest.audioEvents) && variant.audioHash === digest(manifest.audioEvents), 'AUDIO_MANIFEST_HASH_MISMATCH');
        }
        const observation = own(context.resourceObservations, resourceHash);
        if (v.kind === 'release_snapshot' || source.releaseEligible || v.state === 'ready') {
          fail(Array.isArray(observation?.resources) && Array.isArray(observation?.audioEvents), 'RESOURCE_OBSERVATION_REQUIRED');
        }
        errors.push(...semanticErrors(manifest, {...context,composition:source,projectId:source.projectId,intendedUse:usage,
          licenseVersions,observedResources:observation?.resources,observedAudioEvents:observation?.audioEvents}));
        for (const resource of manifest.resources ?? []) references.add(resource.licenseRef);
      }
      if (commercial && frozen) fail(canonical([...references].sort()) === canonical(Object.keys(licenseVersions).sort()), 'FROZEN_LICENSE_SET_MISMATCH');
      fail(!!context.factManifest && context.factManifest.exampleOnly !== true, 'PRODUCTION_FACT_MANIFEST_REQUIRED');
      if (context.factManifest) {
        fail(source.factManifestHash === digest(context.factManifest), 'FACT_MANIFEST_HASH_MISMATCH');
        fail(source.factContentHash === digest(factContentIdentity(context.factManifest)), 'FACT_CONTENT_HASH_MISMATCH');
        errors.push(...semanticErrors(context.factManifest, {...context,composition:source,projectId:source.projectId}));
      }
    }
  }
  if (v.kind === 'release_snapshot' && composition) {
    fail(composition.releaseEligible === true, 'COMPOSITION_NOT_RELEASE_ELIGIBLE');
    fail(v.totalFrames === composition.totalFrames && v.durationSeconds === composition.durationSeconds && v.fps === composition.fps, 'SNAPSHOT_TIMING_MISMATCH');
    fail(v.presetRulesVersion === composition.presetRulesVersion, 'SNAPSHOT_RULES_MISMATCH');
    fail(v.compositionHash === digest(composition), 'COMPOSITION_HASH_MISMATCH');
    fail(v.contentHash === digest(contentIdentity(composition)), 'CONTENT_HASH_MISMATCH');
    fail(canonical(v.variants) === canonical(composition.variants), 'FROZEN_VARIANT_CHANGED');
    fail(v.factManifestHash === composition.factManifestHash && v.rendererImageDigest === composition.rendererImageDigest, 'SNAPSHOT_PROVENANCE_MISMATCH');
  }
  if (v.kind === 'export_manifest') {
    if (composition) fail(v.compositionHash === digest(composition), 'EXPORT_COMPOSITION_MISMATCH');
    if (context.snapshot) {
      fail(v.snapshotId === context.snapshot.snapshotId && v.snapshotHash === digest(context.snapshot), 'EXPORT_SNAPSHOT_MISMATCH');
      fail(canonical([...v.initialTargetIds].sort()) === canonical([...context.snapshot.initialTargetIds].sort()), 'EXPORT_INITIAL_TARGET_MISMATCH');
      fail(v.projectId === context.snapshot.projectId && v.revisionId === context.snapshot.revisionId, 'EXPORT_SNAPSHOT_IDENTITY_MISMATCH');
      fail(v.markingProfileVersion === context.snapshot.markingProfileVersion, 'EXPORT_MARKING_PROFILE_MISMATCH');
    }
  }
  if (v.kind === 'export_manifest') {
    const ids = v.artifacts.map(a => a.id);
    fail(new Set(ids).size === ids.length, 'DUPLICATE_ARTIFACT');
    for (const a of v.artifacts) {
      fail(allowed.has(a.targetId), 'ARTIFACT_TARGET_INVALID');
      if (composition) {
        const variant = composition.variants.find(x => x.targetId === a.targetId);
        fail(!!variant, 'ARTIFACT_SOURCE_UNAVAILABLE');
        if (variant && allowed.has(a.targetId)) fail(a.artifactFingerprint === digest(outputArtifactIdentity(composition,variant,a.kind,v.markingProfileVersion,rules)), 'ARTIFACT_FINGERPRINT_MISMATCH');
      }
      if (context.snapshot) fail(context.snapshot.variants.some(x => x.targetId === a.targetId), 'ARTIFACT_NOT_FROZEN');
      fail(a.state !== 'ready' || typeof a.sha256 === 'string', 'READY_ARTIFACT_WITHOUT_HASH');
      if (a.state === 'ready' && a.kind !== 'mapping' && (context.production || context.markingEvidence)) {
        errors.push(...markingErrors({...a,projectId:v.projectId,revisionId:v.revisionId,markingProfileVersion:v.markingProfileVersion},context));
      }
    }
    if (v.state === 'ready') for (const id of v.initialTargetIds) {
      for (const kind of ['video','cover','mapping']) fail(v.artifacts.some(a => a.targetId === id && a.kind === kind && a.state === 'ready' && a.sha256), 'INITIAL_BATCH_INCOMPLETE');
    }
  }
  if (v.kind === 'preview_result' && v.state === 'ready') {
    fail(typeof v.screenshotAssetId === 'string' && v.screenshotAssetId.length > 0, 'READY_PREVIEW_WITHOUT_ASSET');
    fail(hash(v.sha256), 'READY_PREVIEW_WITHOUT_HASH');
    if (context.production || context.markingEvidence) errors.push(...markingErrors({...v,id:v.previewId},context));
  }
  if (v.kind === 'fact_manifest') {
    fail(new Set(v.bindings.map(b => b.bindingId)).size === v.bindings.length, 'DUPLICATE_BINDING');
    const facts = new Map(v.facts.map(f => [f.factId, f]));
    fail(facts.size === v.facts.length, 'DUPLICATE_FACT');
    if (context.production || context.evidenceRegistry) for (const fact of v.facts) {
      const claimKind = own(context.claimKinds, fact.factId);
      fail(['general','testimonial','outcome','promotion'].includes(claimKind), 'FACT_CLASSIFICATION_REQUIRED');
      let sourceEvidence = false;
      for (const ref of fact.evidenceRefs) {
        const evidence = own(context.evidenceRegistry, ref);
        fail(!!evidence, 'FACT_EVIDENCE_UNAVAILABLE');
        if (!evidence) continue;
        if (context.production) fail(evidence.exampleOnly !== true, 'FIXTURE_EVIDENCE_IN_PRODUCTION');
        fail(!!context.workspaceId && evidence.workspaceId === context.workspaceId && evidence.projectId === v.projectId, 'FACT_EVIDENCE_SCOPE_MISMATCH');
        fail(hash(evidence.sourceHash) && evidence.factTextHash === digest(fact.text), 'FACT_EVIDENCE_TEXT_MISMATCH');
        fail(['source','customer_declaration'].includes(evidence.kind), 'FACT_EVIDENCE_BASIS_MISSING');
        sourceEvidence ||= evidence.kind === 'source';
      }
      if (claimKind !== 'general') fail(sourceEvidence, 'FACT_SOURCE_EVIDENCE_REQUIRED');
    }
    for (const b of v.bindings) {
      fail(allowed.has(b.targetId), 'FACT_TARGET_INVALID');
      fail(b.frameEndExclusive > b.frameStart && (!composition || b.frameEndExclusive <= composition.totalFrames), 'FACT_INTERVAL_INVALID');
      fail(b.factIds.every(id => facts.has(id)), 'UNKNOWN_FACT');
      // A commercial display string must itself be an explicitly approved fact phrase.
      fail(b.factIds.some(id => facts.get(id)?.text === b.expectedText), 'UNCONFIRMED_DISPLAY_TEXT');
    }
  }
  if (v.kind === 'patch_result') for (const path of v.changedFiles) fail(safePath(path), 'UNSAFE_PATCH_PATH');
  if (v.kind === 'quality_report') {
    if (composition) fail(v.sourceHash === composition.sourceArchiveHash && v.factManifestHash === composition.factManifestHash, 'STALE_QA_PROVENANCE');
    for (const f of v.findings) {
    fail(f.frameEndExclusive > f.frameStart && (!composition || f.frameEndExclusive <= composition.totalFrames), 'QA_INTERVAL_INVALID');
    fail(!(f.level === 'BLOCK' && f.waiver), 'BLOCK_NOT_WAIVABLE');
    if (f.waiver) {
      fail(f.waiver.revisionId === v.revisionId && f.waiver.targetId === v.targetId, 'STALE_WAIVER');
      fail(Number.isFinite(Date.parse(f.waiver.expiresAt)), 'INVALID_WAIVER_EXPIRY');
      if (context.now !== undefined) fail(Date.parse(f.waiver.expiresAt) > context.now, 'EXPIRED_WAIVER');
    }
    }
  }
  return errors;
}
export function safePath(path) {
  return typeof path === 'string' && path.length <= 512 && !path.includes('\\') && !path.includes('%') && !/[:\x00-\x1f]/u.test(path) && !path.startsWith('/') && path.split('/').every(p => p && p !== '.' && p !== '..');
}
const edges = {
  queued: {start: 'active', cancel: 'cancelled', fail: 'failed', expire: 'failed'},
  active: {ask_user: 'awaiting_user', candidate: 'validating', budget_limit: 'paused_budget', cancel: 'cancelled', fail: 'failed', expire: 'failed'},
  awaiting_user: {resume: 'queued', cancel: 'cancelled', expire: 'failed'},
  paused_budget: {resume: 'queued', cancel: 'cancelled', expire: 'failed'},
  validating: {pass: 'succeeded', repair: 'active', budget_limit: 'paused_budget', cancel: 'cancelled', fail: 'failed', expire: 'failed'}
};
export function transition(state, event, guard = {}) {
  const next = edges[state]?.[event];
  if (!next) throw Error('INVALID_TRANSITION');
  if (event === 'resume' && (!guard.authorized || !guard.baseMatches || !guard.withinWindow || !(guard.remainingBudget > 0))) throw Error('RESUME_REJECTED');
  if (event === 'pass' && (!guard.qaPassed || !guard.generationMatches || !guard.authorized)) throw Error('PUBLISH_REJECTED');
  if (event === 'repair' && !(guard.repairs < 2 && guard.remainingBudget > 0)) throw Error('REPAIR_EXHAUSTED');
  return next;
}
// In-memory contract references for race/idempotency tests, NOT D1 implementations.
export class QuotaReference {
  constructor(available) { this.available = available; this.entries = new Map(); }
  reserve(id, requestHash) {
    const old = this.entries.get(id);
    if (old) { if (old.requestHash !== requestHash) throw Error('IDEMPOTENCY_CONFLICT'); return old; }
    if (this.available < 1) throw Error('NO_QUOTA');
    this.available--; const e = {requestHash, state: 'reserved'}; this.entries.set(id, e); return e;
  }
  deliver(id, usable) { const e = this.entries.get(id); if (!e) throw Error('NO_RESERVATION'); if (e.state !== 'reserved') return e; if (!usable) throw Error('NOT_USABLE'); e.state = 'consumed'; return e; }
  cancel(id) { const e = this.entries.get(id); if (e?.state === 'reserved') {e.state = 'released'; this.available++;} return e; }
}
export class RevisionReference {
  constructor(current) { this.current = current; this.accepted = new Map(); }
  apply(requestId, base, candidate, authorized) {
    const sig = base + ':' + candidate;
    if (!authorized) throw Error('FORBIDDEN');
    if (this.accepted.has(requestId)) {if (this.accepted.get(requestId) !== sig) throw Error('IDEMPOTENCY_CONFLICT'); return candidate;}
    if (this.current !== base) throw Error('STALE_BASE');
    this.current = candidate; this.accepted.set(requestId, sig); return candidate;
  }
}
/** Account-scoped trial allocation reference. Authorization/transactions remain live-service work. */
export class TrialReference {
  constructor() { this.claims = new Map(); this.projects = new Map(); this.requests = new Map(); }
  create(request, actor) {
    if (!actor?.authorized || !['owner', 'editor'].includes(actor.role) || !actor.userId) throw Error('FORBIDDEN');
    const errors = semanticErrors(request, {role: actor.role});
    if (request.kind !== 'create_project_request' || errors.length) throw Error(errors.join(',') || 'INVALID_PROJECT_REQUEST');
    const key = canonical([actor.userId, request.workspaceId, request.requestId]), requestHash = digest(request);
    const previous = this.requests.get(key);
    if (previous) { if (previous.requestHash !== requestHash) throw Error('IDEMPOTENCY_CONFLICT'); return structuredClone(previous.result); }
    const projectId = 'project_ref_' + (this.projects.size + 1);
    let trialStatus = 'not_requested';
    if (request.requestTrial) {
      trialStatus = this.claims.has(actor.userId) ? 'unavailable' : 'granted';
      if (trialStatus === 'granted') this.claims.set(actor.userId, projectId);
    }
    const free = load('config/agent-policy.json').quota.free;
    this.projects.set(projectId, {workspaceId: request.workspaceId, trialOwnerUserId: trialStatus === 'granted' ? actor.userId : null,
      deleted: false, creative_generate: trialStatus === 'granted' ? free.creative_generate : 0,
      agent_patch: trialStatus === 'granted' ? free.agent_patch : 0});
    const result = {schemaVersion:'2.4.0',kind:'create_project_result',requestId:request.requestId,projectId,workspaceId:request.workspaceId,trialStatus};
    this.requests.set(key, {requestHash, result});
    return structuredClone(result);
  }
  deleteProject(projectId) { const project = this.projects.get(projectId); if (project) project.deleted = true; }
  hasTrialCloudAccess(projectId) { const project = this.projects.get(projectId); return !!project && !project.deleted && !!project.trialOwnerUserId; }
}

/** All attempts/targets/children of one operation share this single integer-micros budget. */
export class OperationBudgetReference {
  constructor(operationId, limitMicros) {
    if (!Number.isSafeInteger(limitMicros) || limitMicros <= 0) throw Error('UNCALIBRATED_BUDGET');
    this.operationId = operationId; this.limitMicros = limitMicros; this.spentMicros = 0; this.calls = new Map(); this.events = [];
  }
  get reservedMicros() { return [...this.calls.values()].filter(x => x.state !== 'settled').reduce((n, x) => n + x.maximumCostMicros, 0); }
  get remainingMicros() { return Math.max(0, this.limitMicros - this.spentMicros - this.reservedMicros); }
  reserve({operationId, callId, attemptId, targetId, maximumCostMicros, requestHash}) {
    if (operationId !== this.operationId) throw Error('OPERATION_BUDGET_MISMATCH');
    if (!Number.isSafeInteger(maximumCostMicros) || maximumCostMicros <= 0) throw Error('INVALID_COST_RESERVATION');
    const signature = canonical({operationId, attemptId, targetId, maximumCostMicros, requestHash});
    const old = this.calls.get(callId);
    if (old) { if (old.signature !== signature) throw Error('IDEMPOTENCY_CONFLICT'); return structuredClone(old); }
    if ([...this.calls.values()].some(call => call.exceededReservation)) throw Error('USAGE_OVERRUN');
    if (maximumCostMicros > this.remainingMicros) throw Error('BUDGET_EXHAUSTED');
    const call = {signature, maximumCostMicros, state:'reserved', actualCostMicros:null};
    this.calls.set(callId, call); this.events.push(Object.freeze({type:'reserve',callId,maximumCostMicros})); return structuredClone(call);
  }
  settle(callId, actualCostMicros) {
    const call = this.calls.get(callId);
    if (!call) throw Error('NO_COST_RESERVATION');
    if (call.state === 'settled') {
      if (actualCostMicros !== call.actualCostMicros) throw Error('USAGE_RECONCILIATION_CONFLICT');
      return structuredClone(call);
    }
    if (actualCostMicros === null) {
      if (call.state !== 'unknown') this.events.push(Object.freeze({type:'unknown',callId}));
      call.state = 'unknown'; return structuredClone(call);
    }
    if (!Number.isSafeInteger(actualCostMicros) || actualCostMicros < 0) throw Error('INVALID_ACTUAL_USAGE');
    call.state = 'settled'; call.actualCostMicros = actualCostMicros; this.spentMicros += actualCostMicros;
    this.events.push(Object.freeze({type:'settle',callId,actualCostMicros}));
    call.exceededReservation = actualCostMicros > call.maximumCostMicros;
    return structuredClone(call);
  }
}

/** Verified-payment/entitlement reference, not a Waffo webhook, database or checkout implementation. */
export class CheckoutReference {
  constructor(projectId, frozenSnapshots = []) {
    this.projectId = projectId; this.snapshots = new Map(frozenSnapshots.map(x => [x.snapshotId, structuredClone(x)]));
    this.orders = new Map(); this.requests = new Map(); this.slots = new Map(); this.grants = new Map();
    this.exportIntents = new Map(); this.releases = new Map();
  }
  get catalog() {
    return Object.fromEntries(Object.entries(load('config/agent-policy.json').quota).filter(([, value]) => value && typeof value === 'object' && Number.isSafeInteger(value.priceMinor)));
  }
  effective(grant, seen = new Set()) {
    if (!grant?.active || seen.has(grant.orderId)) return false;
    seen.add(grant.orderId);
    return !grant.dependsOnOrderId || this.effective(this.grants.get(grant.dependsOnOrderId), seen);
  }
  hasCreativePurchase() { return [...this.grants.values()].some(g => this.effective(g) && ['project_pack', 'project_upgrade'].includes(g.sku)); }
  assertEligibility(request, orderId) {
    const item = this.catalog[request.sku];
    if (!item) throw Error('UNKNOWN_SKU');
    if (item.isInitialPurchase && [...this.grants.values()].some(g => this.effective(g) && this.catalog[g.sku].isInitialPurchase && g.orderId !== orderId)) throw Error('INITIAL_PURCHASE_EXISTS');
    if (request.sku === 'project_upgrade') {
      const source = this.grants.get(request.upgradeFromOrderId);
      if (!this.effective(source) || source.sku !== 'single_export') throw Error('VALID_SINGLE_EXPORT_REQUIRED');
      if ([...this.grants.values()].some(g => this.effective(g) && g.upgradeFromOrderId === request.upgradeFromOrderId && g.orderId !== orderId)) throw Error('ALREADY_UPGRADED');
    }
    if (request.sku === 'extra_pack' && !this.hasCreativePurchase()) throw Error('CREATIVE_PROJECT_REQUIRED');
    if (request.sku === 'extra_pack' && request.dependsOnOrderId && !this.effective(this.grants.get(request.dependsOnOrderId))) throw Error('CREATIVE_PROJECT_REQUIRED');
  }
  open(request, {ownerAuthorized, recoverable = true} = {}) {
    if (!ownerAuthorized) throw Error('FORBIDDEN');
    const errors = semanticErrors(request);
    if (request.kind !== 'checkout_request' || errors.length) throw Error(errors.join(',') || 'INVALID_CHECKOUT');
    if (request.projectId !== this.projectId || !recoverable) throw Error('PROJECT_UNAVAILABLE');
    const signature = digest(request), previous = this.requests.get(request.requestId);
    if (previous) {
      if (previous.signature !== signature) throw Error('IDEMPOTENCY_CONFLICT');
      return structuredClone(this.orders.get(previous.orderId));
    }
    if (request.purchaseIntent === 'purchase_and_export') {
      const snapshot = this.snapshots.get(request.snapshotId);
      if (!snapshot || snapshot.projectId !== this.projectId || semanticErrors(snapshot).length) throw Error('VARIANTS_NOT_READY');
      const delivered = this.releases.get(snapshot.contentHash);
      if (delivered && !this.effective(this.grants.get(delivered.orderId))) throw Error('RELEASE_RESTORATION_REVIEW_REQUIRED');
    }
    this.assertEligibility(request);
    const item = this.catalog[request.sku];
    const slotKey = item.isInitialPurchase ? 'initial_purchase' : request.sku === 'project_upgrade' ? 'upgrade:' + request.upgradeFromOrderId : 'extra_pack';
    if (this.slots.has(slotKey)) throw Error('CHECKOUT_IN_PROGRESS');
    const orderId = 'order_ref_' + (this.orders.size + 1);
    const creativeSource = request.sku === 'extra_pack' ? [...this.grants.values()].find(g => this.effective(g) && ['project_pack','project_upgrade'].includes(g.sku)) : null;
    const order = {orderId, ...structuredClone(request), priceMinor:item.priceMinor, entitlementSnapshot:structuredClone(item),
      dependsOnOrderId:request.upgradeFromOrderId ?? creativeSource?.orderId ?? null,
      slotKey, paymentVerified:false, refundVerified:false, state:'checkout_open'};
    this.orders.set(orderId, order); this.slots.set(slotKey, orderId); this.requests.set(request.requestId, {signature, orderId});
    return structuredClone(order);
  }
  grantVerifiedPayment(orderId) {
    const order = this.orders.get(orderId);
    if (!order) throw Error('UNKNOWN_ORDER');
    order.paymentVerified = true;
    if (this.grants.has(orderId)) return structuredClone(this.grants.get(orderId));
    if (order.refundVerified) { order.state = 'paid'; return null; }
    if (this.slots.get(order.slotKey) !== orderId) { order.state = 'review_required'; order.reviewReason = 'CHECKOUT_SLOT_CHANGED'; return null; }
    try { this.assertEligibility(order, orderId); }
    catch (error) { order.state = 'review_required'; order.reviewReason = error.message; return null; }
    const item = order.entitlementSnapshot;
    const grant = {orderId, sku:order.sku, active:true, versionUnits:item.versionUnits,
      creative_generate:item.creative_generate, agent_patch:item.agent_patch,
      upgradeFromOrderId:order.upgradeFromOrderId ?? null,
      dependsOnOrderId:order.dependsOnOrderId,
      boundContentHash:order.sku === 'single_export' ? this.snapshots.get(order.snapshotId).contentHash : null};
    this.grants.set(orderId, grant); order.state = 'paid';
    if (order.purchaseIntent === 'purchase_and_export') this.exportIntents.set(orderId, {snapshotId:order.snapshotId, contentHash:this.snapshots.get(order.snapshotId).contentHash});
    if (order.sku === 'extra_pack') this.slots.delete(order.slotKey);
    return structuredClone(grant);
  }
  descendantsClosed(orderId, seen = new Set()) {
    if (seen.has(orderId)) return false;
    seen.add(orderId);
    return [...this.orders.values()].filter(order => order.dependsOnOrderId === orderId).every(order =>
      (order.refundVerified || order.state === 'canceled') && this.descendantsClosed(order.orderId, new Set(seen)));
  }
  releaseClosedSlots() {
    for (const [slotKey,orderId] of this.slots) {
      const order = this.orders.get(orderId);
      if ((order?.refundVerified || order?.state === 'canceled') && this.descendantsClosed(orderId)) this.slots.delete(slotKey);
    }
  }
  revokeGrant(orderId) {
    const order = this.orders.get(orderId); if (!order) throw Error('UNKNOWN_ORDER');
    const grant = this.grants.get(orderId); if (grant) grant.active = false;
    order.refundVerified = true; this.releaseClosedSlots();
  }
  closeUnpaid(orderId, providerConfirmedUnpaid) {
    const order = this.orders.get(orderId);
    if (!order || !providerConfirmedUnpaid || order.paymentVerified) throw Error('PAYMENT_STATUS_UNRESOLVED');
    order.state = 'canceled'; this.releaseClosedSlots();
  }
  available(kind) {
    const granted = [...this.grants.values()].filter(g => this.effective(g)).reduce((n,g) => n + g[kind], 0);
    const consumed = kind === 'versionUnits' ? [...this.releases.values()].filter(r => this.effective(this.grants.get(r.orderId))).length : 0;
    return granted - consumed;
  }
  publish(releaseId, contentHash) {
    if (this.releases.has(contentHash)) {
      const existing = this.releases.get(contentHash);
      if (!this.effective(this.grants.get(existing.orderId))) throw Error('RELEASE_RESTORATION_REVIEW_REQUIRED');
      return structuredClone(existing);
    }
    const grant = [...this.grants.values()].find(g => this.effective(g)
      && (!g.boundContentHash || g.boundContentHash === contentHash)
      && [...this.releases.values()].filter(r => r.orderId === g.orderId).length < g.versionUnits);
    if (!grant) throw Error('NO_VERSION_RIGHT');
    const release = {releaseId, contentHash, orderId:grant.orderId}; this.releases.set(contentHash, release); return structuredClone(release);
  }
}
export function matchesFrameReady(command, response, manifestHash, disposed = false) {
  return !disposed && validateSchema(command, schema.$defs.renderSeek).length === 0 && validateSchema(response, schema.$defs.renderReady).length === 0 && response.event === 'frame-ready' && response.manifestHash === manifestHash && ['protocolVersion', 'sessionId', 'requestId', 'sequence', 'revisionId', 'targetId', 'frameIndex'].every(k => response[k] === command[k]);
}

/** Ignore stale failures just as strictly as stale frame-ready events. */
export function matchesProtocolFailure(command, response, disposed = false) {
  if (disposed || validateSchema(command).length || validateSchema(response).length || response.event !== 'error') return false;
  return ['protocolVersion','sessionId','requestId','sequence','revisionId','targetId'].every(k => command[k] === response[k]);
}
