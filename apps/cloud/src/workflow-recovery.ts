import {recordRenderFailure,reconcileOperation} from './render-recovery.ts';
import {failDirector} from './director-recovery.ts';
import {registerWorkflow,createTrackedWorkflow,workflowStatus,stopWorkflow,resolveWorkflow,nativeTerminal,type TrackedWorkflow} from './workflow-state.ts';
import type {PipelineEnv,Json,Operation} from './pipeline-types.ts';

const nativeFailure=(kind:string,status:{status:string;error?:{message?:string}})=>
 status.error?.message&&/^[A-Z][A-Z0-9_]+$/.test(status.error.message)?status.error.message:
 `${kind==='render'?'RENDER':'OPERATION'}_WORKFLOW_${status.status==='complete'?'INCOMPLETE':status.status.toUpperCase()}`;

export async function recoverWorkflow(env:PipelineEnv,row:TrackedWorkflow,status?:Awaited<ReturnType<typeof workflowStatus>>){
 const op=await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(row.operation_id).first<Operation>();
 if(!op)throw Error('WORKFLOW_OPERATION_MISSING');
 if(['failed','cancelled'].includes(op.status))return reconcileOperation(env,op.id);
 const native=status??await workflowStatus(env,row);
 if(!nativeTerminal(native.status))return;
 if(row.kind==='render'){
  const render=await env.DB.prepare('SELECT status FROM pipeline_renders WHERE id=?').bind(row.id).first<Json>();
  if(!render)throw Error('RENDER_NOT_FOUND');
  if(render.status!=='passed')await recordRenderFailure(env,row.id,nativeFailure(row.kind,native)); // Includes any unconfirmed physical stop.
 }else if(['active','awaiting_user'].includes(op.status)){
  await failDirector(env,op,nativeFailure(row.kind,native));return;
 }else await env.OPERATIONS.getByName(op.id).closeStudio();
 await resolveWorkflow(env,row);
}

/** No native restart here: an interrupted paid stage is reconciled, never replayed speculatively. */
export async function recoverWorkflows(env:PipelineEnv){
 const rows=await env.DB.prepare('SELECT * FROM pipeline_workflows WHERE reconciled_at IS NULL ORDER BY COALESCE(last_checked_at,0),registered_at LIMIT 20').all<TrackedWorkflow>();
 const results=[];
 for(const row of rows.results){
  try{await recoverWorkflow(env,row);results.push({kind:row.kind,id:row.id,status:'inspected'});}
  catch{results.push({kind:row.kind,id:row.id,status:'unconfirmed'});}
 }
 return results;
}

export async function dispatchCreative(env:PipelineEnv,item:Json){
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
