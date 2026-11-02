import type {PipelineEnv,Json} from './pipeline-types.ts';
import {boundedControl,settledPool} from './control-batch.ts';

export type WorkflowKind='operation'|'render';
export type TrackedWorkflow={kind:WorkflowKind;id:string;operation_id:string;generation:number;native_created_at:number|null;reconciled_at:number|null;engine:'legacy'|'huashu'};
export const nativeTerminal=(status:string)=>['complete','errored','terminated'].includes(status);
const binding=(env:PipelineEnv,kind:WorkflowKind)=>kind==='render'?env.RENDER_WORKFLOW:env.OPERATION_WORKFLOW;

export async function registerWorkflow(env:PipelineEnv,kind:WorkflowKind,id:string,operationId:string,generation:number){
 await env.DB.prepare('INSERT OR IGNORE INTO pipeline_workflows(kind,id,operation_id,generation,registered_at,engine) VALUES(?,?,?,?,?,\'huashu\')')
  .bind(kind,id,operationId,generation,Date.now()).run();
 const row=await env.DB.prepare('SELECT * FROM pipeline_workflows WHERE kind=? AND id=?').bind(kind,id).first<TrackedWorkflow>();
 if(!row||row.operation_id!==operationId||row.generation!==generation)throw Error('WORKFLOW_IDENTITY_CONFLICT');
 if(row.engine!=='huashu')throw Error('LEGACY_WORKFLOW_REQUIRES_RECONCILIATION');return row;
}

/** Run only inside the first durable step. A full native restart loses that step but cannot repeat the D1 claim. */
export async function workflowStarted(env:PipelineEnv,kind:WorkflowKind,id:string,operationId:string,fallbackGeneration:number){
 const previous=await env.DB.prepare('SELECT generation,engine FROM pipeline_workflows WHERE kind=? AND id=?').bind(kind,id).first<{generation:number;engine:string}>();
 if(previous&&previous.engine!=='huashu')throw Error('LEGACY_WORKFLOW_REQUIRES_RECONCILIATION');
 const row=await registerWorkflow(env,kind,id,operationId,previous?.generation??fallbackGeneration);
 // Claim and state transition are one D1 update. A duplicate or delayed start
 // must not clear reconciliation evidence or revive an already-fenced operation.
 const now=Date.now();
 const claimed=await env.DB.prepare(`UPDATE pipeline_workflows SET
   native_created_at=COALESCE(native_created_at,?),native_status='running',last_checked_at=?,last_error=NULL,
   reconciled_at=NULL,execution_claimed_at=? WHERE kind=? AND id=?
   AND execution_claimed_at IS NULL AND reconciled_at IS NULL
   AND EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')`)
  .bind(now,now,now,kind,id,operationId,row.generation).run();
 if(claimed.meta.changes!==1)throw Error('WORKFLOW_RESTART_RECONCILIATION_REQUIRED');return row.generation;
}

export async function workflowStatus(env:PipelineEnv,row:TrackedWorkflow){
 try{
  const status=await boundedControl((async()=> (await binding(env,row.kind).get(row.id)).status())());
  if(status.status==='unknown')throw Error('WORKFLOW_STATUS_UNCONFIRMED');
  await env.DB.prepare('UPDATE pipeline_workflows SET native_created_at=COALESCE(native_created_at,?),native_status=?,last_checked_at=?,last_error=NULL WHERE kind=? AND id=?')
   .bind(Date.now(),status.status,Date.now(),row.kind,row.id).run();return status;
 }catch(error){
  await env.DB.prepare("UPDATE pipeline_workflows SET last_checked_at=?,last_error='WORKFLOW_STATUS_UNCONFIRMED' WHERE kind=? AND id=?")
   .bind(Date.now(),row.kind,row.id).run();throw error;
 }
}

/** A known instance is never recreated after retention/eviction. Unknown create outcomes are inspected. */
export async function createTrackedWorkflow(env:PipelineEnv,row:TrackedWorkflow){
 if(row.native_created_at===null){
  try{
   const params=row.kind==='render'?{renderId:row.id}:{operationId:row.id};
   await boundedControl(binding(env,row.kind).create({id:row.id,params} as any));
   await env.DB.prepare('UPDATE pipeline_workflows SET native_created_at=COALESCE(native_created_at,?) WHERE kind=? AND id=?')
    .bind(Date.now(),row.kind,row.id).run();
  }catch(error){
   // Only a successful get/status proves a duplicate. A transport error is not evidence of absence.
   try{return await workflowStatus(env,row);}catch{throw error;}
  }
 }
 return workflowStatus(env,row);
}

export async function stopWorkflow(env:PipelineEnv,row:TrackedWorkflow){
 let status=await workflowStatus(env,row);
 if(!nativeTerminal(status.status)){
  try{await boundedControl((async()=> (await binding(env,row.kind).get(row.id)).terminate())());}
  catch(error){status=await workflowStatus(env,row);if(!nativeTerminal(status.status))throw error;}
  status=await workflowStatus(env,row);
 }
 if(!nativeTerminal(status.status))throw Error('WORKFLOW_STOP_UNCONFIRMED');return{kind:row.kind,id:row.id,status:status.status};
}

export async function stopOperationWorkflows(env:PipelineEnv,operationId:string,except?:{kind:WorkflowKind;id:string}){
 const rows=await env.DB.prepare('SELECT * FROM pipeline_workflows WHERE operation_id=? AND reconciled_at IS NULL').bind(operationId).all<TrackedWorkflow>();
 const statuses=await settledPool(rows.results.filter(row=>!(except?.kind===row.kind&&except.id===row.id)),4,row=>stopWorkflow(env,row));
 if(statuses.some(result=>result.status==='rejected'))throw Error('WORKFLOW_STOP_UNCONFIRMED');
 return statuses.map(result=>(result as PromiseFulfilledResult<{kind:WorkflowKind;id:string;status:string}>).value);
}
export async function resolveWorkflow(env:PipelineEnv,row:{kind:WorkflowKind;id:string}){
 await env.DB.prepare('UPDATE pipeline_workflows SET reconciled_at=? WHERE kind=? AND id=?').bind(Date.now(),row.kind,row.id).run();
}
export async function workflowInventory(env:PipelineEnv,operationId:string){
 const rows=await env.DB.prepare('SELECT * FROM pipeline_workflows WHERE operation_id=? ORDER BY registered_at,kind,id').bind(operationId).all<Json>();return rows.results;
}
