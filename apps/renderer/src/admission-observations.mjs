import {canonical} from '@promobento/contracts';

/** Actual browser observations can be larger than source commands. Bound them
 * before retaining each frame, independently of the guest stdout budget.
 */
export const ADMISSION_MEDIA_OBSERVATION_MAX_BYTES=16*1024*1024;
export function admissionObservationBudget(maxBytes=ADMISSION_MEDIA_OBSERVATION_MAX_BYTES) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1)throw Error('ADMISSION_OBSERVATION_BUDGET_INVALID');
  let bytes=0;
  return observation=>{
    const nextBytes=Buffer.byteLength(canonical(observation));
    if(bytes+nextBytes>maxBytes) {
      const error=Error('ADMISSION_MEDIA_OBSERVATION_LIMIT');
      error.details={observationBytes:bytes,nextObservationBytes:nextBytes,maxObservationBytes:maxBytes};throw error;
    }
    bytes+=nextBytes;return bytes;
  };
}
