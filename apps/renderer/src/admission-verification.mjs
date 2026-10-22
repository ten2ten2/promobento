import {canonical} from '@promobento/contracts';
import {admissionVerificationPlan} from './admission-capture.mjs';

export const ADMISSION_VERIFICATION_VERSION='admission-verification-v2';
export const ADMISSION_COMMAND_VERIFICATION_VERSION='admission-command-determinism-v1';

/** Command checks are cheap engine work; pixel checks are expensive browser work.
 * Their plans are versioned separately so a full command pass never enlarges capture.
 * Repeated and unordered command requests reuse the pixel lists because their draw
 * files feed those pixel comparisons. The cold engine pass evaluates every frame in
 * reverse order in a fresh container; it is broader than sampling, not a purity proof.
 */
export function admissionCommandVerificationPlan(frameCount) {
  const pixels=admissionVerificationPlan(frameCount);
  return {version:ADMISSION_COMMAND_VERIFICATION_VERSION,repeated:[...pixels.repeated],unordered:[...pixels.unordered],
    cold:{order:'full_reverse',newContainer:true,frameCount}};
}

export function admissionVerification(frameCount) {
  return {version:ADMISSION_VERIFICATION_VERSION,commands:admissionCommandVerificationPlan(frameCount),pixels:admissionVerificationPlan(frameCount)};
}

/** Engine request plans. `paths` lists the draw files the capture container reads;
 * an empty list means the response is compared with its forward hash and discarded. */
export function admissionEngineRequests(verification) {
  const {commands,pixels}=verification,frameCount=commands.cold.frameCount;
  if(verification.version!==ADMISSION_VERIFICATION_VERSION||commands.version!==ADMISSION_COMMAND_VERIFICATION_VERSION
    ||commands.cold.order!=='full_reverse'||commands.cold.newContainer!==true
    ||canonical(admissionVerification(frameCount))!==canonical(verification))
    throw Error('ADMISSION_VERIFICATION_INVALID');
  const sample=(check,frames)=>frames.map((frame,index)=>({frame,check,paths:[check+'/'+index+'.json']}));
  const first=[...Array.from({length:frameCount},(_,frame)=>({frame,check:'forward',paths:['forward/'+frame+'.json']})),
    ...sample('repeated',commands.repeated),...sample('unordered',commands.unordered)];
  const cold=Array.from({length:frameCount},(_,index)=>{
    const frame=frameCount-1-index;
    return {frame,check:'cold_reverse',paths:pixels.cold.flatMap((coldFrame,coldIndex)=>coldFrame===frame?['cold/'+coldIndex+'.json']:[])};
  });
  return {first,cold};
}
