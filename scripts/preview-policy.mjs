// Reference admission rules. The scheduler must check and reserve atomically; this is not a quota store.
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '../packages/contracts/index.mjs';

export const previewPolicy = parseCanonicalJson(readFileSync(new URL('../config/preview.json',import.meta.url)));
const positive = value => Number.isSafeInteger(value) && value > 0;
const counter = value => Number.isSafeInteger(value) && value >= 0;

/** All context comes from current server records, never from the request body. */
export function trustedPreviewErrors(request, context = {}) {
  const errors = [], fail = (ok,code) => { if (!ok) errors.push(code); };
  const policy = context.policy ?? previewPolicy;
  const limits = policy.trustedCapture?.limits ?? {};
  const composition = context.composition;
  fail(context.authorized === true, 'PREVIEW_AUTHORIZATION_REQUIRED');
  fail(policy.trustedCapture?.enabled === true && context.executionEnabled === true, 'TRUSTED_PREVIEW_DISABLED');
  fail(context.budgetAvailable === true, 'PREVIEW_BUDGET_REQUIRED');
  fail(context.previewEntitled === true && typeof context.isTrial === 'boolean', 'PREVIEW_ENTITLEMENT_REQUIRED');
  if (!request || !['screenshot','clip'].includes(request.mediaKind)) return [...errors,'PREVIEW_MEDIA_KIND_INVALID'];
  fail(!!composition && request.revisionId === composition.revisionId
    && Array.isArray(composition.variants)
    && composition.variants.some(variant => variant.targetId === request.targetId), 'PREVIEW_SOURCE_MISMATCH');
  const totalFrames = composition?.totalFrames;
  const start = request.frameStart, end = request.frameEndExclusive;
  const clip = request.mediaKind === 'clip';
  const validRange = [450,900].includes(totalFrames) && counter(start) && start < totalFrames
    && (clip ? positive(end) && end > start && end <= totalFrames : end === undefined);
  fail(validRange, 'PREVIEW_FRAME_RANGE_INVALID');
  const frames = clip && validRange ? end - start : 0;
  const requiredLimits = ['maxRequestsPerProjectWindow'];
  if (clip) requiredLimits.push('maxClipFrames','maxClipFramesPerProjectWindow');
  if (context.isTrial) requiredLimits.push('maxRequestsPerTrial',...(clip ? ['maxClipFramesPerTrial'] : []));
  if (requiredLimits.some(key => !positive(limits[key]))) return [...errors,'PREVIEW_LIMITS_UNMEASURED'];
  if (clip && validRange) fail(frames <= limits.maxClipFrames, 'PREVIEW_CLIP_TOO_LONG');
  for (const [scope,requestLimit,frameLimit] of [
    ['project','maxRequestsPerProjectWindow','maxClipFramesPerProjectWindow'],
    ...(context.isTrial ? [['trial','maxRequestsPerTrial','maxClipFramesPerTrial']] : [])
  ]) {
    const usage = context.usage?.[scope];
    if (!usage || !counter(usage.requests) || !counter(usage.clipFrames)) {
      errors.push('PREVIEW_USAGE_REQUIRED');
      continue;
    }
    fail(usage.requests < limits[requestLimit], 'PREVIEW_'+scope.toUpperCase()+'_REQUEST_LIMIT');
    if (clip && validRange) fail(frames <= limits[frameLimit] - usage.clipFrames, 'PREVIEW_'+scope.toUpperCase()+'_FRAME_LIMIT');
  }
  return [...new Set(errors)];
}
