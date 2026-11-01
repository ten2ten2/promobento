import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import type {PipelineEnv,Json,Operation} from './pipeline-types.ts';
import {registerWorkflow,createTrackedWorkflow,stopWorkflow,stopOperationWorkflows,resolveWorkflow,type WorkflowKind} from './workflow-state.ts';
import {stopRenderAdmissions} from './render-admission.ts';

const terminal=new Set(['passed','blocked','cancelled']);
export const renderCompletionEventType=(renderId:string)=>'native-render-'+digest(renderId).slice(0,32);
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

export async function advanceRenderStage(env:PipelineEnv,renderId:string,op:Operation,status:'rendering'|'verifying'){
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
 // Fence new attempts before taking the stop inventory. Already-enqueued RPCs are fenced by the DO's stop latch.
 await env.DB.prepare("UPDATE pipeline_renders SET status=?,finished_at=COALESCE(finished_at,?),result_json=json_set(COALESCE(result_json,'{}'),'$.status',?,'$.code',COALESCE(json_extract(result_json,'$.code'),?),'$.stopPending',json('true')) WHERE id=? AND status<>'passed'")
  .bind(status,Date.now(),status,code,renderId).run();
 await env.DB.prepare("UPDATE pipeline_render_admissions SET status='cancelled' WHERE render_id=? AND status='queued'")
  .bind(renderId).run();
 const attempts=await env.DB.prepare('SELECT id FROM pipeline_attempts WHERE render_id=? AND stopped_at IS NULL').bind(renderId).all<{id:string}>();
 const [attemptFailures,admissionStop]=await Promise.all([stopAttempts(env,attempts.results),stopRenderAdmissions(env,renderId).then(()=>false,()=>true)]);
 const stopPending=attemptFailures>0||admissionStop;
 await env.DB.prepare("UPDATE pipeline_renders SET result_json=json_set(result_json,'$.stopPending',json(?)) WHERE id=? AND status=?")
  .bind(canonical(stopPending),renderId,status).run();
 await env.DB.prepare("INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id WHERE r.id=? AND r.status='blocked' AND o.status='active' AND o.generation=r.generation)")
  .bind('render-terminal-'+renderId,row.operation_id,'render_terminal',canonical({renderId,operationId:row.operation_id,generation:row.generation,status}),renderId).run();
 if(stopPending)throw Error('COMPUTE_STOP_UNCONFIRMED');
}

/** Commit and its notification outbox are one transaction. A failed progress RPC cannot undo a film. */
export async function commitRender(env:PipelineEnv,renderId:string,op:Operation,resultJson:string){
 const result=parseCanonicalJson(resultJson) as Json;
 if(typeof result.attemptId!=='string')throw Error('RENDER_LEASE_FENCED');
 const payload=canonical({operationId:op.id,renderId,generation:op.generation,status:'passed'});
 const changed=await env.DB.batch([
  env.DB.prepare(`UPDATE pipeline_renders SET status='passed',result_json=?,finished_at=?
    WHERE id=? AND operation_id=? AND generation=? AND status='verifying'
      AND EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')
      AND EXISTS(SELECT 1 FROM pipeline_attempts p JOIN pipeline_render_admissions a ON a.id=p.id
        WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=?
          AND p.status='succeeded' AND p.stopped_at IS NOT NULL AND a.status='released'
          AND a.lease_token IS NOT NULL AND a.attempt_deadline_at IS NOT NULL)`)
   .bind(resultJson,Date.now(),renderId,op.id,op.generation,op.id,op.generation,result.attemptId,renderId,op.id,op.generation),
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
export async function reconcileOperation(env:PipelineEnv,operationId:string,exceptWorkflow?:{kind:WorkflowKind;id:string}){
 const op=await env.DB.prepare('SELECT status FROM pipeline_operations WHERE id=?').bind(operationId).first<Json>();
 if(!op||!['failed','cancelled'].includes(op.status))throw Error('OPERATION_NOT_TERMINAL');
 // Native termination and physical stops are independent. An unavailable platform API must not skip compute cleanup.
 const workflowsPromise=Promise.allSettled([stopOperationWorkflows(env,operationId,exceptWorkflow)]);
 const attempts=await env.DB.prepare('SELECT id FROM pipeline_attempts WHERE operation_id=? AND stopped_at IS NULL').bind(operationId).all<{id:string}>();
 const unconfirmedStops=await stopAttempts(env,attempts.results);
 const workflows=await workflowsPromise;
 if(unconfirmedStops)throw Error('COMPUTE_STOP_UNCONFIRMED');
 if(workflows[0]!.status==='rejected')throw Error('WORKFLOW_STOP_UNCONFIRMED');
 const renders=await env.DB.prepare("SELECT id,status,result_json FROM pipeline_renders WHERE operation_id=? AND status<>'passed'").bind(operationId).all<Json>();
 await env.DB.prepare("UPDATE pipeline_render_admissions SET status='cancelled' WHERE operation_id=? AND status='queued'")
  .bind(operationId).run();
 const stops=await Promise.allSettled(renders.results.map(row=>stopRenderAdmissions(env,row.id)));
 if(stops.some(result=>result.status==='rejected'))throw Error('COMPUTE_STOP_UNCONFIRMED');
 for(const row of renders.results){
  const previous=row.result_json?parseCanonicalJson(row.result_json) as Json:{};
  const status=terminal.has(row.status)?row.status:op.status==='cancelled'?'cancelled':'blocked';
  await env.DB.prepare("UPDATE pipeline_renders SET status=?,finished_at=COALESCE(finished_at,?),result_json=json_set(COALESCE(result_json,'{}'),'$.status',?,'$.code',COALESCE(json_extract(result_json,'$.code'),?),'$.stopPending',json('false')) WHERE id=? AND status<>'passed'")
   .bind(status,Date.now(),status,previous.code??(op.status==='cancelled'?'OPERATION_CANCELLED':'OPERATION_FAILED'),row.id).run();
  if(!terminal.has(row.status))await env.DB.prepare("UPDATE pipeline_renders SET result_json=json_set(result_json,'$.reconciledFrom',COALESCE(json_extract(result_json,'$.reconciledFrom'),?)) WHERE id=? AND status<>'passed'").bind(row.status,row.id).run();
 }
 const pending=await env.DB.prepare('SELECT r.id,r.kind,r.reserved_micros FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=? AND s.reservation_id IS NULL')
  .bind(operationId).all<Json>();
 for(const workflow of workflows[0]!.value)await resolveWorkflow(env,workflow);
 return {operationId,stoppedAttempts:attempts.results.length,reconciledRenders:renders.results.length,workflows:workflows[0]!.value,pendingCosts:pending.results};
}

export async function dispatchRender(env:PipelineEnv,item:Json){
 const payload=parseCanonicalJson(item.payloadJson) as Json;
 if(payload.engine!=='huashu')return;
 const row=await env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=?').bind(item.id.slice('render-'.length)).first<Json>();
 if(!row||row.operation_id!==item.operationId||payload.renderId!==row.id)throw Error('OUTBOX_SCOPE_INVALID');
 const op=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(row.operation_id).first<Json>();
 if(terminal.has(row.status)||!op||op.status!=='active'||op.generation!==row.generation)return;
 const tracked=await registerWorkflow(env,'render',row.id,row.operation_id,row.generation);
 const status=await createTrackedWorkflow(env,tracked);
 const current=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(row.operation_id).first<Json>();
 if(!current||current.status!=='active'||current.generation!==row.generation){await stopWorkflow(env,tracked);return;}
 if(['errored','terminated','complete'].includes(status.status)){
  const actual=await env.DB.prepare('SELECT status FROM pipeline_renders WHERE id=?').bind(row.id).first<Json>();
  if(actual?.status!=='passed')await recordRenderFailure(env,row.id,renderFailureCode(new Error(status.error?.message??('RENDER_WORKFLOW_'+(status.status==='complete'?'INCOMPLETE':status.status.toUpperCase())))));
  await resolveWorkflow(env,tracked);
 }
}

export async function dispatchRenderProgress(env:PipelineEnv,item:Json){
 const value=parseCanonicalJson(item.payloadJson) as Json;
 if(value.operationId!==item.operationId)throw Error('OUTBOX_SCOPE_INVALID');
 const row=await env.DB.prepare('SELECT status,operation_id,generation FROM pipeline_renders WHERE id=?').bind(value.renderId).first<Json>();
 const op=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(item.operationId).first<Json>();
 if(row?.status!=='passed'||row.operation_id!==item.operationId||row.generation!==value.generation
  ||!op||!['active','awaiting_user','succeeded'].includes(op.status)||op.generation!==value.generation)return;
 await notifyDirectorRender(env,item.operationId,value.renderId,value.generation,'passed');
 try{await env.OPERATIONS.getByName(item.operationId).progress(canonical(value));}catch{ /* SSE delivery is not a commit prerequisite. */ }
}

async function notifyDirectorRender(env:PipelineEnv,operationId:string,renderId:string,generation:number,status:string){
 const row=await env.DB.prepare("SELECT id FROM pipeline_workflows WHERE kind='operation' AND id=? AND generation=? AND engine='huashu' AND reconciled_at IS NULL")
  .bind(operationId,generation).first();
 if(!row)return; // Direct internal renders have no Director Workflow.
 const instance=await env.OPERATION_WORKFLOW.get(operationId);
 try{await instance.sendEvent({type:renderCompletionEventType(renderId),payload:{renderId,status}});}
 catch(error){
  const observed=await instance.status().catch(()=>null);
  if(!observed||!['complete','errored','terminated'].includes(observed.status))throw error;
 }
}

export async function dispatchRenderTerminal(env:PipelineEnv,item:Json){
 const value=parseCanonicalJson(item.payloadJson) as Json;
 if(value.operationId!==item.operationId||!['blocked','cancelled'].includes(value.status))throw Error('OUTBOX_SCOPE_INVALID');
 const render=await env.DB.prepare('SELECT operation_id,generation,status FROM pipeline_renders WHERE id=?').bind(value.renderId).first<Json>();
 const op=await env.DB.prepare('SELECT generation,status FROM pipeline_operations WHERE id=?').bind(item.operationId).first<Json>();
 if(!render||render.operation_id!==item.operationId||render.generation!==value.generation||render.status!==value.status
  ||!op||op.generation!==value.generation||!['active','awaiting_user'].includes(op.status))return;
 await notifyDirectorRender(env,item.operationId,value.renderId,value.generation,value.status);
}

type DirectorEventOutbox={id:string;operation_id:string;kind:string;payload_json:string;
 director_event_done_at:number|null;director_event_retry_at:number;director_event_failures:number};

/** Queue enqueue is not a Director acknowledgement. Persist the result of the actual event RPC. */
export async function deliverRenderDirectorEvent(env:PipelineEnv,item:Json){
 const row=await env.DB.prepare('SELECT * FROM pipeline_outbox WHERE id=? AND kind IN (\'render_progress\',\'render_terminal\')')
  .bind(item.id).first<DirectorEventOutbox>();
 if(!row||row.kind!==item.kind||row.operation_id!==item.operationId||row.payload_json!==item.payloadJson)throw Error('OUTBOX_SCOPE_INVALID');
 if(row.director_event_done_at!==null||row.director_event_retry_at>Date.now())return;
 try{
  if(row.kind==='render_progress')await dispatchRenderProgress(env,item);
  else await dispatchRenderTerminal(env,item);
  await env.DB.prepare('UPDATE pipeline_outbox SET director_event_done_at=? WHERE id=? AND director_event_done_at IS NULL')
   .bind(Date.now(),row.id).run();
 }catch(error){
  const delay=Math.min(5*60_000,5000*2**Math.min(row.director_event_failures,6));
  await env.DB.prepare(`UPDATE pipeline_outbox SET director_event_failures=director_event_failures+1,
    director_event_retry_at=MAX(director_event_retry_at,?) WHERE id=? AND director_event_done_at IS NULL`)
   .bind(Date.now()+delay,row.id).run();
  throw error;
 }
}

/** Even if a Queue message exhausts retries, its durable outbox row can still wake the Director. */
export async function recoverRenderDirectorEvents(env:PipelineEnv){
 const rows=await env.DB.prepare(`SELECT * FROM pipeline_outbox
  WHERE kind IN ('render_progress','render_terminal') AND director_event_done_at IS NULL AND director_event_retry_at<=?
  ORDER BY director_event_retry_at,rowid LIMIT 64`).bind(Date.now()).all<DirectorEventOutbox>();
 for(const row of rows.results){
  try{await deliverRenderDirectorEvent(env,{id:row.id,kind:row.kind,operationId:row.operation_id,payloadJson:row.payload_json});}
  catch{ /* Individual failures back off; later events still get a chance. */ }
 }
}
