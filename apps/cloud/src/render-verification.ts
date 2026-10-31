import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {filmUsesWebgl} from '@promobento/contracts/render';
import {compareSeam} from '@promobento/contracts/seams';
import {assertCanvasTextFrameDigests} from '@promobento/contracts/canvas-text';
import {validate as renderValid} from '@promobento/contracts/validators/render-job';
import {checkShardObservations} from './render-observations.ts';
import type {BlobRef,Json} from './pipeline-types.ts';

/** Bounded reads, ordered reports, and no unfinished reads after a QA failure. */
export async function verifyRenderShards({job,film,partition,shards,imageDigest,read,output}:{job:Json;film:Json;partition:Json;shards:Json[];
 imageDigest:string;read:(blob:BlobRef)=>Promise<Uint8Array>;output:(result:Json,suffix:string)=>BlobRef}){
 const webgl=filmUsesWebgl(film),seams:Json[]=new Array(shards.length);
 let cursor=0,failure:unknown;
 await Promise.all(Array.from({length:webgl?1:Math.min(2,shards.length)},async()=>{
  while(!failure&&cursor<shards.length){
   const index=cursor++,result=shards[index]!,shard=partition.shards[index]!;
   try{
    if(!renderValid(result.report)||result.report.kind!=='shard_receipt'||result.report.imageDigest!==imageDigest
     ||result.report.renderId!==job.renderId||result.report.shardIndex!==index||result.report.start!==shard.start||result.report.end!==shard.end)throw Error('SHARD_RECEIPT_INVALID');
    if(webgl&&!result.report.webgl?.length)throw Error('SHARD_WEBGL_REPORT_MISSING');
    if(film.scenes.some((scene:Json)=>scene.kind==='block'&&scene.block==='canvas-title@1')){
     const traceBlob=output(result,'/frame-digests.json');if(traceBlob.sha256!==result.report.outputs.frameDigests)throw Error('SHARD_RECEIPT_INVALID');
     assertCanvasTextFrameDigests(film,shard,job.quality,parseCanonicalJson(await read(traceBlob)));
    }
    const observationBlob=output(result,'/observations.json');
    if(observationBlob.sha256!==result.report.outputs.observations)throw Error('SHARD_RECEIPT_INVALID');
    checkShardObservations(job,shard,film,parseCanonicalJson(await read(observationBlob)));
    if(index){
     const frame=shard.start-1,reads=await Promise.allSettled([read(output(shards[index-1]!,`/seam-frames/${frame}-last.png`)),
      read(output(result,`/seam-frames/${frame}-cold.png`))]);
     const rejected=reads.find(value=>value.status==='rejected');if(rejected)throw rejected.reason;
     const [a,b]=reads as PromiseFulfilledResult<Uint8Array>[],seam={frame,...compareSeam(a!.value,b!.value)};
     if(seam.verdict==='RENDER_SEAM_BLOCK')throw Error('RENDER_SEAM_BLOCK');seams[index]=seam;
    }
   }catch(error){failure??=error;}
  }
 }));
 if(failure)throw failure;
 return seams.filter(Boolean);
}
