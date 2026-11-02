import type {Json} from './pipeline-types.ts';

export type StageGuard=()=>void;
/** Independent, durably named Workflow steps may overlap; dependent stages may not. */
export async function runBoundedStage<T,R>(items:readonly T[],limit:number,work:(item:T,index:number,guard:StageGuard)=>Promise<R>):Promise<R[]> {
 if(!Number.isSafeInteger(limit)||limit<1||limit>4)throw Error('DIRECTOR_STAGE_CONCURRENCY_INVALID');
 const results=new Array<R>(items.length);
 let next=0,failed=false,failure:unknown;
 const guard:StageGuard=()=>{if(failed)throw Error('DIRECTOR_STAGE_ABORTED');};
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
  while(!failed){
   const index=next++;
   if(index>=items.length)break;
   try{results[index]=await work(items[index]!,index,guard);}
   catch(error){if(!failed){failed=true;failure=error;}}
  }
 }));
 // Drain already dispatched paid calls/renders before failing the Workflow.
 if(failed)throw failure;
 return results;
}

/** Asset observations are independent. Keep original indices for replay-stable model call IDs. */
export function analyzeMaterialStage(materials:Json[],limit:number,analyze:(asset:Json,index:number,guard:StageGuard)=>Promise<Json>):Promise<Json[]> {
 const visible=materials.flatMap((asset,index)=>asset.preview?[{asset,index}]:[]);
 return runBoundedStage(visible,limit,({asset,index},_,guard)=>analyze(asset,index,guard));
}

/** Each direction has its own source revision and preview; result order follows the direction cards. */
export function previewDirectionStage(cards:Json[],limit:number,preview:(card:Json,guard:StageGuard)=>Promise<Json>):Promise<Json[]> {
 return runBoundedStage(cards,limit,(card,_,guard)=>preview(card,guard));
}
