// Trusted-controller contract checks; this module does not perform content moderation.
import { readFileSync } from 'node:fs';
import { createSchemaValidator, digest, parseCanonicalJson } from '../packages/contracts/index.mjs';
const schema=parseCanonicalJson(readFileSync(new URL('../contracts/production.schema.json',import.meta.url)));
const validate=createSchemaValidator(schema);

/** receipt must come from trusted storage. A client quality waiver is never an input. */
export function outputSafetyErrors(receipt,subject,{policyVersion,representation,requiredCoverage,nowMs,
  revokedResultIds,coverageManifest,coveragePolicy,association}={}) {
  if (!receipt) return ['OUTPUT_SAFETY_REQUIRED'];
  if (receipt.exampleOnly === true) return ['OUTPUT_SAFETY_EXAMPLE_EVIDENCE_FORBIDDEN'];
  if (validate(receipt,schema.$defs.outputSafetyResult).length) return ['OUTPUT_SAFETY_INVALID'];
  const errors=[];
  const identity=['projectId','subjectKind','subjectHash','targetId'];
  const sameUse=subject && ['operationId','revisionId'].every(key=>receipt[key]===subject[key]);
  const associated=subject && association?.resultId===receipt.resultId
    && [...identity,'operationId','revisionId'].every(key=>association[key]===subject[key]);
  if (!subject || identity.some(key => receipt[key] !== subject[key]) || (!sameUse && !associated))
    errors.push('OUTPUT_SAFETY_SCOPE_MISMATCH');
  if (!policyVersion || receipt.policyVersion !== policyVersion) errors.push('OUTPUT_SAFETY_POLICY_CHANGED');
  if (!representation || receipt.representation !== representation) errors.push('OUTPUT_SAFETY_REPRESENTATION_MISMATCH');
  if (!Array.isArray(requiredCoverage) || requiredCoverage.length === 0 || requiredCoverage.some(kind => !receipt.coverage.includes(kind)))
    errors.push('OUTPUT_SAFETY_COVERAGE_INCOMPLETE');
  if (receipt.status !== 'allowed') errors.push('OUTPUT_SAFETY_'+receipt.status.toUpperCase());
  if (!receipt.evidenceRefs.length) errors.push('OUTPUT_SAFETY_EVIDENCE_REQUIRED');
  if (!Number.isSafeInteger(nowMs) || Date.parse(receipt.checkedAt) > nowMs) errors.push('OUTPUT_SAFETY_TIME_INVALID');
  if (!Array.isArray(revokedResultIds) || revokedResultIds.some(id=>typeof id!=='string')) errors.push('OUTPUT_SAFETY_REVOCATION_STATE_REQUIRED');
  else if (revokedResultIds.includes(receipt.resultId)) errors.push('OUTPUT_SAFETY_REVOKED');
  if (!coverageManifest || validate(coverageManifest,schema.$defs.outputSafetyCoverageManifest).length) {
    errors.push('OUTPUT_SAFETY_COVERAGE_MANIFEST_REQUIRED');
    return errors;
  }
  const manifest=coverageManifest;
  if (digest(manifest)!==receipt.coverageManifestHash
    || ['subjectHash','targetId','representation'].some(key=>manifest[key]!==receipt[key]))
    errors.push('OUTPUT_SAFETY_COVERAGE_MANIFEST_MISMATCH');
  if (!coveragePolicy?.version || manifest.samplingPolicyVersion!==coveragePolicy.version)
    errors.push('OUTPUT_SAFETY_SAMPLING_POLICY_REQUIRED');
  // The controller resolves this observation from its trusted inspection store. Source declarations
  // and request flags are not observations. Its digest is part of the reviewed immutable manifest.
  const observation=coveragePolicy?.modalityObservation;
  if (!observation || validate(observation,schema.$defs.outputSafetyModalityObservation).length) {
    errors.push('OUTPUT_SAFETY_MODALITY_OBSERVATION_REQUIRED');
    return errors;
  }
  if (digest(observation)!==manifest.modalityObservationHash
    || ['subjectHash','targetId','representation'].some(key=>observation[key]!==manifest[key]))
    errors.push('OUTPUT_SAFETY_MODALITY_OBSERVATION_MISMATCH');
  if (observation.textPresent ? requiredCoverage?.includes('text') && !manifest.textHashes.length : manifest.textHashes.length>0)
    errors.push('OUTPUT_SAFETY_TEXT_COVERAGE_INCOMPLETE');
  if (!observation.audioPresent && manifest.audioSegments.length) errors.push('OUTPUT_SAFETY_AUDIO_PRESENCE_MISMATCH');
  const indices=manifest.frames.map(frame=>frame.frameIndex);
  if (new Set(indices).size!==indices.length || indices.some((frame,i)=>frame>=manifest.frameCount || (i>0 && frame<=indices[i-1])))
    errors.push('OUTPUT_SAFETY_FRAME_COVERAGE_INVALID');
  if (representation==='text') {
    if (manifest.targetId!==null || manifest.frameCount!==null || indices.length || manifest.durationMs!==null
      || manifest.audioSegments.length || manifest.runtimeStateHash!==null || !observation.textPresent || observation.audioPresent)
      errors.push('OUTPUT_SAFETY_TEXT_SCOPE_INVALID');
  } else if (representation==='verified_local_runtime') {
    if (!coveragePolicy?.runtimeStateHash || manifest.runtimeStateHash!==coveragePolicy.runtimeStateHash)
      errors.push('OUTPUT_SAFETY_RUNTIME_COVERAGE_REQUIRED');
  } else if (representation==='trusted_media') {
    if (!manifest.targetId || manifest.frameCount===null || manifest.runtimeStateHash!==null)
      errors.push('OUTPUT_SAFETY_MEDIA_SCOPE_INVALID');
    if (manifest.frameCount!==coveragePolicy?.frameCount || manifest.durationMs!==coveragePolicy?.durationMs)
      errors.push('OUTPUT_SAFETY_MEDIA_LENGTH_MISMATCH');
    const required=coveragePolicy?.requiredFrameIndices;
    if (requiredCoverage?.includes('visual') && (!Array.isArray(required) || !required.length
      || required.some(frame=>!Number.isSafeInteger(frame) || frame<0 || !indices.includes(frame))))
      errors.push('OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE');
  }
  if (requiredCoverage?.includes('audio') && observation.audioPresent) {
    let end=0;
    for (const segment of manifest.audioSegments) {
      if (segment.startMs!==end || segment.endMs<=segment.startMs) errors.push('OUTPUT_SAFETY_AUDIO_COVERAGE_INCOMPLETE');
      end=segment.endMs;
    }
    if (manifest.durationMs===null || end!==manifest.durationMs) errors.push('OUTPUT_SAFETY_AUDIO_COVERAGE_INCOMPLETE');
  }
  return errors;
}
