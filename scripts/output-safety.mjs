// Trusted-controller contract checks; this module does not perform content moderation.
import { readFileSync } from 'node:fs';
import { createSchemaValidator, digest, parseCanonicalJson } from '../packages/contracts/index.mjs';
const schema=parseCanonicalJson(readFileSync(new URL('../contracts/production.schema.json',import.meta.url)));
const validate=createSchemaValidator(schema);
const sampling=parseCanonicalJson(readFileSync(new URL('../config/output-safety-sampling.json',import.meta.url)));
const limits=Object.freeze(sampling.limits);
const policies=Object.freeze(Object.fromEntries(Object.entries(sampling.policies).map(([version,policy])=>[version,Object.freeze(policy)])));
if (Object.values(policies).some(policy=>policy.framesPerSecond!==30 || !Number.isSafeInteger(policy.maxFrameGap)
  || policy.maxFrameGap<1 || policy.maxFrameGap>900)) throw Error('OUTPUT_SAFETY_SAMPLING_CONFIG_INVALID');
const rangeKeys=['kind','sourceFrameCount','frameStart','frameEndExclusive'];
const sameRange=(a,b)=>!!a && !!b && rangeKeys.every(key=>a[key]===b[key]);

/** Bound work before canonicalization, hashing and Ajv's uniqueItems traversal. */
function boundedRecord(value) {
  let nodes=0,bytes=0;
  const visit=(item,depth)=>{
    if (++nodes>limits.maxRecordNodes || depth>8 || bytes>limits.maxRecordBytes) return false;
    if (typeof item==='string') {
      if (item.length>limits.maxStringCodeUnits) return false;
      bytes+=Buffer.byteLength(item,'utf8')+2;
      return bytes<=limits.maxRecordBytes;
    }
    if (item===undefined || item===null || typeof item==='boolean' || typeof item==='number') {bytes+=24;return true;}
    if (!item || typeof item!=='object') return false;
    if (Array.isArray(item)) {
      if (item.length>Math.max(limits.maxFrames,limits.maxTextHashes,limits.maxAudioSegments,limits.maxEvidenceRefs)) return false;
      for (let i=0;i<item.length;i++) {
        const descriptor=Object.getOwnPropertyDescriptor(item,i);
        if (!descriptor || !Object.hasOwn(descriptor,'value') || !visit(descriptor.value,depth+1)) return false;
      }
      return true;
    }
    if (![Object.prototype,null].includes(Object.getPrototypeOf(item))) return false;
    let properties=0;
    for (const key in item) {
      if (!Object.hasOwn(item,key) || ++properties>limits.maxObjectProperties || key.length>limits.maxStringCodeUnits) return false;
      const descriptor=Object.getOwnPropertyDescriptor(item,key);
      bytes+=Buffer.byteLength(key,'utf8')+3;
      if (!descriptor || !Object.hasOwn(descriptor,'value') || !visit(descriptor.value,depth+1)) return false;
    }
    return bytes<=limits.maxRecordBytes;
  };
  return visit(value,0);
}

function inputWithinLimits(receipt,manifest,policy,requiredCoverage,association) {
  for (const [value,max] of [[receipt?.evidenceRefs,limits.maxEvidenceRefs],[receipt?.coverage,3],
    [manifest?.textHashes,limits.maxTextHashes],[manifest?.frames,limits.maxFrames],
    [manifest?.audioSegments,limits.maxAudioSegments],[policy?.markerFrameIndices,limits.maxFrames],
    [policy?.requiredFrameIndices,limits.maxFrames],[requiredCoverage,3]])
    if (Array.isArray(value) && value.length>max) return false;
  return [receipt,manifest,policy,association].filter(value=>value!==undefined && value!==null).every(boundedRecord);
}

/** Source records and declarations are loaded by the controller, independently of the receipt. */
export function scopedSafetyCoveragePolicy(policy,{totalFrames,runtimeDeclarations,kind='video',frameStart=0,frameEndExclusive=totalFrames}={}) {
  if (![450,900].includes(totalFrames)) throw Error('OUTPUT_SAFETY_SOURCE_LENGTH_INVALID');
  const markers=runtimeDeclarations?.markers;
  if (runtimeDeclarations?.schemaVersion!=='3.0.0' || runtimeDeclarations?.kind!=='runtime_declarations'
    || !Array.isArray(markers) || markers.length>limits.maxFrames)
    throw Error('OUTPUT_SAFETY_SOURCE_DECLARATIONS_REQUIRED');
  if (markers.some(marker=>!Number.isSafeInteger(marker?.frame) || marker.frame<0 || marker.frame>=totalFrames))
    throw Error('OUTPUT_SAFETY_SAMPLING_INPUT_INVALID');
  // Several semantic markers may share a frame; that frame is inspected once.
  const markerFrameIndices=[...new Set(markers.map(marker=>marker.frame))].sort((a,b)=>a-b);
  const derived={...policy,sourceRange:{kind,sourceFrameCount:totalFrames,frameStart,frameEndExclusive},markerFrameIndices};
  const expected=expectedSafetyCoverage(derived,'trusted_media');
  return {...derived,frameCount:expected.frameCount,durationMs:expected.durationMs};
}

/** Minimum coverage only, not a guarantee that sampled frames reveal every unsafe change. */
export function expectedSafetyCoverage(policy,representation) {
  if (policy && !boundedRecord(policy)) throw Error('OUTPUT_SAFETY_INPUT_TOO_LARGE');
  const registered=policy && Object.hasOwn(policies,policy.version) && policies[policy.version];
  if (!registered) throw Error('OUTPUT_SAFETY_SAMPLING_POLICY_REQUIRED');
  if (representation==='text') return {sourceRange:null,frameCount:null,durationMs:null,requiredFrameIndices:[]};
  if (!['verified_local_runtime','trusted_media'].includes(representation)) throw Error('OUTPUT_SAFETY_REPRESENTATION_MISMATCH');
  const range=policy.sourceRange;
  if (!range || validate(range,schema.$defs.outputSafetySourceRange).length
    || range.frameEndExclusive>range.sourceFrameCount || range.frameStart>=range.frameEndExclusive
    || (range.kind==='image' && range.frameEndExclusive-range.frameStart!==1)
    || (representation==='verified_local_runtime' && (range.kind!=='video' || range.frameStart!==0 || range.frameEndExclusive!==range.sourceFrameCount)))
    throw Error('OUTPUT_SAFETY_SOURCE_RANGE_INVALID');
  const frameCount=range.frameEndExclusive-range.frameStart;
  const durationMs=range.kind==='image' ? null : Math.ceil(frameCount*1000/registered.framesPerSecond);
  const markers=policy.markerFrameIndices,extra=policy.requiredFrameIndices ?? [];
  const validIndices=(values,max)=>Array.isArray(values) && values.length<=limits.maxFrames
    && new Set(values).size===values.length && values.every(value=>Number.isSafeInteger(value) && value>=0 && value<max);
  if (!validIndices(markers,range.sourceFrameCount) || !validIndices(extra,frameCount))
    throw Error('OUTPUT_SAFETY_SAMPLING_INPUT_INVALID');
  const required=new Set([0,frameCount-1,...extra]);
  for (let frame=0;frame<frameCount;frame+=registered.maxFrameGap) required.add(frame);
  for (const frame of markers) if (frame>=range.frameStart && frame<range.frameEndExclusive) required.add(frame-range.frameStart);
  return {sourceRange:range,frameCount,durationMs,requiredFrameIndices:[...required].sort((a,b)=>a-b)};
}

/** receipt must come from trusted storage. A client quality waiver is never an input. */
export function outputSafetyErrors(receipt,subject,{policyVersion,representation,requiredCoverage,nowMs,
  revokedResultIds,coverageManifest,coveragePolicy,association}={}) {
  if (!receipt) return ['OUTPUT_SAFETY_REQUIRED'];
  if (!inputWithinLimits(receipt,coverageManifest,coveragePolicy,requiredCoverage,association)) return ['OUTPUT_SAFETY_INPUT_TOO_LARGE'];
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
  if (!coveragePolicy?.version || !Object.hasOwn(policies,coveragePolicy.version) || manifest.samplingPolicyVersion!==coveragePolicy.version)
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
      || manifest.sourceRange!==null || manifest.audioSegments.length || manifest.runtimeStateHash!==null || !observation.textPresent || observation.audioPresent)
      errors.push('OUTPUT_SAFETY_TEXT_SCOPE_INVALID');
  } else if (['verified_local_runtime','trusted_media'].includes(representation)) {
    if (!manifest.targetId || manifest.frameCount===null || (representation==='trusted_media' && manifest.runtimeStateHash!==null))
      errors.push('OUTPUT_SAFETY_MEDIA_SCOPE_INVALID');
    if (representation==='verified_local_runtime' && (!coveragePolicy?.runtimeStateHash || manifest.runtimeStateHash!==coveragePolicy.runtimeStateHash))
      errors.push('OUTPUT_SAFETY_RUNTIME_COVERAGE_REQUIRED');
    try {
      const expected=expectedSafetyCoverage(coveragePolicy,representation);
      if (!sameRange(manifest.sourceRange,expected.sourceRange)) errors.push('OUTPUT_SAFETY_SOURCE_RANGE_MISMATCH');
      if (manifest.frameCount!==expected.frameCount || manifest.durationMs!==expected.durationMs
        || coveragePolicy.frameCount!==expected.frameCount || coveragePolicy.durationMs!==expected.durationMs)
        errors.push('OUTPUT_SAFETY_MEDIA_LENGTH_MISMATCH');
      if (expected.sourceRange.kind==='image' && observation.audioPresent) errors.push('OUTPUT_SAFETY_AUDIO_PRESENCE_MISMATCH');
      if (expected.requiredFrameIndices.some(frame=>!indices.includes(frame)))
        errors.push('OUTPUT_SAFETY_FRAME_COVERAGE_INCOMPLETE');
    } catch (error) { errors.push(error.message); }
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
