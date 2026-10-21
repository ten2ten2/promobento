// Reference validation of Studio boundaries; no API, rendering or authorization service runs here.
import { readFileSync } from 'node:fs';
import { canonical, createSchemaValidator, digest, parseCanonicalJson, safePath, sourceValuesBytes } from '../packages/contracts/index.mjs';
import { outputSafetyErrors, scopedSafetyCoveragePolicy } from './output-safety.mjs';
const previewPolicy = parseCanonicalJson(readFileSync(new URL('../config/preview.json',import.meta.url)));
const schema = parseCanonicalJson(readFileSync(new URL('../contracts/production.schema.json',import.meta.url)));
const validate = createSchemaValidator(schema);
const own = (object, key) => object && Object.hasOwn(object, key) ? object[key] : undefined;
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const apiKinds = new Set(['project_result','run_result','agent_request','edit_request','candidate_action_request','candidate_result',
  'draft_update_request','draft_update_result','job_result','preview_session_request','preview_session_result']);
export const visibleText = value => typeof value === 'string' && /[^\s\p{Default_Ignorable_Code_Point}\u3164\uffa0]/u.test(value);
const drawable = (path, context) => context.production || context.drawableResourcePaths
  ? context.drawableResourcePaths?.includes(path) === true : true;
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
      fail(typeof value === 'string' && safePath(value) && !!resource && drawable(value,context)
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
    if (definition.type === 'color') updates[id] = value.toLowerCase();
  }
  const mergedValues={...context.sourceValues,...updates};
  const errors=studioErrors({kind:'source_values',values:mergedValues},context);
  if (errors.length) throw Error(errors[0]);
  return updates;
}

/** Shared final values validation for facts.update and ordinary draft saves. */
export function checkedFactValueUpdates(changes,context) {
  for (const change of changes) if (change.action==='upsert' && !visibleText(change.text)) throw Error('EMPTY_FACT');
  const updates=factValueUpdates(changes,context.editables);
  return Object.keys(updates).length ? checkedValueUpdates(updates,context) : updates;
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

/** Rebuild display bindings in the same transaction as the new facts and values.json. */
export function factBindingUpdates(bindings, previousFacts, nextFacts) {
  const before = new Map(previousFacts.map(fact => [fact.factId,fact]));
  const after = new Map(nextFacts.map(fact => [fact.factId,fact]));
  return bindings.map(binding => {
    if (binding.factIds.some(id => !before.has(id))) throw Error('FACT_BINDING_SOURCE_MISMATCH');
    if (binding.factIds.some(id => !after.has(id))) throw Error('BOUND_FACT_REMOVAL_REQUIRES_SOURCE_EDIT');
    const displayedIds = binding.factIds.filter(id => before.get(id)?.text === binding.expectedText);
    if (!displayedIds.length) throw Error('FACT_BINDING_SOURCE_MISMATCH');
    const text = new Set(displayedIds.map(id => after.get(id).text));
    if (text.size !== 1) throw Error('FACT_BINDING_TEXT_AMBIGUOUS');
    return {...structuredClone(binding),expectedText:[...text][0]};
  });
}

/** A local preparation only. It creates no revision, fact confirmation, billable run or QA result. */
export function localPreviewValues(valuesOverlay, context) {
  if (!context.editables || !context.sourceValues) throw Error('PREVIEW_VALUES_REQUIRED');
  const sourceErrors = studioErrors({kind:'source_values',values:context.sourceValues},context);
  if (sourceErrors.length) throw Error(sourceErrors[0]);
  return {...structuredClone(context.sourceValues),...checkedValueUpdates(valuesOverlay,context)};
}

export function creativePlanIdentity(result) {
  return {directions:result.directions ?? [],treatment:result.treatment ?? null,audioPlan:result.audioPlan ?? null};
}

export function candidateOutputIdentity(candidate,targetId,targetContentHash) {
  return {targetId,targetContentHash,agentInterpretation:candidate.agentInterpretation,impactSummary:candidate.impactSummary};
}

/** The revision projection also carries declarations extracted from that target's actual source. */
function revisionSafetyPolicy(revision,projectId,revisionId,targetId,context,policy) {
  if (!revision || !context.workspaceId || context.projectId!==projectId || revision.projectId!==projectId
    || revision.workspaceId!==context.workspaceId || (revision.revisionId!==undefined && revision.revisionId!==revisionId)
    || !Array.isArray(revision.targetIds) || !revision.targetIds.includes(targetId))
    throw Error('OUTPUT_SAFETY_SOURCE_RECORD_REQUIRED');
  return scopedSafetyCoveragePolicy(policy,{totalFrames:revision.totalFrames,
    runtimeDeclarations:own(revision.runtimeDeclarationsByTarget,targetId)});
}

/** Validate every target against controller-observed content and trusted moderation records. */
export function candidateSafetyErrors(candidate,context) {
  if (!candidate?.affectedTargetIds?.length) return ['CANDIDATE_TARGETS_REQUIRED'];
  return candidate.affectedTargetIds.flatMap(targetId=>{
    const check=own(context.candidateSafetyChecks,targetId);
    const targetContentHash=own(context.candidateContentHashes,targetId);
    if (!hash(targetContentHash)) return ['CANDIDATE_CONTENT_IDENTITY_REQUIRED'];
    if (!visibleText(candidate.agentInterpretation) || !visibleText(candidate.impactSummary)) return ['CANDIDATE_SUMMARY_REQUIRED'];
    const subjectHash=digest(candidateOutputIdentity(candidate,targetId,targetContentHash));
    if (!['trusted_media','verified_local_runtime'].includes(check?.options?.representation)) return ['CANDIDATE_SAFETY_REQUIRED'];
    let coveragePolicy;
    try {coveragePolicy=revisionSafetyPolicy(own(context.revisions,candidate.candidateRevisionId),candidate.projectId,
      candidate.candidateRevisionId,targetId,context,check.options.coveragePolicy);}
    catch (error) {return [error.message];}
    return outputSafetyErrors(check?.receipt,{
      projectId:candidate.projectId,operationId:context.operationId,revisionId:candidate.candidateRevisionId,
      subjectKind:'candidate',subjectHash,targetId
    },{...check.options,coveragePolicy,requiredCoverage:['text','visual','audio']});
  });
}

/** In-memory controller reference: a single call models one atomic transaction, not a live API. */
export class CandidateReference {
  constructor({workspaceId,projectId,currentRevisionId=null,candidates=[]}) {
    this.workspaceId=workspaceId;this.projectId=projectId;this.currentRevisionId=currentRevisionId;
    this.candidates=new Map();this.requests=new Map();
    for (const candidate of candidates) {
      if (validate(candidate,schema.$defs.candidateResult).length || candidate.projectId!==projectId)
        throw Error('CANDIDATE_INVALID');
      this.candidates.set(candidate.candidateRevisionId,structuredClone(candidate));
    }
  }
  authorize(context) {
    if (context.authorized!==true || !context.actorUserId || context.workspaceId!==this.workspaceId
      || context.projectId!==this.projectId) throw Error('FORBIDDEN');
  }
  decide(action,request,context) {
    this.authorize(context);
    if (!['accept','reject'].includes(action) || validate(request,schema.$defs.candidateActionRequest).length
      || request.projectId!==this.projectId) throw Error('CANDIDATE_REQUEST_INVALID');
    const key=canonical([context.actorUserId,request.requestId]),signature=digest({action,request});
    const prior=this.requests.get(key);
    if (prior) {
      if (prior.signature!==signature) throw Error('IDEMPOTENCY_CONFLICT');
      return structuredClone(prior.result);
    }
    const candidate=this.candidates.get(request.candidateRevisionId);
    const errors=studioErrors(request,{...context,currentRevisionId:this.currentRevisionId,
      candidate:candidate && {...candidate,workspaceId:this.workspaceId},candidateAction:action});
    if (errors.length) throw Error(errors.join(','));
    const result={...candidate,state:action==='accept'?'accepted':'rejected'};
    if (action==='accept') this.currentRevisionId=candidate.candidateRevisionId;
    this.candidates.set(candidate.candidateRevisionId,structuredClone(result));
    this.requests.set(key,{signature,result:structuredClone(result)});
    return result;
  }
  /** Run cancellation only cancels still-pending candidates; it never rolls back an accepted draft. */
  cancelRun(runId,context) {
    this.authorize(context);
    const changed=[];
    for (const [id,candidate] of this.candidates) if (candidate.runId===runId && ['ready','withheld'].includes(candidate.state)) {
      const next={...candidate,state:'cancelled',agentInterpretation:null,impactSummary:null};
      this.candidates.set(id,next);changed.push(structuredClone(next));
    }
    return changed;
  }
}

/** Context is a trusted projection of current records, source declarations and observations. */
export function studioErrors(v, context = {}, helpers = {}) {
  const errors = [], fail = (ok, code) => { if (!ok) errors.push(code); };
  if (!v || typeof v !== 'object') return errors;
  if (apiKinds.has(v.kind)) {
    if (context.production) fail(context.authorized === true && !!context.workspaceId && !!context.projectId, 'STUDIO_AUTHORIZATION_REQUIRED');
    if (v.projectId !== undefined && context.projectId) fail(v.projectId === context.projectId, 'STUDIO_PROJECT_MISMATCH');
    if (v.workspaceId && context.workspaceId) fail(v.workspaceId === context.workspaceId, 'STUDIO_WORKSPACE_MISMATCH');
  }
  if (v.kind === 'agent_request') {
    if (context.production || Object.hasOwn(context,'currentRevisionId'))
      fail(v.baseRevision === context.currentRevisionId, 'DRAFT_CONFLICT');
    if (v.baseRevision === null) fail(v.operation === 'creative_generate', 'EMPTY_BASE_REQUIRES_CREATION');
  }
  if (v.kind === 'edit_request') {
    if (context.production || Object.hasOwn(context,'currentRevisionId'))
      fail(v.baseRevision === context.currentRevisionId, 'DRAFT_CONFLICT');
    if (context.production || Object.hasOwn(context,'displayedRevisionId'))
      fail(v.baseRevision === context.displayedRevisionId && context.hasUnsavedValues === false, 'COMMENT_REQUIRES_SAVED_FRAME');
  }
  if (v.kind === 'candidate_action_request') {
    const candidate = context.candidate;
    fail(!!candidate && ['projectId','candidateRevisionId','baseRevision'].every(key => candidate[key] === v[key]), 'CANDIDATE_SCOPE_MISMATCH');
    if (candidate && context.workspaceId) fail(candidate.workspaceId === context.workspaceId, 'CANDIDATE_SCOPE_MISMATCH');
    fail(['accept','reject'].includes(context.candidateAction), 'CANDIDATE_ACTION_REQUIRED');
    if (context.candidateAction === 'accept') {
      fail(candidate?.state === 'ready', 'CANDIDATE_NOT_READY');
      fail(v.baseRevision === context.currentRevisionId, 'DRAFT_CONFLICT');
      const safetyErrors=candidateSafetyErrors(candidate,context);
      fail(safetyErrors.length===0, 'CANDIDATE_SAFETY_REQUIRED');errors.push(...safetyErrors);
    } else if (context.candidateAction === 'reject') fail(['ready','withheld'].includes(candidate?.state), 'CANDIDATE_NOT_PENDING');
  }
  if (v.kind === 'candidate_result') {
    if (v.baseRevision === null) fail(v.operation === 'creative_generate', 'EMPTY_BASE_REQUIRES_CREATION');
    if (context.production && ['ready','accepted'].includes(v.state)) {
      const safetyErrors=candidateSafetyErrors(v,context);
      fail(safetyErrors.length===0, 'CANDIDATE_SAFETY_REQUIRED');errors.push(...safetyErrors);
    }
    if (['ready','accepted'].includes(v.state)) for (const key of ['agentInterpretation','impactSummary'])
      fail(visibleText(v[key]), 'CANDIDATE_SUMMARY_REQUIRED');
  }
  if (v.kind === 'run_result') {
    const hasOutput=['directions','treatment','audioPlan'].some(key=>Object.hasOwn(v,key));
    fail(!hasOutput || v.outputStatus==='allowed', 'CREATIVE_OUTPUT_WITHHELD');
    fail(v.outputStatus!=='allowed' || hasOutput, 'CREATIVE_OUTPUT_REQUIRED');
    if (hasOutput && context.production) {
      const check=context.planSafetyCheck;
      errors.push(...outputSafetyErrors(check?.receipt,{
        projectId:context.projectId,operationId:v.operationId,revisionId:v.baseRevision,
        subjectKind:'creative_plan',subjectHash:digest(creativePlanIdentity(v)),targetId:null
      },{...check?.options,representation:'text',requiredCoverage:['text']}));
    }
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
          fail(visibleText(change.value), 'EMPTY_FACT');
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
    try { checkedFactValueUpdates(v.changes,context); } catch (error) { errors.push(error.message); }
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
      fail(v.operation === 'media_processing' && v.result?.kind === 'asset', 'JOB_RESULT_REQUIRED');
    } else fail(v.result === null, 'JOB_RESULT_NOT_READY');
    fail(v.state === 'failed' ? typeof v.errorCode === 'string' : v.errorCode === null, 'JOB_ERROR_STATE_INVALID');
    if (v.canRetry) fail(v.state === 'failed', 'JOB_RETRY_STATE_INVALID');
    if (v.retryAfterMs !== null) fail(v.canRetry, 'JOB_RETRY_DELAY_INVALID');
  }
  if (v.kind === 'preview_session_request' || v.kind === 'preview_session_result') {
    const revision = own(context.revisions,v.revisionId);
    fail(!!revision && revision.projectId === v.projectId && revision.workspaceId === context.workspaceId, 'PREVIEW_SOURCE_UNAVAILABLE');
    if (revision) fail(revision.targetIds?.includes(v.targetId), 'PREVIEW_TARGET_UNAVAILABLE');
    if (context.production) {
      fail(context.localPreviewAllowed === true, 'LOCAL_PREVIEW_ACCESS_REQUIRED');
      const check=context.previewSafetyCheck;
      let safetyErrors;
      try {
        const coveragePolicy=revisionSafetyPolicy(revision,v.projectId,v.revisionId,v.targetId,context,check?.options?.coveragePolicy);
        safetyErrors=outputSafetyErrors(check?.receipt,{
          projectId:v.projectId,operationId:context.operationId ?? null,revisionId:v.revisionId,
          subjectKind:'preview',subjectHash:revision?.manifestHash,targetId:v.targetId
        },{...check?.options,coveragePolicy,representation:'verified_local_runtime',requiredCoverage:['text','visual','audio']});
      } catch (error) {safetyErrors=[error.message];}
      fail(safetyErrors.length===0, 'LOCAL_PREVIEW_SAFETY_REQUIRED');errors.push(...safetyErrors);
    }
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
      fail((v.mixedAudioHash === null) === (v.mixedAudioUrl === null), 'PREVIEW_AUDIO_URL_REQUIRED');
      if (v.mixedAudioUrl !== null) {
        try {
          const url = new URL(v.mixedAudioUrl);
          fail(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'PREVIEW_AUDIO_URL_UNTRUSTED');
          if (context.production || context.audioGrants) fail(context.audioGrants?.[v.mixedAudioHash] === v.mixedAudioUrl, 'PREVIEW_AUDIO_GRANT_REQUIRED');
        } catch { errors.push('PREVIEW_AUDIO_URL_UNTRUSTED'); }
      }
      const [,aspect] = (v.targetId ?? '').split(':');
      const layout = helpers.presets?.aspectLayouts?.[aspect];
      if (layout) fail(v.width === layout.width && v.height === layout.height, 'PREVIEW_LOGICAL_SIZE_MISMATCH');
      else if (context.production) fail(false, 'PREVIEW_PLATFORM_RULES_REQUIRED');
    }
  }
  if (['init','set-values','seek','inspect','sample'].includes(v.command))
    fail(context.commandInFlight !== true, 'COMMAND_IN_PROGRESS');
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
    fail(Number.isSafeInteger(context.previewEpoch) && v.requestedEpoch === context.previewEpoch + 1, 'PREVIEW_EPOCH_INVALID');
    fail(Number.isSafeInteger(context.lastSequence) && v.sequence > context.lastSequence, 'PREVIEW_SEQUENCE_INVALID');
    try { localPreviewValues(v.valuesOverlay,context); } catch (error) { errors.push(error.message); }
  }
  if (['values-applied','values-rejected'].includes(v.event)) {
    const command = context.valuesCommand, session = context.previewSession;
    fail(!!session && ['sessionId','revisionId','targetId','manifestHash'].every(key => v[key] === session[key])
      && context.disposed !== true && context.rendererSession !== true, 'LOCAL_VALUES_SESSION_REQUIRED');
    fail(command?.command === 'set-values'
      && ['protocolVersion','sessionId','requestId','sequence','revisionId','targetId','manifestHash','requestedEpoch']
        .every(key => command[key] === v[key]), 'VALUES_ACK_ENVELOPE_MISMATCH');
    if (v.event === 'values-applied') fail(v.appliedEpoch === v.requestedEpoch
      && Number.isSafeInteger(context.previewEpoch) && v.requestedEpoch === context.previewEpoch + 1, 'VALUES_ACK_EPOCH_INVALID');
    else fail(Number.isSafeInteger(context.previewEpoch) && v.appliedEpoch === context.previewEpoch, 'VALUES_REJECTION_CHANGED_EPOCH');
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
    fail(v.previewEpoch === undefined && v.requestedEpoch === undefined && v.appliedEpoch === undefined
      && v.valuesOverlay === undefined && v.command !== 'set-values', 'TRUSTED_RENDER_OVERLAY_FORBIDDEN');
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
      if (command?.x01 === 1 || command?.y01 === 1) fail(v.hit === null, 'INSPECT_BOUNDARY_HAS_NO_HIT');
      const width = context.previewSession?.width ?? context.width, height = context.previewSession?.height ?? context.height;
      if (command && Number.isFinite(width) && Number.isFinite(height)) {
        const x = command.x01 * width, y = command.y01 * height;
        const order = context.regionOrder ?? Object.keys(context.regions ?? {});
        const expected = command.x01 === 1 || command.y01 === 1 ? null : [...order].reverse().find(id => {
          const bounds = own(context.regionBounds,id);
          return bounds && x >= bounds.x && x < bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height;
        }) ?? null;
        fail((v.hit?.regionId ?? null) === expected, 'INSPECT_HIT_PRIORITY_MISMATCH');
      }
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
    try { sourceValuesBytes(v.values); } catch (error) { errors.push(error.message); }
    const definitions = context.editables;
    fail(!!definitions, 'EDITABLE_DECLARATIONS_REQUIRED');
    if (definitions) {
      fail(Object.keys(definitions).length === Object.keys(v.values ?? {}).length, 'EDITABLE_VALUES_INCOMPLETE');
      for (const [id,value] of Object.entries(v.values ?? {})) {
        const definition = own(definitions,id);
        errors.push(...valueErrors(value,definition,context));
        if (definition?.type === 'color' && typeof value === 'string') fail(value === value.toLowerCase(), 'EDITABLE_COLOR_NOT_CANONICAL');
      }
      for (const id of Object.keys(definitions)) fail(Object.hasOwn(v.values ?? {},id), 'EDITABLE_VALUE_MISSING');
      if (context.requireFactBindings) for (const definition of Object.values(definitions)) if (definition.factId) {
        const fact = own(context.facts,definition.factId);
        fail(definition.type === 'text' && !!fact && v.values?.[definition.id] === fact.text, 'EDITABLE_FACT_VALUE_MISMATCH');
      }
    }
  }
  if (v.kind === 'runtime_declarations') {
    if (context.sharedEditables) fail(canonical(v.editables) === canonical(context.sharedEditables), 'TARGET_EDITABLE_DECLARATIONS_MISMATCH');
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
      if (marker.audioEventId !== undefined) {
        const event = (context.audioEvents ?? context.composition?.audioEvents)?.find(item => item.eventId === marker.audioEventId);
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
      if (context.production || resource) fail(!!resource && resource.mediaType?.startsWith('video/') && drawable(use.assetPath,context), 'VIDEO_RESOURCE_UNAVAILABLE');
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
