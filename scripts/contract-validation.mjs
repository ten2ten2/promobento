// Specification/fixture checker, not a production authorization or browser sandbox.
import { readFileSync } from 'node:fs';
import { studioErrors } from './studio-contracts.mjs';
import { trustedPreviewErrors } from './preview-policy.mjs';
import {
  canonical, digest, parseCanonicalJson, createSchemaValidator,
  targets as contractTargets, factVersionKey, factContentIdentity, resourceContentIdentity, contentIdentity, audioIdentity,
  variantIdentity as contractVariantIdentity, artifactIdentity as contractArtifactIdentity,
  outputArtifactIdentity as contractOutputArtifactIdentity, qaInputIdentity as contractQaInputIdentity,
  sourceBuildErrors, revisionEnvironmentErrors
} from '../packages/contracts/index.mjs';
export {canonical, digest, parseCanonicalJson, factVersionKey, factContentIdentity, resourceContentIdentity, contentIdentity, audioIdentity};
const ROOT = new URL('../', import.meta.url);
export const load = path => parseCanonicalJson(readFileSync(new URL(path, ROOT)));
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
export const validateSchema = createSchemaValidator(schema);
export const targets = (rules = presets) => contractTargets(rules);
export const variantIdentity = (c, v, rules = presets) => contractVariantIdentity(c, v, rules);
export const artifactIdentity = (c, v, rules = presets) => contractArtifactIdentity(c, v, rules);
export const outputArtifactIdentity = (c, v, kind, markingProfileVersion, rules = presets) => contractOutputArtifactIdentity(c, v, kind, markingProfileVersion, rules);
export const qaInputIdentity = (c, v, qaProfileVersion, rules = presets) => contractQaInputIdentity(c, v, qaProfileVersion, rules);
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);

/** Reports are reusable checks; associations and waivers remain scoped authorization records. */
export function qualityAssociationErrors(association, composition, context = {}) {
  const errors = validateSchema(association, schema.$defs.qualityAssociation);
  if (errors.length) return errors;
  const fail = (ok, code) => { if (!ok) errors.push(code); };
  const variant = composition?.variants.find(v => v.targetId === association.targetId);
  const rules = context.presetConfig ?? presets;
  const validTarget = targets(rules).some(target => target.targetId === association.targetId);
  if (context.production) fail(association.exampleOnly !== true, 'FIXTURE_QA_IN_PRODUCTION');
  fail(!!composition && association.projectId === composition.projectId && association.revisionId === composition.revisionId, 'QA_ASSOCIATION_SCOPE_MISMATCH');
  if (context.projectId) fail(association.projectId === context.projectId, 'QA_ASSOCIATION_SCOPE_MISMATCH');
  if (context.workspaceId || context.production) fail(association.workspaceId === context.workspaceId, 'QA_ASSOCIATION_SCOPE_MISMATCH');
  fail(!!variant && validTarget, 'QA_ASSOCIATION_TARGET_MISMATCH');
  if (context.qaProfileVersion) fail(association.qaProfileVersion === context.qaProfileVersion, 'STALE_QA_PROFILE');
  if (variant && validTarget) fail(association.qaInputHash === digest(qaInputIdentity(composition, variant, association.qaProfileVersion, rules)), 'STALE_QA_INPUT');
  if (!(context.production || context.qualityReports)) return errors;
  const report = own(context.qualityReports, association.reportHash);
  fail(!!report, 'QA_REPORT_UNAVAILABLE');
  if (!report) return errors;
  fail(digest(report) === association.reportHash, 'QA_REPORT_BINDING_MISMATCH');
  fail(['workspaceId','projectId','targetId','qaInputHash','qaProfileVersion'].every(key => report[key] === association[key]), 'QA_REPORT_BINDING_MISMATCH');
  const reportErrors = semanticErrors(report, {...context, composition, qaProfileVersion:association.qaProfileVersion});
  errors.push(...reportErrors);
  if (reportErrors.length) return errors;
  const waived = new Set();
  for (const waiverHash of association.waiverHashes) {
    const waiver = own(context.qualityWaivers, waiverHash);
    fail(!!waiver, 'QA_WAIVER_UNAVAILABLE');
    if (!waiver) continue;
    fail(digest(waiver) === waiverHash, 'QA_WAIVER_HASH_MISMATCH');
    fail(['workspaceId','projectId','revisionId','targetId','qaInputHash','qaProfileVersion','reportHash'].every(key => waiver[key] === association[key]), 'STALE_WAIVER');
    const waiverErrors = semanticErrors(waiver, {...context, composition, qualityReport:report, reportHash:association.reportHash});
    errors.push(...waiverErrors);
    fail(!waived.has(waiver.findingId), 'DUPLICATE_FINDING_WAIVER');
    if (!waiverErrors.length) waived.add(waiver.findingId);
  }
  fail(report.findings.every(finding => finding.level === 'INFO' || (finding.level === 'REVIEW' && waived.has(finding.findingId))), 'QA_NOT_PASSED');
  return errors;
}
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
    fail(typeof output.assetId === 'string' && evidence.assetId === output.assetId, 'MARKING_ASSET_MISMATCH');
    fail(evidence.targetId === output.targetId && evidence.frameStart === output.frameStart
      && evidence.frameEndExclusive === output.frameEndExclusive, 'MARKING_PREVIEW_IDENTITY_MISMATCH');
  }
  for (const field of ['machineMarking','audienceDisclosure']) fail(evidence[field] === (profile[field] === 'required' ? 'verified' : 'not_applicable'), 'MARKING_CHECK_INCOMPLETE');
  return errors;
}

function audioEventErrors(event, totalFrames) {
  const errors = [], length = event.frameEndExclusive - event.frameStart;
  if (!(length > 0) || (totalFrames !== undefined && event.frameEndExclusive > totalFrames)) errors.push('AUDIO_EVENT_INTERVAL_INVALID');
  if ((event.fadeInFrames ?? 0) + (event.fadeOutFrames ?? 0) > length) errors.push('AUDIO_FADE_OVERLAP');
  if (event.gainAutomation) {
    const keys = event.gainAutomation;
    if (keys[0].frameOffset !== 0 || keys.at(-1).frameOffset !== length || keys.some((key, i) => key.frameOffset > length || (i > 0 && key.frameOffset <= keys[i-1].frameOffset))) errors.push('AUDIO_AUTOMATION_INVALID');
  }
  return errors;
}

/** Trusted observations establish which mix the renderer actually consumed. */
function outputQualityErrors(output, context) {
  const errors = [], fail = (ok, code) => { if (!ok) errors.push(code); };
  const evidence = own(context.qualityEvidence, output.qualityEvidenceRef);
  fail(!!evidence, 'OUTPUT_QA_REQUIRED');
  if (!evidence) return errors;
  errors.push(...validateSchema(evidence, schema.$defs.outputQualityEvidence));
  if (errors.length) return errors;
  if (context.production) fail(evidence.exampleOnly !== true, 'FIXTURE_QA_IN_PRODUCTION');
  const profile = own(context.qaProfiles, output.qaProfileVersion);
  fail(!!profile && evidence.checkerVersion === profile.checkerVersion, 'QA_PROFILE_UNAVAILABLE');
  if (context.production && profile) fail(profile.exampleOnly !== true, 'FIXTURE_QA_IN_PRODUCTION');
  fail(evidence.qaProfileVersion === output.qaProfileVersion, 'STALE_QA_PROFILE');
  fail(evidence.outputId === output.id && evidence.sha256 === output.sha256 && evidence.artifactFingerprint === output.artifactFingerprint, 'OUTPUT_QA_BYTES_MISMATCH');
  fail(evidence.workspaceId === context.workspaceId && evidence.projectId === output.projectId && evidence.revisionId === output.revisionId && evidence.targetId === output.targetId, 'OUTPUT_QA_SCOPE_MISMATCH');
  if (output.kind === 'video') {
    const variant = context.composition?.variants.find(x => x.targetId === output.targetId);
    const resources = own(context.resourceManifests, variant?.resourceManifestHash);
    fail(!!resources && evidence.mixedAudioSha256 === (resources.mixedAudio?.sha256 ?? null), 'OUTPUT_QA_AUDIO_MISMATCH');
  } else fail(evidence.mixedAudioSha256 === null, 'COVER_QA_HAS_AUDIO');
  return errors;
}

/** Exact sample time; this calculates timing and does not render a frame. */
export function sampleTime(frameIndex, sampleIndex, profile, totalFrames) {
  if (![450,900].includes(totalFrames) || validateSchema(profile, schema.$defs.renderProfile).length || !Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames || !Number.isSafeInteger(sampleIndex) || sampleIndex < 0 || sampleIndex >= profile.sampleCount) throw Error('INVALID_SAMPLE');
  if (profile.sampleCount === 1 ? profile.shutterAngle !== 0 : profile.shutterAngle === 0) throw Error('INVALID_SHUTTER');
  const unit = 720 * profile.sampleCount;
  let numerator = frameIndex * unit + (2 * sampleIndex + 1 - profile.sampleCount) * profile.shutterAngle;
  let denominator = 30 * unit;
  numerator = Math.max(0, Math.min(numerator, (totalFrames - 1) * unit));
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  const factor = gcd(numerator, denominator);
  return {numerator: numerator / factor, denominator: denominator / factor};
}

/** Reference guards for API inputs. All context records represent trusted server reads. */
function apiInputErrors(v, context) {
  const errors = [], fail = (ok, code) => { if (!ok) errors.push(code); };
  const scoped = record => !!record && !!context.workspaceId && record.workspaceId === context.workspaceId
    && (!context.projectId || record.projectId === context.projectId) && (!v.projectId || record.projectId === v.projectId);
  const requestKinds = ['asset_intent_request','upload_complete_request','facts_update_request','facts_confirm_request','transcript_confirm_request','showcase_consent_request','support_ticket_request'];
  if (requestKinds.includes(v.kind) && (context.production || context.authorized !== undefined)) {
    fail(context.authorized === true, 'API_ACCESS_REQUIRED');
    if (v.projectId && context.projectId) fail(v.projectId === context.projectId, 'PROJECT_MISMATCH');
    if (context.production && (v.kind !== 'support_ticket_request' || v.projectId)) {
      fail(!!context.workspaceId && !!context.projectId, 'API_PROJECT_SCOPE_REQUIRED');
      fail(['owner','editor'].includes(context.role), 'API_MEMBER_REQUIRED');
    }
  }
  if (v.kind === 'asset_intent_request') {
    const {mediaType,byteLength} = v.source, audio = mediaType.startsWith('audio/'), video = mediaType.startsWith('video/');
    const image = mediaType.startsWith('image/'), document = mediaType === 'application/pdf';
    fail(v.purpose === 'evidence' || (v.purpose === 'visual' && (image || video))
      || (v.purpose === 'logo' && ['image/png','image/webp'].includes(mediaType))
      || (['voiceover','music'].includes(v.purpose) && audio), 'UPLOAD_PURPOSE_MISMATCH');
    const capabilities = load('config/input-capabilities.json').entries;
    const limit = capabilities.find(x => x.id === (document ? 'evidence_documents' : v.purpose === 'logo' ? 'logo' : audio ? 'user_audio' : video ? 'recordings' : 'images'))?.maxBytes;
    fail(Number.isSafeInteger(limit) && byteLength <= limit, 'UPLOAD_TOO_LARGE');
    fail(v.purpose === 'evidence' || v.rightsDeclaration.previewAuthorized, 'PREVIEW_RIGHTS_REQUIRED');
    if (context.production || context.rightsNoticeVersion) fail(v.rightsDeclaration.noticeVersion === context.rightsNoticeVersion, 'RIGHTS_NOTICE_MISMATCH');
  }
  if (['upload_complete_request','upload_complete_result'].includes(v.kind) && (context.production || context.uploadIntents)) {
    const intent = own(context.uploadIntents,v.uploadId), actual = own(context.uploadObservations,v.uploadId);
    fail(scoped(intent), 'UPLOAD_SCOPE_MISMATCH');
    fail(!!intent && !!actual && actual.sourceHash === intent.sourceHash && actual.byteLength === intent.byteLength
      && actual.mediaType === intent.contentType, 'UPLOAD_BYTES_MISMATCH');
    if (v.kind === 'upload_complete_request') fail(Number.isFinite(context.now) && Date.parse(intent?.expiresAt) > context.now, 'UPLOAD_EXPIRED');
    if (intent && v.kind === 'upload_complete_result') fail(['projectId','assetId','purpose','sourceHash','byteLength','rightsDeclarationId'].every(key => v[key] === intent[key]), 'UPLOAD_RESULT_MISMATCH');
  }
  const checkFact = (ref, confirmed = false) => {
    const fact = own(context.facts,ref.factId);
    fail(!!fact && fact.version === ref.version && fact.textHash === ref.textHash && fact.textHash === digest(fact.text), 'STALE_FACT');
    if (Object.hasOwn(ref,'expectedRecordVersion')) fail(fact?.recordVersion === ref.expectedRecordVersion, 'STALE_FACT_RECORD');
    if (confirmed) fail(!!fact?.confirmation, 'FACT_CONFIRMATION_REQUIRED');
  };
  if (v.kind === 'facts_update_request') {
    fail(new Set(v.changes.map(x => x.factId)).size === v.changes.length, 'DUPLICATE_FACT_CHANGE');
    for (const change of v.changes) {
      if (change.action === 'upsert') fail(change.text.trim().length > 0, 'EMPTY_FACT');
      if (context.production || context.facts) fail((own(context.facts,change.factId)?.recordVersion ?? 0) === change.expectedVersion, 'STALE_FACT_RECORD');
      if (context.production || context.assets) for (const ref of change.evidence ?? []) {
        const asset = own(context.assets,ref.assetId);
        fail(scoped(asset) && asset.sourceHash === ref.sourceHash && asset.purpose === 'evidence' && asset.state === 'ready', 'FACT_EVIDENCE_ASSET_MISMATCH');
      }
    }
  }
  if (v.kind === 'facts_confirm_request') {
    fail(new Set(v.facts.map(x => x.factId)).size === v.facts.length, 'DUPLICATE_FACT_CONFIRMATION');
    if (context.production || context.facts) for (const fact of v.facts) checkFact(fact);
  }
  if (v.kind === 'facts_result') {
    fail(new Set(v.facts.map(x => x.factId)).size === v.facts.length, 'DUPLICATE_FACT');
    for (const fact of v.facts) fail(fact.textHash === digest(fact.text), 'FACT_TEXT_HASH_MISMATCH');
  }
  if (['transcript_confirm_request','transcript_result'].includes(v.kind)) {
    fail(v.segments.reduce((n,segment) => n + [...segment.text].length,0) <= 6000, 'TRANSCRIPT_TOO_LONG');
    for (let i=0;i<v.segments.length;i++) {
      const segment=v.segments[i];
      fail(segment.startMs < segment.endMs && (i === 0 || segment.startMs >= v.segments[i-1].endMs), 'TRANSCRIPT_INTERVAL_INVALID');
      fail(segment.text.trim().length > 0, 'EMPTY_TRANSCRIPT');
      if (context.production || context.facts) for (const fact of segment.facts) checkFact(fact,true);
    }
    if (context.production || context.assets) {
      const asset=own(context.assets,v.assetId);
      fail(scoped(asset) && asset.sourceHash === v.sourceHash && /^(audio|video)\//.test(asset.mediaType), 'TRANSCRIPT_SOURCE_MISMATCH');
      fail(Number.isFinite(asset?.durationMs) && v.segments.at(-1).endMs <= asset.durationMs, 'TRANSCRIPT_SOURCE_RANGE_INVALID');
    }
    if (v.kind === 'transcript_confirm_request' && (context.production || context.transcripts)) fail(v.expectedVersion === (own(context.transcripts,v.assetId)?.version ?? 0), 'STALE_TRANSCRIPT');
    if (v.kind === 'transcript_result') fail(v.transcriptHash === digest({assetId:v.assetId,sourceHash:v.sourceHash,segments:v.segments}), 'TRANSCRIPT_HASH_MISMATCH');
  }
  if (v.kind === 'showcase_consent_request' && (context.production || context.releases)) {
    const release=own(context.releases,v.releaseId);
    fail(context.role === 'owner' && scoped(release) && (v.action === 'revoke' || release.state === 'ready'), 'SHOWCASE_RELEASE_ACCESS_REQUIRED');
    fail(v.expectedVersion === (own(context.showcaseConsents,v.releaseId)?.version ?? 0), 'STALE_SHOWCASE_CONSENT');
    if (v.action === 'grant') fail(v.noticeVersion === context.showcaseNoticeVersion, 'SHOWCASE_NOTICE_MISMATCH');
  }
  if (v.kind === 'support_ticket_request' && (context.production || context.orders)) {
    if (v.category === 'refund') fail(context.role === 'owner', 'REFUND_OWNER_REQUIRED');
    if (v.orderId) fail(scoped(own(context.orders,v.orderId)), 'ORDER_ACCESS_REQUIRED');
  }
  if (v.kind === 'checkout_result' && v.sessionState === 'ready' && (context.production || context.checkoutOrigins)) {
    let url;
    try { url=new URL(v.checkoutUrl); } catch { /* A URI is not necessarily a usable checkout URL. */ }
    fail(url && context.checkoutOrigins?.includes(url.origin) && !url.username && !url.password, 'CHECKOUT_ORIGIN_NOT_ALLOWED');
    fail(Number.isFinite(context.now) && Date.parse(v.expiresAt) > context.now, 'CHECKOUT_SESSION_EXPIRED');
  }
  return errors;
}

export function semanticErrors(v, context = {}) {
  const errors = validateSchema(v);
  if (errors.length) return errors;
  errors.push(...studioErrors(v,context,{schema,validateSchema,digest,presets:context.presetConfig ?? presets}));
  errors.push(...apiInputErrors(v,context));
  const fail = (ok, message) => { if (!ok) errors.push(message); };
  if (v.kind === 'run_result') {
    const t = v.treatment, a = v.audioPlan, outer = context.composition?.totalFrames;
    fail(v.usage.cachedInputTokens <= v.usage.inputTokens, 'CACHED_TOKENS_EXCEED_INPUT');
    if (t) {
      if (outer) fail(t.totalFrames === outer, 'TREATMENT_DURATION_MISMATCH');
      for (const beat of t.beats) fail(beat.frameEndExclusive > beat.frameStart && beat.frameEndExclusive <= t.totalFrames, 'TREATMENT_INTERVAL_INVALID');
    }
    if (a) {
      if (outer) fail(a.totalFrames === outer, 'AUDIO_PLAN_DURATION_MISMATCH');
      if (t) fail(a.totalFrames === t.totalFrames, 'CREATIVE_PLAN_DURATION_MISMATCH');
      for (const cue of a.events) errors.push(...audioEventErrors(cue, a.totalFrames));
    }
  }
  const rules = context.presetConfig ?? presets;
  const all = targets(rules), allowed = new Map(all.map(t => [t.targetId, t]));
  const composition = context.composition;
  if (v.kind === 'resource_manifest') {
    fail(new Set(v.resources.map(x => x.path)).size === v.resources.length, 'DUPLICATE_RESOURCE_PATH');
    for (const resource of v.resources) {
      fail(safePath(resource.path), 'UNSAFE_RESOURCE_PATH');
      fail(resource.mediaType !== 'application/pdf', 'EVIDENCE_NOT_RENDER_RESOURCE');
      if (context.production || context.licenseRegistry) errors.push(...resourceRightsErrors(resource, context));
    }
    for (const event of v.audioEvents) {
      errors.push(...audioEventErrors(event, composition?.totalFrames));
      fail(v.resources.some(x => x.sha256 === event.sourceHash && x.licenseRef === event.licenseRef), 'AUDIO_RESOURCE_NOT_COVERED');
      fail(v.resources.some(x => x.sha256 === event.sourceHash && x.mediaType.startsWith('audio/')), 'AUDIO_SOURCE_TYPE_INVALID');
      if (context.production || context.audioMetadata) {
        const meta = own(context.audioMetadata,event.sourceHash);
        const valid = meta && Number.isSafeInteger(meta.sampleRate) && meta.sampleRate >= 8000 && meta.sampleRate <= 384000
          && Number.isSafeInteger(meta.channels) && meta.channels > 0 && meta.channels <= 8
          && Number.isSafeInteger(meta.sampleFrames) && meta.sampleFrames >= 0;
        fail(valid, 'AUDIO_METADATA_REQUIRED');
        if (valid) fail((BigInt(event.sourceOffsetFrames) + BigInt(event.frameEndExclusive - event.frameStart)) * BigInt(meta.sampleRate) <= BigInt(meta.sampleFrames) * 30n, 'AUDIO_SOURCE_RANGE_INVALID');
      }
    }
    fail(v.audioEvents.length === 0 ? v.mixedAudio === null : v.mixedAudio !== null, 'MIXED_AUDIO_REQUIRED');
    if (v.mixedAudio) {
      fail(safePath(v.mixedAudio.resourcePath), 'UNSAFE_MIXED_AUDIO_PATH');
      fail(v.resources.some(x => x.path === v.mixedAudio.resourcePath && x.sha256 === v.mixedAudio.sha256 && x.mediaType === 'audio/wav'), 'MIXED_AUDIO_RESOURCE_MISMATCH');
      if (context.production || context.audioMetadata) {
        const meta = own(context.audioMetadata,v.mixedAudio.sha256);
        fail(!!composition && meta?.sampleRate === 48000 && meta.channels === 2 && meta.sampleFrames === composition.totalFrames * 1600, 'MIXED_AUDIO_FORMAT_INVALID');
      }
    }
    if (Object.hasOwn(context, 'observedMixedAudio')) fail(canonical(context.observedMixedAudio) === canonical(v.mixedAudio), 'MIXED_AUDIO_NOT_CONSUMED');
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
    const catalog = (context.quotaCatalog ?? load('config/agent-policy.json').quota)[v.sku];
    fail(catalog?.checkoutEnabled === true, 'SKU_CHECKOUT_DISABLED');
    fail(catalog?.allowedPurchaseIntents?.includes(v.purchaseIntent), 'PURCHASE_INTENT_NOT_ALLOWED');
    fail(v.purchaseIntent === 'purchase_and_export' ? !!v.snapshotId : !Object.hasOwn(v, 'snapshotId'), 'SNAPSHOT_INTENT_MISMATCH');
    fail(v.sku === 'project_upgrade' ? !!v.upgradeFromOrderId : !Object.hasOwn(v, 'upgradeFromOrderId'), 'UPGRADE_SOURCE_MISMATCH');
  }
  if (v.kind === 'preview_request' && context.production) errors.push(...trustedPreviewErrors(v,context));
  if (v.kind === 'composition' && context.baseComposition) errors.push(...revisionEnvironmentErrors(context.baseComposition,v));
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
    if (context.requireAllTargets || v.kind === 'release_snapshot') fail(all.every(t => ownTargets.has(t.targetId)), 'VARIANTS_NOT_READY');
    fail(v.presetRulesVersion === rules.rulesVersion, 'PRESET_VERSION_UNAVAILABLE');
    if (v.kind === 'composition') for (const variant of v.variants) {
      if (allowed.has(variant.targetId)) fail(variant.variantHash === digest(variantIdentity(v, variant, rules)), 'VARIANT_HASH_MISMATCH');
    }
  }
  if (v.renderProfile) {
    fail(Object.values(rules.renderProfiles ?? {}).some(profile => canonical(profile) === canonical(v.renderProfile)), 'RENDER_PROFILE_UNAVAILABLE');
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
      fail(canonical(v.renderProfile) === canonical(composition.renderProfile), 'RENDER_PROFILE_MISMATCH');
    }
  }
  if (v.command === 'sample' || v.event === 'sample-ready') {
    fail(context.rendererSession === true, 'RENDERER_SESSION_REQUIRED');
    fail(!!composition && v.sampleIndex < composition.renderProfile.sampleCount, 'SAMPLE_OUT_OF_RANGE');
    if (composition && v.event === 'sample-ready') fail(v.manifestHash === digest(composition), 'RENDER_MANIFEST_MISMATCH');
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
          fail(Array.isArray(manifest.audioEvents) && variant.audioHash === digest(audioIdentity(manifest)), 'AUDIO_MANIFEST_HASH_MISMATCH');
        }
        const observation = own(context.resourceObservations, resourceHash);
        if (v.kind === 'release_snapshot' || context.requireQuality || v.state === 'ready') {
          fail(Array.isArray(observation?.resources) && Array.isArray(observation?.audioEvents) && Object.hasOwn(observation, 'mixedAudio'), 'RESOURCE_OBSERVATION_REQUIRED');
        }
        const resourceContentHash = digest(resourceContentIdentity(manifest));
        if (resourceHash === source.resourceManifestHash) fail(source.resourceContentHash === resourceContentHash, 'RESOURCE_CONTENT_HASH_MISMATCH');
        for (const variant of source.variants.filter(item => item.resourceManifestHash === resourceHash)) fail(variant.resourceContentHash === resourceContentHash, 'RESOURCE_CONTENT_HASH_MISMATCH');
        errors.push(...semanticErrors(manifest, {...context,composition:source,projectId:source.projectId,intendedUse:usage,
          licenseVersions,observedResources:observation?.resources,observedAudioEvents:observation?.audioEvents,
          ...(observation && Object.hasOwn(observation,'mixedAudio') ? {observedMixedAudio:observation.mixedAudio} : {})}));
        for (const resource of manifest.resources ?? []) references.add(resource.licenseRef);
      }
      if (commercial && frozen) fail(canonical([...references].sort()) === canonical(Object.keys(licenseVersions).sort()), 'FROZEN_LICENSE_SET_MISMATCH');
      const needsReports = context.requireQuality === true || commercial || v.state === 'ready';
      if (needsReports) {
        errors.push(...sourceBuildErrors(source,context.sourceBuilds));
        for (const variant of source.variants) {
          const build = own(context.sourceBuilds,variant.targetId);
          if (!build) continue;
          fail(build.exampleOnly !== true, 'FIXTURE_SOURCE_BUILD_IN_PRODUCTION');
          fail(Array.isArray(build.editables) && !!build.values, 'SOURCE_VALUES_OBSERVATION_REQUIRED');
          if (!Array.isArray(build.editables) || !build.values) continue;
          fail(new Set(build.editables.map(item => item.id)).size === build.editables.length, 'DUPLICATE_EDITABLES');
          for (const definition of build.editables) errors.push(...validateSchema(definition,schema.$defs.editableDeclaration));
          const sourceValues = {schemaVersion:source.schemaVersion,kind:'source_values',values:build.values};
          errors.push(...validateSchema(sourceValues,schema.$defs.sourceValues));
          const definitions = Object.fromEntries(build.editables.map(item => [item.id,item]));
          const facts = Object.fromEntries((context.factManifest?.facts ?? []).map(fact => [fact.factId,fact]));
          const resources = Object.fromEntries(Object.values(context.resourceManifests ?? {}).flatMap(manifest => manifest.resources.map(resource => [resource.path,resource])));
          errors.push(...studioErrors(sourceValues,{editables:definitions,facts,resources,requireFactBindings:true}));
        }
        const qaProfileVersion = frozen?.qaProfileVersion ?? context.qaProfileVersion;
        fail(!!qaProfileVersion && !!own(context.qaProfiles, qaProfileVersion), 'QA_PROFILE_UNAVAILABLE');
        const variants = commercial || !v.targetId ? source.variants : source.variants.filter(x => x.targetId === v.targetId);
        const associations = frozen?.qualityAssociations ?? context.qualityAssociations;
        fail(Array.isArray(associations), 'QA_ASSOCIATIONS_REQUIRED');
        if (Array.isArray(associations)) {
          fail(new Set(associations.map(a => a.targetId)).size === associations.length, 'DUPLICATE_QA_ASSOCIATION');
          for (const variant of variants) {
            const association = associations.find(a => a.targetId === variant.targetId);
            fail(!!association, 'QA_ASSOCIATION_REQUIRED');
            if (!association) continue;
            errors.push(...qualityAssociationErrors(association, source, {...context, qaProfileVersion,
              frozenQuality: v.kind === 'export_manifest',
              qualityAt: commercial ? Date.parse(frozen?.confirmedAt) : context.now}));
          }
        }
      }

      fail(!!context.factManifest && context.factManifest.exampleOnly !== true, 'PRODUCTION_FACT_MANIFEST_REQUIRED');
      if (context.factManifest) {
        fail(source.factManifestHash === digest(context.factManifest), 'FACT_MANIFEST_HASH_MISMATCH');
        fail(source.factContentHash === digest(factContentIdentity(context.factManifest)), 'FACT_CONTENT_HASH_MISMATCH');
        errors.push(...semanticErrors(context.factManifest, {...context,composition:source,projectId:source.projectId,
          requireFactConfirmation: context.requireFactConfirmation === true || needsReports, frozenFacts: v.kind === 'export_manifest',
          factConfirmationAt: commercial ? Date.parse(frozen?.confirmedAt) : context.now}));
      }
    }
  }
  if (v.kind === 'release_snapshot' && composition) {
    fail(v.totalFrames === composition.totalFrames && v.durationSeconds === composition.durationSeconds && v.fps === composition.fps, 'SNAPSHOT_TIMING_MISMATCH');
    fail(v.presetRulesVersion === composition.presetRulesVersion, 'SNAPSHOT_RULES_MISMATCH');
    fail(v.compositionHash === digest(composition), 'COMPOSITION_HASH_MISMATCH');
    fail(v.contentHash === digest(contentIdentity(composition)), 'CONTENT_HASH_MISMATCH');
    fail(canonical(v.variants) === canonical(composition.variants), 'FROZEN_VARIANT_CHANGED');
    fail(new Set(v.qualityAssociations.map(a => a.targetId)).size === v.qualityAssociations.length, 'DUPLICATE_QA_ASSOCIATION');
    fail(v.qualityAssociations.length === v.variants.length && v.variants.every(variant => v.qualityAssociations.some(a => a.targetId === variant.targetId)), 'QA_ASSOCIATION_TARGET_MISMATCH');
    for (const association of v.qualityAssociations) errors.push(...qualityAssociationErrors(association, composition, {...context, qaProfileVersion:v.qaProfileVersion,qualityAt:Date.parse(v.confirmedAt)}));
    if (context.production) fail(Number.isFinite(context.now) && Date.parse(v.confirmedAt) <= context.now, 'SNAPSHOT_CONFIRMATION_TIME_INVALID');
    fail(v.factManifestHash === composition.factManifestHash && v.rendererImageDigest === composition.rendererImageDigest, 'SNAPSHOT_PROVENANCE_MISMATCH');
    if (context.qaProfileVersion) fail(v.qaProfileVersion === context.qaProfileVersion, 'STALE_QA_PROFILE');
  }
  if (v.kind === 'export_manifest') {
    if (composition) fail(v.compositionHash === digest(composition), 'EXPORT_COMPOSITION_MISMATCH');
    if (context.snapshot) {
      fail(v.snapshotId === context.snapshot.snapshotId && v.snapshotHash === digest(context.snapshot), 'EXPORT_SNAPSHOT_MISMATCH');
      fail(canonical([...v.initialTargetIds].sort()) === canonical([...context.snapshot.initialTargetIds].sort()), 'EXPORT_INITIAL_TARGET_MISMATCH');
      fail(v.projectId === context.snapshot.projectId && v.revisionId === context.snapshot.revisionId, 'EXPORT_SNAPSHOT_IDENTITY_MISMATCH');
      fail(v.markingProfileVersion === context.snapshot.markingProfileVersion, 'EXPORT_MARKING_PROFILE_MISMATCH');
      fail(v.qaProfileVersion === context.snapshot.qaProfileVersion, 'EXPORT_QA_PROFILE_MISMATCH');
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
      if (a.state === 'ready' && a.kind !== 'mapping' && (context.production || context.qualityEvidence)) {
        errors.push(...outputQualityErrors({...a,projectId:v.projectId,revisionId:v.revisionId,qaProfileVersion:v.qaProfileVersion},context));
      }
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
    if (context.production || context.markingEvidence) errors.push(...markingErrors({...v,id:v.previewId,assetId:v.screenshotAssetId},context));
    if (v.mediaKind === 'clip') {
      fail(typeof v.clipAssetId === 'string' && v.clipAssetId.length > 0, 'READY_CLIP_WITHOUT_ASSET');
      fail(hash(v.clipSha256), 'READY_CLIP_WITHOUT_HASH');
      if (context.production || context.markingEvidence) errors.push(...markingErrors({...v,id:v.previewId,assetId:v.clipAssetId,
        sha256:v.clipSha256,markingEvidenceRef:v.clipMarkingEvidenceRef},context));
    }
  }
  if (v.kind === 'fact_manifest') {
    fail(new Set(v.bindings.map(b => b.bindingId)).size === v.bindings.length, 'DUPLICATE_BINDING');
    const facts = new Map(v.facts.map(f => [f.factId, f]));
    fail(facts.size === v.facts.length, 'DUPLICATE_FACT');
    const requireConfirmation = context.requireFactConfirmation === true || context.requireQuality === true;
    if (requireConfirmation && context.production) fail(!!context.factRevocations && typeof context.factRevocations === 'object', 'FACT_REVOCATION_STATE_REQUIRED');
    for (const fact of v.facts) {
      const versionKey = factVersionKey(v.projectId,fact);
      if (requireConfirmation) {
        const at = context.factConfirmationAt ?? context.now;
        fail(typeof fact.confirmedBy === 'string' && typeof fact.confirmedAt === 'string', 'FACT_CONFIRMATION_REQUIRED');
        if (context.production) fail(Number.isFinite(at) && typeof fact.confirmedAt === 'string' && Date.parse(fact.confirmedAt) <= at, 'FACT_CONFIRMATION_TIME_INVALID');
        if (!context.frozenFacts && (context.production || context.facts)) {
          const current = own(context.facts, fact.factId);
          fail(!!current && current.version === fact.version && current.textHash === digest(fact.text)
            && current.confirmation?.confirmedBy === fact.confirmedBy && current.confirmation?.confirmedAt === fact.confirmedAt
            && (!current.projectId || current.projectId === v.projectId)
            && (!current.workspaceId || current.workspaceId === context.workspaceId), 'STALE_FACT_CONFIRMATION');
        }
        fail(own(context.factRevocations,versionKey)?.revoked !== true, 'FACT_CONFIRMATION_REVOKED');
        fail(fact.evidenceRefs.length > 0, 'FACT_EVIDENCE_REQUIRED');
      }
      if (!(context.production || context.evidenceRegistry)) continue;
      const claimKind = own(context.claimKinds, versionKey);
      if (requireConfirmation) fail(['general','testimonial','outcome','promotion'].includes(claimKind), 'FACT_CLASSIFICATION_REQUIRED');
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
      if (requireConfirmation && claimKind !== 'general') fail(sourceEvidence, 'FACT_SOURCE_EVIDENCE_REQUIRED');
    }
    for (const b of v.bindings) {
      fail(allowed.has(b.targetId), 'FACT_TARGET_INVALID');
      fail(b.frameEndExclusive > b.frameStart && (!composition || b.frameEndExclusive <= composition.totalFrames), 'FACT_INTERVAL_INVALID');
      fail(b.factIds.every(id => facts.has(id)), 'UNKNOWN_FACT');
      // A display string must match a declared fact phrase. Confirmation is a separate delivery gate.
      fail(b.factIds.some(id => facts.get(id)?.text === b.expectedText), 'UNCONFIRMED_DISPLAY_TEXT');
    }
  }
  if (v.kind === 'patch_result') for (const path of v.changedFiles) fail(safePath(path), 'UNSAFE_PATCH_PATH');
  if (v.kind === 'quality_report') {
    if (composition) {
      const variant = composition.variants.find(x => x.targetId === v.targetId);
      if (variant && allowed.has(v.targetId)) fail(v.qaInputHash === digest(qaInputIdentity(composition,variant,v.qaProfileVersion,rules)), 'STALE_QA_INPUT');
    } else if (context.production) fail(false, 'QA_COMPOSITION_REQUIRED');
    if (context.workspaceId || context.production) fail(v.workspaceId === context.workspaceId, 'QA_REPORT_SCOPE_MISMATCH');
    if (context.qaProfileVersion) fail(v.qaProfileVersion === context.qaProfileVersion, 'STALE_QA_PROFILE');
    if (context.production) {
      const profile = own(context.qaProfiles, v.qaProfileVersion);
      fail(!!profile && profile.checkerVersion === v.checkerVersion, 'QA_PROFILE_UNAVAILABLE');
      if (profile) fail(profile.exampleOnly !== true, 'FIXTURE_QA_IN_PRODUCTION');
      fail(v.coverage !== 'fixture_only', 'FIXTURE_QA_IN_PRODUCTION');
      fail(Number.isFinite(context.now), 'TRUSTED_QA_TIME_REQUIRED');
    }
    fail(new Set(v.findings.map(f => f.findingId)).size === v.findings.length, 'DUPLICATE_QA_FINDING');
    for (const f of v.findings) fail(f.frameEndExclusive > f.frameStart && (!composition || f.frameEndExclusive <= composition.totalFrames), 'QA_INTERVAL_INVALID');
  }
  if (v.kind === 'quality_association') errors.push(...qualityAssociationErrors(v, composition, context));
  if (v.kind === 'quality_waiver') {
    const report = context.qualityReport ?? own(context.qualityReports, v.reportHash);
    fail(!!report && digest(report) === v.reportHash, 'WAIVER_REPORT_REQUIRED');
    if (report) {
      fail(['workspaceId','projectId','targetId','qaInputHash','qaProfileVersion'].every(key => report[key] === v[key]), 'STALE_WAIVER');
      const finding = report.findings.find(f => f.findingId === v.findingId);
      fail(!!finding, 'WAIVER_FINDING_MISMATCH');
      fail(finding?.level === 'REVIEW', 'BLOCK_NOT_WAIVABLE');
    }
    if (context.workspaceId || context.production) fail(v.workspaceId === context.workspaceId, 'WAIVER_SCOPE_MISMATCH');
    if (context.qaProfileVersion) fail(v.qaProfileVersion === context.qaProfileVersion, 'STALE_QA_PROFILE');
    const at = context.qualityAt ?? context.now;
    fail(Number.isFinite(at) && Date.parse(v.acceptedAt) <= at, 'INVALID_WAIVER_ACCEPTANCE_TIME');
    fail(Number.isFinite(at) && Date.parse(v.expiresAt) > at, 'EXPIRED_WAIVER');
    fail(v.reason.trim().length > 0, 'EMPTY_WAIVER_REASON');
    if (!context.frozenQuality) {
      if (context.production) fail(Number.isFinite(context.now) && Date.parse(v.expiresAt) > context.now, 'EXPIRED_WAIVER');
      const actor = own(context.waiverActors, v.actorId);
      fail(!!actor && actor.active === true && actor.workspaceId === v.workspaceId && ['owner','editor'].includes(actor.role), 'WAIVER_ACTOR_NOT_AUTHORIZED');
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
    const result = {schemaVersion:'2.7.0',kind:'create_project_result',requestId:request.requestId,projectId,workspaceId:request.workspaceId,trialStatus};
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
    const previous = this.requests.get(request.requestId);
    const errors = semanticErrors(request,{quotaCatalog:this.catalog}).filter(error => !previous || error !== 'SKU_CHECKOUT_DISABLED');
    if (request.kind !== 'checkout_request' || errors.length) throw Error(errors.join(',') || 'INVALID_CHECKOUT');
    if (request.projectId !== this.projectId || !recoverable) throw Error('PROJECT_UNAVAILABLE');
    const signature = digest(request);
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
  return !disposed && command.previewEpoch === undefined && validateSchema(command, schema.$defs.renderSeek).length === 0 && validateSchema(response, schema.$defs.renderReady).length === 0 && response.event === 'frame-ready' && response.manifestHash === manifestHash && ['protocolVersion', 'sessionId', 'requestId', 'sequence', 'revisionId', 'targetId', 'frameIndex'].every(k => response[k] === command[k]);
}

/** Internal sample replies cannot satisfy Studio's final-frame acknowledgement. */
export function matchesSampleReady(command, response, manifestHash, context = {}, disposed = false) {
  return !disposed && context.rendererSession === true
    && validateSchema(command,schema.$defs.renderSample).length === 0
    && validateSchema(response,schema.$defs.renderSampleReady).length === 0
    && semanticErrors(command,context).length === 0 && semanticErrors(response,context).length === 0
    && response.manifestHash === manifestHash
    && ['protocolVersion','sessionId','requestId','sequence','revisionId','targetId','frameIndex','sampleIndex'].every(k => response[k] === command[k]);
}

/** Ignore stale failures just as strictly as stale frame-ready events. */
export function matchesProtocolFailure(command, response, disposed = false, previewEpoch) {
  if (disposed || (validateSchema(command,schema.$defs.rendererCommand).length && validateSchema(command,schema.$defs.renderCommand).length)
    || validateSchema(response,schema.$defs.renderError).length) return false;
  if (command.previewEpoch !== undefined && response.previewEpoch !== previewEpoch) return false;
  return ['protocolVersion','sessionId','requestId','sequence','revisionId','targetId','previewEpoch'].every(k => command[k] === response[k]);
}
