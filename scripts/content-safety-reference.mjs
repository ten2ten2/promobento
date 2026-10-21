// Reference adapter only. It injects an authenticated scanner; no SDK, endpoint or credential is installed.
import { readFileSync } from 'node:fs';
import { canonical, digest, parseCanonicalJson } from '../packages/contracts/index.mjs';
export const contentSafetyConfig = parseCanonicalJson(readFileSync(new URL('../config/content-safety.json',import.meta.url)));
const token = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value);
const reasons = new Set(['allowed','review_required','restricted_content','service_degraded']);
const statuses = new Set(['disabled','scored','shadow_scored','provider_error']);
const withheld = (status,reasonCode,fields = {}) => ({status,providerAllowsGeneration:false,reasonCode,receipt:null,nextRetry:null,...fields});

/** Used when the trusted orchestrator selects this provider for a generation.
 * Pass the exact customer text used by the model, including relevant extracted text in facts.
 * Keep each section and its order; do not trim, summarize, normalize or silently drop overflow.
 */
export function generationScanInput({operationId,operationKind,generationId,instruction = '',task = '',facts = [],transcript = [],comments = [],editableTexts = [],locale},config = contentSafetyConfig) {
  if (typeof instruction !== 'string' || typeof task !== 'string'
    || ![facts,transcript,comments,editableTexts].every(items => Array.isArray(items) && items.every(item => typeof item === 'string'))
    || ![instruction,task,...facts,...transcript,...comments,...editableTexts].some(text => text.trim()))
    throw new Error('INVALID_SCAN_TEXT_PARTS');
  const parts={task,instruction,facts,transcript,comments,editableTexts};
  const input={operationId,operationKind,generationId,prompt:canonical(parts)};
  if (locale !== undefined) input.locale=locale;
  const problem=inputError(input,config);
  if (problem) {
    const error=new Error(problem);
    error.statusCode=422;
    if (problem === 'PROMPT_TOO_LONG') error.details={
      totalCodePoints:[...input.prompt].length,maxCodePoints:config.maxPromptCharacters,
      sections:Object.fromEntries(Object.entries(parts).map(([key,value]) => [key,[...canonical(value)].length]))
    };
    throw error;
  }
  return input;
}

/** Call before quota reservation, then use the same trusted text snapshot for the model call. */
export function generationScanInputForRequest({request,operationId,generationId,task = '',facts = [],transcript = [],editableTexts = [],locale},config = contentSafetyConfig) {
  const edit=request?.kind === 'edit_request';
  const operationKind=edit ? 'agent_patch' : request?.operation;
  if (!edit && request?.kind !== 'agent_request') throw Error('INVALID_GENERATION_OPERATION');
  const comments=edit ? request.comments?.map(comment => comment.comment) : [];
  if (!Array.isArray(comments)) throw Error('INVALID_SCAN_TEXT_PARTS');
  return generationScanInput({operationId,operationKind,generationId,task,
    instruction:edit ? '' : request.instruction ?? '',facts,transcript,comments,editableTexts,locale},config);
}

function inputError(input,config) {
  if (!input || !config.appliesTo.includes(input.operationKind) || !token(input.operationId) || !token(input.generationId)) return 'INVALID_GENERATION_OPERATION';
  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) return 'EMPTY_PROMPT';
  // Local code-point counting only: Waffo documents "characters", not an encoding-specific unit.
  // A provider 400 still needs corrected input; the adapter must never truncate and retry silently.
  if ([...input.prompt].length > config.maxPromptCharacters) return 'PROMPT_TOO_LONG';
  if (input.locale !== undefined && !config.locales.includes(input.locale)) return 'INVALID_SCAN_LOCALE';
  try { promptIdentity(input,config); } catch { return 'INVALID_PROMPT_ENCODING'; }
  return null;
}

/** Exact text, operation and generation bind the verdict; never normalize or reuse another call. */
export function promptIdentity(input,config = contentSafetyConfig) {
  return digest({policyVersion:config.policyVersion,operationKind:input.operationKind,operationId:input.operationId,generationId:input.generationId,
    prompt:input.prompt,locale:input.locale ?? null,semantic:'enforce'});
}

function retryAfterMs(value,nowMs) {
  if (typeof value === 'number') value=String(value);
  if (typeof value !== 'string') return null;
  if (/^\d+$/u.test(value)) {
    const delay=Number(value)*1000;
    return Number.isSafeInteger(delay) && delay >= 0 && Number.isSafeInteger(nowMs+delay) ? delay : null;
  }
  if (!/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/u.test(value)) return null;
  const time=Date.parse(value);
  return Number.isFinite(time) ? Math.max(0,time-nowMs) : null;
}

/** One initial attempt plus at most three 5xx/transport retries. It schedules; it never waits/retries. */
export function nextScanRetry({status,retryAfter,retryCount = 0,nowMs},config = contentSafetyConfig) {
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(retryCount) || retryCount < 0) return null;
  if (status === 429) {
    const delayMs=retryAfterMs(retryAfter,nowMs);
    return delayMs === null ? null : {reason:'rate_limited',delayMs,notBefore:nowMs+delayMs,retryCount};
  }
  if ((status >= 500 && status <= 599) && retryCount < config.retry.maxServerErrorRetries) {
    const delayMs=config.retry.serverErrorInitialDelayMs * 2 ** retryCount;
    return {reason:'provider_unavailable',delayMs,notBefore:nowMs+delayMs,retryCount:retryCount+1};
  }
  return null;
}

function validVerdict(verdict) {
  return verdict && typeof verdict === 'object' && !Array.isArray(verdict)
    && ['allow','review','block'].includes(verdict.action) && reasons.has(verdict.reasonCode)
    && token(verdict.requestId) && typeof verdict.semanticStatus === 'string'
    && Array.isArray(verdict.matchedCategories) && verdict.matchedCategories.length <= 64
    && verdict.matchedCategories.every(token)
    && (verdict.action !== 'allow' || (verdict.reasonCode === 'allowed' && verdict.matchedCategories.length === 0));
}

/** This is one provider's verdict, not overall authorization to generate or display content.
 * Config and scanner are operator dependencies, never fields from the user's request.
 */
export async function scanGenerationPrompt(input,{config = contentSafetyConfig,scanner,retryCount = 0,now = Date.now} = {}) {
  if (config.enabled === false) return withheld('provider_disabled','PROVIDER_DISABLED',{scanAttempted:false});
  if (config.enabled !== true || config.semantic !== 'enforce' || config.operatorControl !== 'server_only'
    || config.allowRequiresSemanticStatus !== 'scored'
    || !Number.isSafeInteger(config.maxPromptCharacters) || config.maxPromptCharacters < 1 || config.maxPromptCharacters > 10000
    || !Array.isArray(config.appliesTo) || !Array.isArray(config.locales))
    return withheld('unavailable','INVALID_SCAN_CONFIGURATION',{scanAttempted:false});
  const problem=inputError(input,config);
  if (problem) return withheld('invalid_input',problem,{scanAttempted:false});
  if (typeof scanner !== 'function') return withheld('unavailable','SCANNER_NOT_CONFIGURED',{scanAttempted:false});
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0 || typeof now !== 'function'
    || !Number.isSafeInteger(now()) || !Number.isSafeInteger(retryCount) || retryCount < 0)
    return withheld('unavailable','INVALID_SCAN_CONFIGURATION',{scanAttempted:false});
  const inputFingerprint=promptIdentity(input,config);
  const body={prompt:input.prompt,semantic:'enforce'};
  if (input.locale !== undefined) body.locale=input.locale;
  const controller=new AbortController();
  let timer;
  try {
    const timeout=new Promise((_,reject) => {
      timer=setTimeout(() => { controller.abort(); const error=new Error('SCAN_TIMEOUT'); error.name='TimeoutError'; reject(error); },config.timeoutMs);
    });
    // The production adapter must propagate signal into its SDK/transport and unwrap HTTP data once.
    const verdict=await Promise.race([Promise.resolve().then(() => scanner(body,{signal:controller.signal})),timeout]);
    if (!validVerdict(verdict)) return withheld('unavailable','INVALID_SCAN_VERDICT',{scanAttempted:true,inputFingerprint});
    const receipt={policyVersion:config.policyVersion,inputFingerprint,requestId:verdict.requestId,
      decision:verdict.action,reasonCode:verdict.reasonCode,semanticStatus:statuses.has(verdict.semanticStatus) ? verdict.semanticStatus : 'unknown'};
    if (verdict.action === 'allow' && verdict.semanticStatus !== config.allowRequiresSemanticStatus)
      return withheld('unavailable','SEMANTIC_ENFORCEMENT_NOT_CONFIRMED',{scanAttempted:true,inputFingerprint});
    if (verdict.action === 'allow') return {status:'allowed',scanAttempted:true,providerAllowsGeneration:true,receipt,nextRetry:null};
    if (verdict.action === 'block') return withheld('blocked',verdict.reasonCode,{scanAttempted:true,receipt});
    if (verdict.reasonCode === 'service_degraded') {
      const nextRetry=nextScanRetry({status:503,retryCount,nowMs:now()},config);
      return withheld(nextRetry ? 'retry_wait' : 'review_required',verdict.reasonCode,{scanAttempted:true,receipt,nextRetry});
    }
    return withheld('review_required',verdict.reasonCode,{scanAttempted:true,receipt});
  } catch (error) {
    const timeout=error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const status=Number.isInteger(error?.status) ? error.status : Number.isInteger(error?.statusCode) ? error.statusCode : 503;
    const retryAfter=error?.retryAfter ?? error?.headers?.get?.('Retry-After') ?? error?.headers?.['retry-after'];
    const nextRetry=nextScanRetry({status:timeout ? 503 : status,retryAfter,retryCount,nowMs:now()},config);
    const reasonCode=timeout ? 'SCAN_TIMEOUT' : status === 429 ? 'SCAN_RATE_LIMITED'
      : status >= 400 && status < 500 ? 'SCAN_REQUEST_REJECTED' : 'SCAN_UNAVAILABLE';
    // Never copy error.message, response bodies or the request prompt into the result/audit receipt.
    return withheld(nextRetry ? 'retry_wait' : 'unavailable',reasonCode,{scanAttempted:true,inputFingerprint,nextRetry});
  } finally {
    clearTimeout(timer);
  }
}

/** Use a receipt from trusted server storage at dispatch, never a caller-supplied receipt.
 * Matching verifies the scan input only; it does not grant current permissions, entitlements or budget.
 */
export function scanReceiptMatches(receipt,input,config = contentSafetyConfig) {
  if (config.enabled !== true || config.semantic !== 'enforce' || config.allowRequiresSemanticStatus !== 'scored'
    || config.operatorControl !== 'server_only' || inputError(input,config)) return false;
  return !!receipt && receipt.decision === 'allow' && receipt.reasonCode === 'allowed'
    && receipt.semanticStatus === config.allowRequiresSemanticStatus && token(receipt.requestId)
    && receipt.policyVersion === config.policyVersion && receipt.inputFingerprint === promptIdentity(input,config);
}
