import {digest} from '@promobento/contracts/digest';
import {canonical} from '@promobento/contracts/canonical';
import {validId,type Json,type PipelineEnv} from './pipeline-types.ts';

/** Accept concurrent idempotent creates; a conflicting winner is never hidden by OR IGNORE. */
export async function registerOperation(env:PipelineEnv,input:Json){
 if(!validId(input.id)||!validId(input.workspaceId)||!validId(input.projectId)
  ||!['evaluation','calibration'].includes(input.purpose)
  ||!Number.isSafeInteger(input.maxMicros)||input.maxMicros<1||input.maxMicros>10000000)
  throw Error('OPERATION_INVALID');
 const hash=digest(input);
 await env.DB.prepare(`INSERT OR IGNORE INTO pipeline_operations
  (id,workspace_id,project_id,generation,purpose,status,request_hash,max_micros,created_at)
  VALUES(?,?,?,?,?,?,?,?,?)`)
  .bind(input.id,input.workspaceId,input.projectId,0,input.purpose,'active',hash,input.maxMicros,Date.now()).run();
 const stored=await env.DB.prepare('SELECT request_hash FROM pipeline_operations WHERE id=?')
  .bind(input.id).first<{request_hash:string}>();
 if(stored?.request_hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 return {operationId:input.id};
}

/** Cancellation is idempotent but cannot masquerade as success for an unknown or completed operation. */
export async function cancelOperation(env:PipelineEnv,id:string){
 await env.DB.batch([
  env.DB.prepare("UPDATE pipeline_operations SET status='cancelled',generation=generation+1,finished_at=? WHERE id=? AND status IN ('active','awaiting_user')")
   .bind(Date.now(),id),
  env.DB.prepare("INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND status='cancelled')")
   .bind('cancel-'+id,id,'cancel',canonical({operationId:id}),id),
 ]);
 const row=await env.DB.prepare('SELECT status FROM pipeline_operations WHERE id=?').bind(id).first<{status:string}>();
 if(!row)throw Error('OPERATION_NOT_FOUND');
 if(row.status!=='cancelled')throw Error('OPERATION_NOT_CANCELLABLE');
 return {operationId:id,status:'cancelling'};
}
