import {validate} from '@promobento/contracts/validators/frame-observation';
import {filmObservationFrames} from '../../../packages/blocks/src/events.mjs';
import type {Json} from './pipeline-types.ts';

/** Exact reading-hold coverage, not an unrelated minimum count per compute partition. */
export function checkShardObservations(job:Json,shard:{start:number;end:number},film:Json,observations:unknown){
 if(!Array.isArray(observations))throw Error('QA_OBSERVATION_MISSING');
 const expected=filmObservationFrames(film as any,job.quality).filter(frame=>frame>=shard.start&&frame<shard.end);
 const seen=new Set<number>();
 for(const value of observations){
  if(!validate(value))throw Error('QA_BLOCK');
  const observation=value as Json;
  if(observation.renderId!==job.renderId||observation.aspectId!==job.aspectId||seen.has(observation.frame)||!expected.includes(observation.frame))throw Error('QA_OBSERVATION_SCOPE_INVALID');
  seen.add(observation.frame);
  if(observation.findings.some((finding:Json)=>finding.severity==='BLOCK'))throw Error('QA_BLOCK');
 }
 if(expected.some(frame=>!seen.has(frame)))throw Error('QA_OBSERVATION_MISSING');
}
