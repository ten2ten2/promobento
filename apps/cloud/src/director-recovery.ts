import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {immutableJson,getJson,rights} from './store.ts';
import {reconcileOperation} from './render-recovery.ts';
import {boundedControl} from './control-batch.ts';
import type {PipelineEnv,Operation,Json} from './pipeline-types.ts';

export const directorFailureCode=(error:unknown)=>error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'DIRECTOR_INTERNAL_ERROR';
const notice=(op:Operation,status:string)=>({operationId:op.id,generation:op.generation,status});

/** Intermediate UI hints are best-effort; the terminal notice is committed to the outbox below. */
export async function directorProgress(env:PipelineEnv,op:Operation,status:string){
 try{await boundedControl(env.OPERATIONS.getByName(op.id).progress(canonical(notice(op,status))),3_000);}catch{}
}

export async function commitCandidate(env:PipelineEnv,op:Operation,key:string,resources:Json[]){
 const payload=canonical(notice(op,'succeeded'));
 const changes=await env.DB.batch([
  env.DB.prepare(`UPDATE pipeline_operations SET status='succeeded',result_key=?,finished_at=?
   WHERE id=? AND generation=? AND status='active'
    AND NOT EXISTS(SELECT 1 FROM json_each(?) resource WHERE NOT EXISTS
      (SELECT 1 FROM pipeline_rights r WHERE r.operation_id=?
        AND r.resource_id=json_extract(resource.value,'$.resourceId')
        AND r.sha256=json_extract(resource.value,'$.sha256') AND r.revoked_at IS NULL))`)
   .bind(key,Date.now(),op.id,op.generation,canonical(resources),op.id),
  env.DB.prepare("INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='succeeded' AND result_key=?)")
   .bind(`operation-progress-${op.id}-${op.generation}-succeeded`,op.id,'operation_progress',payload,op.id,op.generation,key)
 ]);
 if(changes[0]!.meta.changes!==1){
  const previous=await env.DB.prepare("SELECT result_key FROM pipeline_operations WHERE id=? AND generation=? AND status='succeeded'").bind(op.id,op.generation).first<Json>();
  if(!previous){await rights(env,op,resources);throw Error('OPERATION_FENCED');}
  if(previous.result_key!==key)throw Error('CANDIDATE_COMMIT_CONFLICT');
 }
}

/** Internal owner review only; this terminal result is never exposed by the accepted-candidate endpoint. */
export async function getReviewDraft(env:PipelineEnv,id:string):Promise<Json|null>{
 const owner=await env.DB.prepare("SELECT * FROM pipeline_operations WHERE id=? AND status='failed'").bind(id).first<Operation&{result_key:string}>();
 if(!owner||owner.result_key!==`operations/${id}/native-review-draft.json`)return null;
 const draft=await getJson(env,owner.result_key);
 if(draft.kind!=='native_review_draft'||draft.operationId!==id||draft.generation!==owner.generation)throw Error('REVIEW_DRAFT_SCOPE_INVALID');
 return draft;
}

/** Persist first cause + terminal fence before stopping anything; retries only write evidence and clean up. */
export async function failDirector(env:PipelineEnv,op:Operation,code:string,insideWorkflow=false,reviewDraftKey?:string){
 const id=`operation-failure-${op.id}-${op.generation}`,key=reviewDraftKey??`operations/${op.id}/failure.json`;
 const payload=canonical({...notice(op,'failed'),code});
 await env.DB.batch([
  env.DB.prepare("UPDATE pipeline_operations SET status='failed',result_key=COALESCE(result_key,?),finished_at=COALESCE(finished_at,?) WHERE id=? AND generation=? AND status IN ('active','awaiting_user')")
   .bind(key,Date.now(),op.id,op.generation),
  env.DB.prepare("INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='failed')")
   .bind(id,op.id,'operation_failure',payload,op.id,op.generation)
 ]);
 const first=await env.DB.prepare('SELECT payload_json FROM pipeline_outbox WHERE id=?').bind(id).first<Json>();
 const except=insideWorkflow?{kind:'operation' as const,id:op.id}:undefined;
 if(first)await dispatchDirectorFailure(env,{operationId:op.id,payloadJson:first.payload_json},except);
 else{
  const state=await env.DB.prepare('SELECT status FROM pipeline_operations WHERE id=?').bind(op.id).first<Json>();
  if(state?.status==='cancelled')await reconcileOperation(env,op.id,except);
 }
}

export async function dispatchDirectorFailure(env:PipelineEnv,item:Json,exceptWorkflow?:{kind:'operation';id:string}){
 const value=parseCanonicalJson(item.payloadJson) as Json;
 if(value.operationId!==item.operationId||!Number.isSafeInteger(value.generation)||typeof value.code!=='string')throw Error('OUTBOX_SCOPE_INVALID');
 const op=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(item.operationId).first<Json>();
 if(op?.status!=='failed'||op.generation!==value.generation)return;
 await immutableJson(env,`operations/${item.operationId}/failure.json`,{kind:'director_failure',...value});
 await reconcileOperation(env,item.operationId,exceptWorkflow);
}

export async function dispatchDirectorProgress(env:PipelineEnv,item:Json){
 const value=parseCanonicalJson(item.payloadJson) as Json;
 if(value.operationId!==item.operationId)throw Error('OUTBOX_SCOPE_INVALID');
 const op=await env.DB.prepare('SELECT status,generation FROM pipeline_operations WHERE id=?').bind(item.operationId).first<Json>();
 if(value.status!=='succeeded'||op?.status!=='succeeded'||op.generation!==value.generation)return;
 await boundedControl(env.OPERATIONS.getByName(item.operationId).progress(canonical(value)),3_000);
}
