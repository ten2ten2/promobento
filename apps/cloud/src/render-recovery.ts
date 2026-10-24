import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import type {PipelineEnv,Json,Operation} from './pipeline-types.ts';

const terminal=new Set(['passed','blocked','cancelled']);
export const renderFailureCode=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'RENDER_INTERNAL_ERROR';

async function stopAttempts(env:PipelineEnv,attempts:Array<{id:string}>){
 const stopped=await Promise.allSettled(attempts.map(async attempt=>{
  await env.SHARDS.getByName(attempt.id).stopAndSettle();
  // An attempt may have failed before the DO bound taskId. The confirmed stop still belongs to this row.
  await env.DB.prepare("UPDATE pipeline_attempts SET status=CASE WHEN status='active' THEN 'stopped' ELSE status END,stopped_at=COALESCE(stopped_at,?) WHERE id=?")
   .bind(Date.now(),attempt.id).run();
 }));
 return stopped.filter(result=>result.status==='rejected').length;
}

export async function advanceRenderStage(env:PipelineEnv,renderId:string,op:Operation,status:'sharding'|'verifying'|'assembling'){
 const updated=await env.DB.prepare("UPDATE pipeline_renders SET status=? WHERE id=? AND operation_id=? AND generation=? AND status NOT IN ('passed','blocked','cancelled') AND EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')")
  .bind(status,renderId,op.id,op.generation,op.id,op.generation).run();
 if(updated.meta.changes!==1)throw Error('OPERATION_FENCED');
}

/** A durable failure step retries cleanup only, never model calls, capture or encoding. */
export async function recordRenderFailure(env:PipelineEnv,renderId:string,code:string){
 const row=await env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=?').bind(renderId).first<Json>();
 if(!row)throw Error('RENDER_NOT_FOUND');if(row.status==='passed')return;
 const op=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(row.operation_id).first<Json>();
 const status=op?.status==='cancelled'||op&&op.generation!==row.generation?'cancelled':'blocked';
 const previous=row.result_json?parseCanonicalJson(row.result_json) as Json:{};
 // Fence new attempts before taking the stop inventory. Already-enqueued RPCs are fenced by the DO's stop latch.
 await env.DB.prepare("UPDATE pipeline_renders SET status=?,finished_at=COALESCE(finished_at,?),result_json=? WHERE id=? AND status<>'passed'")
  .bind(status,Date.now(),canonical({...previous,status,code:previous.code??code,stopPending:true}),renderId).run();
 const attempts=await env.DB.prepare('SELECT id FROM pipeline_attempts WHERE render_id=? AND stopped_at IS NULL').bind(renderId).all<{id:string}>();
 const stopPending=await stopAttempts(env,attempts.results)>0;
 await env.DB.prepare("UPDATE pipeline_renders SET result_json=? WHERE id=? AND status=?")
  .bind(canonical({...previous,status,code:previous.code??code,stopPending}),renderId,status).run();
 if(stopPending)throw Error('COMPUTE_STOP_UNCONFIRMED');
}

/** Commit and its notification outbox are one transaction. A failed progress RPC cannot undo a film. */
export async function commitRender(env:PipelineEnv,renderId:string,op:Operation,resultJson:string){
 const payload=canonical({operationId:op.id,renderId,generation:op.generation,status:'passed'});
 const changed=await env.DB.batch([
  env.DB.prepare("UPDATE pipeline_renders SET status='passed',result_json=?,finished_at=? WHERE id=? AND operation_id=? AND generation=? AND status NOT IN ('passed','blocked','cancelled') AND EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')")
   .bind(resultJson,Date.now(),renderId,op.id,op.generation,op.id,op.generation),
  env.DB.prepare("INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id WHERE r.id=? AND r.operation_id=? AND r.generation=? AND r.status='passed' AND r.result_json=? AND o.generation=? AND o.status='active')")
   .bind('progress-'+renderId,op.id,'render_progress',payload,renderId,op.id,op.generation,resultJson,op.generation)
 ]);
 if(changed[0]!.meta.changes!==1){
  const previous=await env.DB.prepare("SELECT result_json FROM pipeline_renders WHERE id=? AND status='passed' AND operation_id=? AND generation=?")
   .bind(renderId,op.id,op.generation).first<{result_json:string}>();
  if(!previous)throw Error('OPERATION_FENCED');if(previous.result_json!==resultJson)throw Error('RENDER_COMMIT_CONFLICT');
 }
}

/** Terminal operations can settle orphan rows, but never revive their generation or overwrite a passed film. */
export async function reconcileOperation(env:PipelineEnv,operationId:string){
 const op=await env.DB.prepare('SELECT status FROM pipeline_operations WHERE id=?').bind(operationId).first<Json>();
 if(!op||!['failed','cancelled'].includes(op.status))throw Error('OPERATION_NOT_TERMINAL');
 const attempts=await env.DB.prepare('SELECT id FROM pipeline_attempts WHERE operation_id=? AND stopped_at IS NULL').bind(operationId).all<{id:string}>();
 if(await stopAttempts(env,attempts.results))throw Error('COMPUTE_STOP_UNCONFIRMED');
 await env.OPERATIONS.getByName(operationId).closeStudio();
 const renders=await env.DB.prepare("SELECT id,status,result_json FROM pipeline_renders WHERE operation_id=? AND status<>'passed'").bind(operationId).all<Json>();
 for(const row of renders.results){
  const previous=row.result_json?parseCanonicalJson(row.result_json) as Json:{};
  const status=terminal.has(row.status)?row.status:op.status==='cancelled'?'cancelled':'blocked';
  await env.DB.prepare("UPDATE pipeline_renders SET status=?,finished_at=COALESCE(finished_at,?),result_json=? WHERE id=? AND status<>'passed'")
   .bind(status,Date.now(),canonical({...previous,status,code:previous.code??(op.status==='cancelled'?'OPERATION_CANCELLED':'OPERATION_FAILED'),
    stopPending:false,...(terminal.has(row.status)?{}:{reconciledFrom:row.status})}),row.id).run();
 }
 const pending=await env.DB.prepare('SELECT r.id,r.kind,r.reserved_micros FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=? AND s.reservation_id IS NULL')
  .bind(operationId).all<Json>();
 return {operationId,stoppedAttempts:attempts.results.length,reconciledRenders:renders.results.length,pendingCosts:pending.results};
}

export async function dispatchRender(env:PipelineEnv,item:Json){
 const row=await env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=?').bind(item.id.slice('render-'.length)).first<Json>();
 if(!row||row.operation_id!==item.operationId)throw Error('OUTBOX_SCOPE_INVALID');
 const op=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(row.operation_id).first<Json>();
 if(terminal.has(row.status)||!op||op.status!=='active'||op.generation!==row.generation)return;
 try{await env.RENDER_WORKFLOW.create({id:row.id,params:{renderId:row.id}});}
 catch{
  const status=await(await env.RENDER_WORKFLOW.get(row.id)).status();
  if(['errored','terminated'].includes(status.status))await recordRenderFailure(env,row.id,renderFailureCode(new Error(status.error?.message??'RENDER_WORKFLOW_TERMINATED')));
 }
}

export async function dispatchRenderProgress(env:PipelineEnv,item:Json){
 const value=parseCanonicalJson(item.payloadJson) as Json;
 if(value.operationId!==item.operationId)throw Error('OUTBOX_SCOPE_INVALID');
 const row=await env.DB.prepare('SELECT status,operation_id,generation FROM pipeline_renders WHERE id=?').bind(value.renderId).first<Json>();
 const op=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(item.operationId).first<Json>();
 if(row?.status!=='passed'||row.operation_id!==item.operationId||row.generation!==value.generation
  ||!op||!['active','awaiting_user','succeeded'].includes(op.status)||op.generation!==value.generation)return;
 await env.OPERATIONS.getByName(item.operationId).progress(canonical(value));
}
