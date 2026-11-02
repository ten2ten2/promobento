import {recordRenderFailure,reconcileOperation} from './render-recovery.ts';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {failDirector} from './director-recovery.ts';
import {registerWorkflow,createTrackedWorkflow,workflowStatus,stopWorkflow,resolveWorkflow,nativeTerminal,type TrackedWorkflow} from './workflow-state.ts';
import {boundedControl,settledPool} from './control-batch.ts';
import type {PipelineEnv,Json,Operation} from './pipeline-types.ts';

const nativeFailure=(kind:string,status:{status:string;error?:{message?:string}})=>
 status.error?.message&&/^[A-Z][A-Z0-9_]+$/.test(status.error.message)?status.error.message:
 `${kind==='render'?'RENDER':'OPERATION'}_WORKFLOW_${status.status==='complete'?'INCOMPLETE':status.status.toUpperCase()}`;

async function recoverWorkflow(env:PipelineEnv,row:TrackedWorkflow,status?:Awaited<ReturnType<typeof workflowStatus>>){
 const op=await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(row.operation_id).first<Operation>();
 if(!op)throw Error('WORKFLOW_OPERATION_MISSING');
 if(['failed','cancelled'].includes(op.status))return reconcileOperation(env,op.id);
 // A Queue may disappear after registering the identity but before calling
 // Workflow.create(). A delivered outbox row cannot recover this because the
 // registration already exists. Only an unclaimed, still-queued native job
 // may complete its initial creation; a paid/claimed instance is never rerun.
 let eligible=false;
 if(!status&&op.status==='active'&&op.generation===row.generation
   &&row.native_created_at===null&&row.execution_claimed_at===null
   &&row.native_stop_confirmed_at===null&&row.reconciled_at===null){
  if(row.kind==='render')eligible=!!await env.DB.prepare(`SELECT id FROM pipeline_renders
    WHERE id=? AND operation_id=? AND generation=? AND status='queued'`).bind(row.id,op.id,row.generation).first();
  else eligible=!!await env.DB.prepare(`SELECT operation_id FROM pipeline_contexts
    WHERE operation_id=? AND engine='huashu'`).bind(op.id).first();
 }
 const native=status??(eligible?await createTrackedWorkflow(env,row):await workflowStatus(env,row));
 if(!nativeTerminal(native.status))return;
 if(row.kind==='render'){
  const render=await env.DB.prepare('SELECT status FROM pipeline_renders WHERE id=?').bind(row.id).first<Json>();
  if(!render)throw Error('RENDER_NOT_FOUND');
  if(render.status!=='passed')await recordRenderFailure(env,row.id,nativeFailure(row.kind,native)); // Includes any unconfirmed physical stop.
 }else if(['active','awaiting_user'].includes(op.status)){
  await failDirector(env,op,nativeFailure(row.kind,native));return;
 }
 await resolveWorkflow(env,row);
}

/** No native restart here: an interrupted paid stage is reconciled, never replayed speculatively. */
export async function recoverWorkflows(env:PipelineEnv){
 // One terminal operation may have dozens of native-stop checkpoints but only
 // one remaining compute/lease/render cleanup. Do not race that cleanup against
 // itself in all four sweep slots or hide independent operations behind it.
 const rows=await env.DB.prepare(`SELECT * FROM (
   SELECT w.*,ROW_NUMBER() OVER (
     PARTITION BY CASE WHEN o.status IN ('failed','cancelled') THEN 'terminal:'||w.operation_id
       ELSE 'workflow:'||w.kind||':'||w.id END
     ORDER BY COALESCE(w.last_checked_at,0),w.registered_at,w.kind,w.id
   ) AS sweep_rank FROM pipeline_workflows w JOIN pipeline_operations o ON o.id=w.operation_id
   WHERE w.engine='huashu' AND w.reconciled_at IS NULL
  ) WHERE sweep_rank=1 ORDER BY COALESCE(last_checked_at,0),registered_at LIMIT 20`).all<TrackedWorkflow>();
 const results=await settledPool(rows.results,4,row=>boundedControl(recoverWorkflow(env,row),15_000));
 return Promise.all(results.map(async (result,index)=>{
  const row=rows.results[index]!;
  if(result.status==='fulfilled')return {kind:row.kind,id:row.id,status:'inspected'};
  // An unavailable Workflow/Shard must move behind other rows in the next sweep.
  await env.DB.prepare("UPDATE pipeline_workflows SET last_checked_at=?,last_error='WORKFLOW_RECOVERY_UNCONFIRMED' WHERE kind=? AND id=? AND reconciled_at IS NULL")
   .bind(Date.now(),row.kind,row.id).run();
  return {kind:row.kind,id:row.id,status:'unconfirmed'};
 }));
}

export async function dispatchCreative(env:PipelineEnv,item:Json){
 const payload=parseCanonicalJson(item.payloadJson) as Json;
 if(payload.engine!=='huashu')return;
 if(payload.operationId!==item.operationId)throw Error('OUTBOX_SCOPE_INVALID');
 const op=await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(item.operationId).first<Operation>();
 if(!op||!['active','awaiting_user'].includes(op.status))return;
 const row=await registerWorkflow(env,'operation',op.id,op.id,op.generation);
 const status=await createTrackedWorkflow(env,row);
 const current=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(op.id).first<Json>();
 if(!current||!['active','awaiting_user'].includes(current.status)||current.generation!==op.generation){
  // Creation can finish after cancellation. The original queue item owns this late native instance.
  if(current&&['failed','cancelled'].includes(current.status))await reconcileOperation(env,op.id);
  else if(current?.status!=='succeeded'){await stopWorkflow(env,row);await resolveWorkflow(env,row);}
  return;
 }
 await recoverWorkflow(env,row,status);
}
