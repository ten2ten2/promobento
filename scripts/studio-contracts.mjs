// Reference validation of Studio boundaries; no API, rendering or authorization service runs here.
import { readFileSync } from 'node:fs';
import { parseCanonicalJson } from '../packages/contracts/index.mjs';
const previewPolicy = parseCanonicalJson(readFileSync(new URL('../config/preview.json',import.meta.url)));
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const safePath = value => typeof value === 'string' && value.length > 0
  && !value.startsWith('/') && !/[\\\u0000-\u001f\u007f]/u.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..');
const apiKinds = new Set(['project_result','draft_update_request','draft_update_result','job_result','preview_session_request','preview_session_result']);
const rational = value => value && Number.isSafeInteger(value.numerator) && value.numerator >= 0
  && Number.isSafeInteger(value.denominator) && value.denominator > 0
  ? {n:BigInt(value.numerator),d:BigInt(value.denominator)} : null;
const less = (a,b) => a.n*b.d < b.n*a.d;
const add = (a,b) => ({n:a.n*b.d+b.n*a.d,d:a.d*b.d});
const sub = (a,b) => ({n:a.n*b.d-b.n*a.d,d:a.d*b.d});
const divide = (a,b) => ({n:a.n*b.d,d:a.d*b.n});

function valueErrors(value, definition, context) {
  const errors = [], fail = (ok, code) => { if (!ok) errors.push(code); };
  if (!definition) return ['EDITABLE_NOT_DECLARED'];
  switch (definition.type) {
    case 'text': fail(typeof value === 'string' && [...value].length <= 6000, 'EDITABLE_TEXT_INVALID'); break;
    case 'color': fail(typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/iu.test(value), 'EDITABLE_COLOR_INVALID'); break;
    case 'number':
      fail(typeof value === 'number' && Number.isFinite(value)
        && (definition.min === undefined || value >= definition.min)
        && (definition.max === undefined || value <= definition.max), 'EDITABLE_NUMBER_OUT_OF_RANGE');
      break;
    case 'boolean': fail(typeof value === 'boolean', 'EDITABLE_BOOLEAN_INVALID'); break;
    case 'enum': fail(definition.choices?.includes(value), 'EDITABLE_CHOICE_INVALID'); break;
    case 'data': fail(Array.isArray(value) && value.length <= 1000 && value.every(row => row && typeof row === 'object'
      && !Array.isArray(row) && Object.keys(row).length <= 32 && Object.entries(row).every(([key,cell]) =>
        [...key].length > 0 && [...key].length <= 64 && (cell === null || typeof cell === 'boolean'
          || (typeof cell === 'string' && [...cell].length <= 6000) || (typeof cell === 'number' && Number.isFinite(cell))))), 'EDITABLE_DATA_INVALID'); break;
    case 'asset': {
      const resource = own(context.resources,value);
      fail(typeof value === 'string' && safePath(value) && !!resource && resource.purpose !== 'evidence'
        && resource.mediaType !== 'application/pdf', 'EDITABLE_ASSET_UNAVAILABLE');
      break;
    }
    default: errors.push('EDITABLE_TYPE_INVALID');
  }
  return errors;
}

/** Expand one fact edit to every declared text binding. The caller still owns the save transaction. */
export function boundValueUpdates(values, editables) {
  const updates = new Map(Object.entries(values)), facts = new Map();
  for (const [id,value] of updates) {
    const definition = own(editables,id);
    if (!definition?.factId) continue;
    if (facts.has(definition.factId) && facts.get(definition.factId) !== value) throw Error('EDITABLE_FACT_VALUE_CONFLICT');
    facts.set(definition.factId,value);
  }
  for (const definition of Object.values(editables ?? {})) {
    if (facts.has(definition.factId)) updates.set(definition.id,facts.get(definition.factId));
  }
  return Object.fromEntries(updates);
}

function checkedValueUpdates(values, context) {
  const updates = boundValueUpdates(values,context.editables);
  for (const [id,value] of Object.entries(updates)) {
    const definition = own(context.editables,id), errors = valueErrors(value,definition,context);
    if (errors.length) throw Error(errors[0]);
    if (definition.affectsTiming === true) throw Error('EDITABLE_REQUIRES_AI');
  }
  return updates;
}

/** Reverse synchronization for facts.update; deletion of a bound fact needs an explicit source edit. */
export function factValueUpdates(changes, editables) {
  const updates = new Map();
  for (const change of changes) for (const definition of Object.values(editables ?? {})) {
    if (definition.factId !== change.factId) continue;
    if (change.action !== 'upsert') throw Error('BOUND_FACT_REMOVAL_REQUIRES_SOURCE_EDIT');
    if (definition.type !== 'text' || definition.affectsTiming === true) throw Error('EDITABLE_REQUIRES_AI');
    updates.set(definition.id,change.text);
  }
  return Object.fromEntries(updates);
}

/** A local preparation only. It creates no revision, fact confirmation, billable run or QA result. */
export function localPreviewValues(valuesOverlay, context) {
  if (!context.editables || !context.sourceValues) throw Error('PREVIEW_VALUES_REQUIRED');
  const sourceErrors = studioErrors({kind:'source_values',values:context.sourceValues},
    {editables:context.editables,resources:context.resources});
  if (sourceErrors.length) throw Error(sourceErrors[0]);
  return {...structuredClone(context.sourceValues),...checkedValueUpdates(valuesOverlay,context)};
}

/** Context is a trusted projection of current records, source declarations and observations. */
export function studioErrors(v, context = {}, helpers = {}) {
  const errors = [], fail = (ok, code) => { if (!ok) errors.push(code); };
  if (!v || typeof v !== 'object') return errors;
  if (apiKinds.has(v.kind)) {
    if (context.production) fail(context.authorized === true && !!context.workspaceId && !!context.projectId, 'STUDIO_AUTHORIZATION_REQUIRED');
    if (context.projectId) fail(v.projectId === context.projectId, 'STUDIO_PROJECT_MISMATCH');
    if (v.workspaceId && context.workspaceId) fail(v.workspaceId === context.workspaceId, 'STUDIO_WORKSPACE_MISMATCH');
  }
  if (v.kind === 'project_result') {
    const actions = v.availableActions ?? [];
    fail(new Set(actions.map(action => action.action)).size === actions.length, 'DUPLICATE_STUDIO_ACTION');
    for (const action of actions) fail(action.enabled ? action.reasonCode === null : typeof action.reasonCode === 'string', 'ACTION_REASON_REQUIRED');
    if (v.primaryAction !== null) fail(actions.some(action => action.action === v.primaryAction && action.enabled), 'PRIMARY_ACTION_UNAVAILABLE');
    if (v.unconfirmedFactIds?.length) fail(v.qualityEligibility !== 'ready', 'UNCONFIRMED_DRAFT_CANNOT_BE_READY');
    if (v.draftRevisionId === null) fail(v.qualityEligibility === 'unchecked', 'EMPTY_DRAFT_QUALITY_INVALID');
    if (v.brandFontSelection && context.production) {
      const selection = v.brandFontSelection;
      const font = own(context.fontRegistry,selection.fontId);
      fail(font?.registryVersion === selection.registryVersion && selection.weights.every(weight => font.weights.includes(weight)), 'BRAND_FONT_NOT_APPROVED');
      for (const id of selection.fallbackFontIds) fail(own(context.fontRegistry,id)?.registryVersion === selection.registryVersion, 'BRAND_FONT_FALLBACK_UNAVAILABLE');
    }
  }
  if (v.kind === 'draft_update_request') {
    fail(typeof context.currentRevisionId === 'string', 'DRAFT_CURRENT_REVISION_REQUIRED');
    fail(v.baseRevision === context.currentRevisionId, 'DRAFT_CONFLICT');
    if (v.changes) {
      fail(new Set(v.changes.map(change => change.editableId)).size === v.changes.length, 'DUPLICATE_EDITABLE_CHANGE');
      for (const change of v.changes) {
        const definition = own(context.editables,change.editableId);
        if (definition?.factId) {
          const fact = own(context.facts,definition.factId);
          fail(definition.type === 'text' && !!fact && fact.recordVersion === change.expectedFactRecordVersion, 'EDITABLE_FACT_CONFLICT');
          fail(typeof change.value === 'string' && change.value.trim().length > 0, 'EMPTY_FACT');
        } else fail(change.expectedFactRecordVersion === undefined, 'UNBOUND_FACT_VERSION');
      }
      try { checkedValueUpdates(Object.fromEntries(v.changes.map(change => [change.editableId,change.value])),context); }
      catch (error) { errors.push(error.message); }
    }
    if (v.restoreFromRevisionId) {
      const revision = own(context.revisions,v.restoreFromRevisionId);
      fail(!!revision && revision.projectId === v.projectId && revision.workspaceId === context.workspaceId, 'RESTORE_REVISION_UNAVAILABLE');
    }
  }
  if (v.kind === 'facts_update_request') {
    if (context.production) fail(!!context.editables, 'EDITABLE_DECLARATIONS_REQUIRED');
    const bound = Object.values(context.editables ?? {}).some(definition => v.changes.some(change => change.factId === definition.factId));
    if (bound || v.baseRevision !== undefined) fail(typeof context.currentRevisionId === 'string'
      && v.baseRevision === context.currentRevisionId, 'DRAFT_CONFLICT');
    try { factValueUpdates(v.changes,context.editables); } catch (error) { errors.push(error.message); }
  }
  if (v.kind === 'draft_update_result') {
    if (v.state === 'saved') {
      fail(v.revisionId === v.currentRevisionId, 'SAVED_REVISION_MISMATCH');
      if (v.unconfirmedFactIds?.length) fail(v.qualityEligibility !== 'ready', 'UNCONFIRMED_DRAFT_CANNOT_BE_READY');
    } else if (v.state === 'conflict') fail(v.currentRevisionId !== v.baseRevision, 'DRAFT_CONFLICT_CURRENT_REVISION_INVALID');
  }
  if (v.kind === 'job_result') {
    if (v.progress?.total !== null && v.progress?.total !== undefined) fail(v.progress.completed <= v.progress.total, 'JOB_PROGRESS_OUT_OF_RANGE');
    if (v.state === 'succeeded') {
      fail(v.stage === 'completed', 'JOB_COMPLETION_STAGE_INVALID');
      if (v.progress?.total !== null && v.progress?.total !== undefined) fail(v.progress.completed === v.progress.total, 'JOB_COMPLETION_PROGRESS_INVALID');
      const resultKind = {media_processing:'asset',creative_generate:'revision',agent_patch:'patch',prepare_targets:'revision',preview:'preview',export:'release'}[v.operation];
      fail(v.result?.kind === resultKind, 'JOB_RESULT_REQUIRED');
    } else fail(v.result === null, 'JOB_RESULT_NOT_READY');
    fail(v.state === 'failed' ? typeof v.errorCode === 'string' : v.errorCode === null, 'JOB_ERROR_STATE_INVALID');
    if (v.canRetry) fail(v.state === 'failed', 'JOB_RETRY_STATE_INVALID');
    if (v.retryAfterMs !== null) fail(v.canRetry, 'JOB_RETRY_DELAY_INVALID');
  }
  if (v.kind === 'preview_session_request' || v.kind === 'preview_session_result') {
    const revision = own(context.revisions,v.revisionId);
    fail(!!revision && revision.projectId === v.projectId && revision.workspaceId === context.workspaceId, 'PREVIEW_SOURCE_UNAVAILABLE');
    if (revision) fail(revision.targetIds?.includes(v.targetId), 'PREVIEW_TARGET_UNAVAILABLE');
    if (context.production) fail(context.localPreviewAllowed === true, 'LOCAL_PREVIEW_ACCESS_REQUIRED');
    if (v.kind === 'preview_session_result') {
      try {
        const origin = new URL(v.previewOrigin), frame = new URL(v.frameUrl);
        fail(origin.origin === v.previewOrigin && origin.protocol === 'https:' && !origin.username && !origin.password
          && v.previewOrigin === context.previewOrigin && v.previewOrigin !== context.appOrigin, 'PREVIEW_ORIGIN_UNTRUSTED');
        fail(frame.origin === origin.origin && !frame.username && !frame.password && !frame.hash, 'PREVIEW_FRAME_URL_UNTRUSTED');
      } catch { errors.push('PREVIEW_URL_INVALID'); }
      fail(Number.isFinite(context.now) && Date.parse(v.expiresAt) > context.now
        && Date.parse(v.expiresAt) <= context.now + previewPolicy.isolation.sessionTtlSeconds * 1000, 'PREVIEW_SESSION_EXPIRY_INVALID');
      fail(v.previewPolicyVersion === (context.previewPolicyVersion ?? previewPolicy.policyVersion)
        && v.pixelScale === previewPolicy.localPlayback.pixelScale, 'PREVIEW_POLICY_MISMATCH');
      if (revision) {
        fail(v.manifestHash === revision.manifestHash && v.frameCount === revision.totalFrames, 'PREVIEW_SOURCE_IDENTITY_MISMATCH');
        fail(v.mixedAudioHash === revision.mixedAudioHash, 'PREVIEW_AUDIO_IDENTITY_MISMATCH');
      }
      const [,aspect] = (v.targetId ?? '').split(':');
      const layout = helpers.presets?.aspectLayouts?.[aspect];
      if (layout) fail(v.width === layout.width && v.height === layout.height, 'PREVIEW_LOGICAL_SIZE_MISMATCH');
      else if (context.production) fail(false, 'PREVIEW_PLATFORM_RULES_REQUIRED');
    }
  }
  if (v.command === 'init') {
    fail((v.mode === 'local_preview' && v.pixelScale === previewPolicy.localPlayback.pixelScale)
      || (v.mode === 'trusted_render' && v.pixelScale === previewPolicy.trustedCapture.pixelScale), 'RENDER_SCALE_POLICY_MISMATCH');
    if (context.previewSession) fail(v.mode === 'local_preview'
      && ['pixelScale','sessionId','revisionId','targetId','manifestHash','frameCount','width','height','fps']
        .every(key => v[key] === context.previewSession[key]), 'PREVIEW_INIT_SESSION_MISMATCH');
    if (v.mode === 'local_preview') {
      fail(v.previewEpoch === 0, 'PREVIEW_EPOCH_INVALID');
      if (v.valuesOverlay !== undefined) try { localPreviewValues(v.valuesOverlay,context); } catch (error) { errors.push(error.message); }
    } else fail(v.valuesOverlay === undefined && v.previewEpoch === undefined, 'TRUSTED_RENDER_OVERLAY_FORBIDDEN');
  }
  if (v.command === 'set-values') {
    const session = context.previewSession;
    fail(!!session && ['sessionId','revisionId','targetId','manifestHash'].every(key => v[key] === session[key])
      && context.rendererSession !== true && context.disposed !== true, 'LOCAL_VALUES_SESSION_REQUIRED');
    fail(Number.isSafeInteger(context.previewEpoch) && v.previewEpoch === context.previewEpoch + 1, 'PREVIEW_EPOCH_INVALID');
    fail(Number.isSafeInteger(context.lastSequence) && v.sequence > context.lastSequence, 'PREVIEW_SEQUENCE_INVALID');
    try { localPreviewValues(v.valuesOverlay,context); } catch (error) { errors.push(error.message); }
  }
  const localMessage = context.previewSession && (['seek','inspect'].includes(v.command)
    || ['preview-frame-ready','hit-result','error'].includes(v.event));
  if (localMessage) {
    const session = context.previewSession;
    fail(['sessionId','revisionId','targetId'].every(key => v[key] === session[key])
      && (v.manifestHash === undefined || v.manifestHash === session.manifestHash)
      && context.disposed !== true, 'LOCAL_PREVIEW_SESSION_MISMATCH');
    fail(Number.isSafeInteger(context.previewEpoch) && v.previewEpoch === context.previewEpoch, 'PREVIEW_EPOCH_STALE');
    if (v.command) fail(Number.isSafeInteger(context.lastSequence) && v.sequence > context.lastSequence, 'PREVIEW_SEQUENCE_INVALID');
    if (v.frameIndex !== undefined) fail(v.frameIndex < session.frameCount, 'LOCAL_PREVIEW_FRAME_OUT_OF_RANGE');
  }
  if (context.rendererSession === true || context.mode === 'trusted_render') {
    fail(v.previewEpoch === undefined && v.valuesOverlay === undefined && v.command !== 'set-values', 'TRUSTED_RENDER_OVERLAY_FORBIDDEN');
  }
  if (v.event === 'preview-frame-ready') {
    const session = context.previewSession;
    fail(!!session && session.sessionId === v.sessionId && session.revisionId === v.revisionId
      && session.targetId === v.targetId && session.manifestHash === v.manifestHash
      && v.frameIndex < session.frameCount && context.disposed !== true, 'LOCAL_PREVIEW_FRAME_SESSION_MISMATCH');
    const command = context.seekCommand;
    if (context.production || command) fail(command?.command === 'seek'
      && ['protocolVersion','sessionId','requestId','sequence','revisionId','targetId','frameIndex','previewEpoch']
        .every(key => command[key] === v[key]), 'LOCAL_PREVIEW_SEEK_ENVELOPE_MISMATCH');
  }
  if (v.event === 'frame-ready' && context.previewSession) fail(false, 'LOCAL_PREVIEW_CANNOT_CLAIM_FINAL_FRAME');
  if (context.previewSession && (v.command === 'sample' || v.event === 'sample-ready'))
    fail(false, 'LOCAL_PREVIEW_CANNOT_SAMPLE_SUBFRAMES');
  if (v.command === 'inspect' || v.event === 'hit-result') {
    const totalFrames = context.composition?.totalFrames ?? context.totalFrames;
    if (totalFrames !== undefined) fail(v.frameIndex < totalFrames, 'INSPECT_FRAME_OUT_OF_RANGE');
    fail(context.disposed !== true, 'INSPECT_SESSION_DISPOSED');
    if (v.event === 'hit-result') {
      const command = context.inspectCommand;
      if (context.production || command) fail(command?.command === 'inspect'
        && ['protocolVersion','sessionId','requestId','sequence','revisionId','targetId','frameIndex','previewEpoch'].every(key => command[key] === v[key]), 'INSPECT_ENVELOPE_MISMATCH');
      if (context.manifestHash) fail(v.manifestHash === context.manifestHash, 'INSPECT_MANIFEST_MISMATCH');
      if (v.hit) {
        const region = own(context.regions,v.hit.regionId);
        fail(!!region, 'INSPECT_REGION_UNDECLARED');
        if (region) fail(v.hit.sourcePath === region.sourcePath && v.hit.line === region.line, 'INSPECT_SOURCE_MISMATCH');
        if (v.hit.sourcePath) fail(safePath(v.hit.sourcePath), 'INSPECT_SOURCE_PATH_INVALID');
        const bounds = own(context.regionBounds,v.hit.regionId);
        if (context.production || bounds) fail(!!bounds && ['x','y','width','height'].every(key => bounds[key] === v.hit.bounds[key]), 'INSPECT_BOUNDS_MISMATCH');
      }
    }
  }
  if (v.kind === 'source_values') {
    const definitions = context.editables;
    fail(!!definitions, 'EDITABLE_DECLARATIONS_REQUIRED');
    if (definitions) {
      fail(Object.keys(definitions).length === Object.keys(v.values ?? {}).length, 'EDITABLE_VALUES_INCOMPLETE');
      for (const [id,value] of Object.entries(v.values ?? {})) errors.push(...valueErrors(value,own(definitions,id),context));
      for (const id of Object.keys(definitions)) fail(Object.hasOwn(v.values ?? {},id), 'EDITABLE_VALUE_MISSING');
      if (context.requireFactBindings) for (const definition of Object.values(definitions)) if (definition.factId) {
        const fact = own(context.facts,definition.factId);
        fail(definition.type === 'text' && !!fact && v.values?.[definition.id] === fact.text, 'EDITABLE_FACT_VALUE_MISMATCH');
      }
    }
  }
  if (v.kind === 'runtime_declarations') {
    for (const key of ['editables','markers','regions','videoUses']) fail(new Set((v[key] ?? []).map(item => item.id)).size === (v[key] ?? []).length, 'DUPLICATE_'+key.toUpperCase());
    for (const item of v.editables ?? []) {
      if (item.factId !== undefined) fail(item.type === 'text', 'FACT_BINDING_REQUIRES_TEXT');
      if (item.type === 'enum') fail(Array.isArray(item.choices) && item.choices.length > 0, 'EDITABLE_CHOICES_REQUIRED');
      else fail(item.choices === undefined, 'EDITABLE_CHOICES_NOT_ALLOWED');
      if (item.type !== 'number') fail(['min','max','step'].every(key => item[key] === undefined), 'EDITABLE_RANGE_NOT_ALLOWED');
      else if (item.min !== undefined && item.max !== undefined) fail(item.min <= item.max, 'EDITABLE_RANGE_INVALID');
    }
    const totalFrames = context.composition?.totalFrames ?? context.totalFrames;
    if (context.production) fail([450,900].includes(totalFrames), 'RUNTIME_FRAME_COUNT_REQUIRED');
    for (const marker of v.markers ?? []) {
      if (totalFrames !== undefined) fail(marker.frame < totalFrames, 'MARKER_FRAME_OUT_OF_RANGE');
      if (marker.audioEventIndex !== undefined) {
        const event = (context.audioEvents ?? context.composition?.audioEvents)?.[marker.audioEventIndex];
        fail(!!event && event.frameStart === marker.frame, 'MARKER_AUDIO_EVENT_MISMATCH');
      }
    }
    for (const region of v.regions ?? []) if (region.sourcePath) fail(safePath(region.sourcePath), 'REGION_SOURCE_PATH_INVALID');
    for (const use of v.videoUses ?? []) {
      fail(safePath(use.assetPath), 'VIDEO_SOURCE_PATH_INVALID');
      const start = rational(use.sourceStart), end = rational(use.sourceEndExclusive), at = rational(use.timelineStart), rate = rational(use.playbackRate);
      fail(!!start && !!end && !!at && !!rate && rate.n > 0n && less(start,end), 'VIDEO_USE_INTERVAL_INVALID');
      if (start && end && at && rate?.n > 0n && totalFrames !== undefined) fail(!less({n:BigInt(totalFrames),d:30n},add(at,divide(sub(end,start),rate))), 'VIDEO_USE_EXCEEDS_COMPOSITION');
      const resource = own(context.resources,use.assetPath);
      if (context.production || resource) fail(!!resource && resource.mediaType?.startsWith('video/') && resource.purpose !== 'evidence', 'VIDEO_RESOURCE_UNAVAILABLE');
      const source = own(context.videoSources,use.assetPath), duration = rational(source?.duration);
      if (context.production || source) fail(!!duration && !!end && !less(duration,end), 'VIDEO_USE_EXCEEDS_SOURCE');
    }
    const fonts = v.fonts ?? [];
    fail(new Set(fonts.map(font => font.fontId)).size === fonts.length, 'DUPLICATE_FONT_DECLARATION');
    for (const font of fonts) {
      fail(font.weights.every(weight => font.assets.some(asset => asset.weight === weight)), 'FONT_WEIGHT_ASSET_MISSING');
      for (const id of font.fallbackFontIds) fail(id !== font.fontId && fonts.some(entry => entry.fontId === id), 'FONT_FALLBACK_UNDECLARED');
      if (context.production) {
        const approved = own(context.fontRegistry,font.fontId);
        fail(approved?.registryVersion === font.registryVersion && font.weights.every(weight => approved.weights.includes(weight)), 'FONT_NOT_APPROVED');
      }
      for (const asset of font.assets) {
        fail(font.weights.includes(asset.weight) && safePath(asset.path), 'FONT_ASSET_DECLARATION_INVALID');
        const resource = own(context.resources,asset.path);
        if (context.production || resource) fail(!!resource && resource.sha256 === asset.sha256 && resource.mediaType?.startsWith('font/'), 'FONT_RESOURCE_HASH_MISMATCH');
      }
    }
  }
  if (v.kind === 'preview_result') {
    const clipFields = ['clipAssetId','clipSha256','clipMarkingEvidenceRef'];
    if (v.mediaKind === 'clip' && v.state === 'ready') fail(typeof v.clipAssetId === 'string' && hash(v.clipSha256)
      && typeof v.clipMarkingEvidenceRef === 'string', 'PREVIEW_CLIP_EVIDENCE_REQUIRED');
    else fail(clipFields.every(key => v[key] === null), 'PREVIEW_CLIP_FIELDS_NOT_ALLOWED');
  }
  return errors;
}
