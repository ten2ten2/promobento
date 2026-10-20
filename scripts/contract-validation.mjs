// Specification/fixture checker, not a production authorization or browser sandbox.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const ROOT = new URL('../', import.meta.url);
export const load = path => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
export const schema = load('contracts/production.schema.json');
export const presets = load('config/platform-presets.json');
export const canonical = value => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error('NON_FINITE'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  throw Error('NOT_JSON');
};
export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const supported = new Set(['$schema', '$id', '$defs', '$ref', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties', 'items', 'minItems', 'uniqueItems', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'anyOf', 'oneOf']);
// Fail closed on unsupported schema vocabulary. CI/app must also validate with a full Draft 2020-12 implementation.
export function validateSchema(value, rule = schema, at = '$', depth = 0) {
  if (depth > 64) throw Error('MAX_DEPTH');
  for (const key of Object.keys(rule)) if (!supported.has(key)) throw Error('UNSUPPORTED_SCHEMA_KEYWORD:' + key);
  if (rule.$ref) {
    if (!rule.$ref.startsWith('#/$defs/')) throw Error('REMOTE_SCHEMA_REF');
    const target = schema.$defs[rule.$ref.slice(8)];
    if (!target) throw Error('UNKNOWN_SCHEMA_REF');
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
    if (rule.uniqueItems && new Set(value.map(canonical)).size !== value.length) add('uniqueItems');
    if (rule.items) value.forEach((x, i) => errors.push(...validateSchema(x, rule.items, at + '[' + i + ']', depth + 1)));
  } else if (value && typeof value === 'object') {
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) add('missing ' + key);
    for (const [key, x] of Object.entries(value)) {
      if (rule.properties?.[key]) errors.push(...validateSchema(x, rule.properties[key], at + '.' + key, depth + 1));
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
    facts: rest.facts.map(({confirmedBy, confirmedAt, ...fact}) => fact),
    bindings: rest.bindings.map(({coverage, ...binding}) => binding)};
}
export function contentIdentity(c) {
  const {projectId, revisionId, exampleOnly, releaseEligible, factManifestHash, styleLabel, ...rest} = c;
  return {...rest, variants: rest.variants.map(({qaReportHash, ...v}) => v).sort((a, b) => a.targetId.localeCompare(b.targetId, 'en'))};
}
export function variantIdentity(c, v, rules = presets) {
  const target = targets(rules).find(t => t.targetId === v.targetId);
  if (!target) throw Error('INVALID_TARGET_PAIR');
  return {sourceHash:v.sourceHash, dependencyManifestHash:c.dependencyManifestHash,
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
export function outputArtifactIdentity(c, v, kind, rules = presets) {
  const render = artifactIdentity(c, v, rules);
  if (kind === 'video') return {kind, render};
  if (kind === 'cover') return {kind, render, coverFrame:v.coverFrame, encoding:'jpg_v1'};
  if (kind === 'mapping') return {kind, targetId:v.targetId, presetRulesVersion:c.presetRulesVersion,
    videoFingerprint:digest(outputArtifactIdentity(c,v,'video',rules)),
    coverFingerprint:digest(outputArtifactIdentity(c,v,'cover',rules)), encoding:'mapping_v1'};
  throw Error('INVALID_ARTIFACT_KIND');
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
        if (variant && allowed.has(a.targetId)) fail(a.artifactFingerprint === digest(outputArtifactIdentity(composition,variant,a.kind,rules)), 'ARTIFACT_FINGERPRINT_MISMATCH');
      }
      if (context.snapshot) fail(context.snapshot.variants.some(x => x.targetId === a.targetId), 'ARTIFACT_NOT_FROZEN');
      fail(a.state !== 'ready' || typeof a.sha256 === 'string', 'READY_ARTIFACT_WITHOUT_HASH');
    }
    if (v.state === 'ready') for (const id of v.initialTargetIds) {
      for (const kind of ['video','cover','mapping']) fail(v.artifacts.some(a => a.targetId === id && a.kind === kind && a.state === 'ready' && a.sha256), 'INITIAL_BATCH_INCOMPLETE');
    }
  }
  if (v.kind === 'fact_manifest') {
    fail(new Set(v.bindings.map(b => b.bindingId)).size === v.bindings.length, 'DUPLICATE_BINDING');
    const facts = new Map(v.facts.map(f => [f.factId, f]));
    fail(facts.size === v.facts.length, 'DUPLICATE_FACT');
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
export function matchesFrameReady(command, response, manifestHash, disposed = false) {
  return !disposed && validateSchema(command, schema.$defs.renderSeek).length === 0 && validateSchema(response, schema.$defs.renderReady).length === 0 && response.event === 'frame-ready' && response.manifestHash === manifestHash && ['protocolVersion', 'sessionId', 'requestId', 'sequence', 'revisionId', 'targetId', 'frameIndex'].every(k => response[k] === command[k]);
}

/** Ignore stale failures just as strictly as stale frame-ready events. */
export function matchesProtocolFailure(command, response, disposed = false) {
  if (disposed || validateSchema(command).length || validateSchema(response).length || response.event !== 'error') return false;
  return ['protocolVersion','sessionId','requestId','sequence','revisionId','targetId'].every(k => command[k] === response[k]);
}
