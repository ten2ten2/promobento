import {canonical} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {operation, immutableJson, rights} from './store.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';
/** All callers are already authenticated internal code; the generation fence is still a DB predicate. */
export async function enqueueRender(env: PipelineEnv, input: Json, generation: number) {
  const op=await operation(env,input.job.operationId,generation);await rights(env,op,input.job.resources);
  const hash=digest(input),existing=await env.DB.prepare('SELECT request_hash FROM pipeline_renders WHERE id=?').bind(input.job.renderId).first<Json>();
  if(existing){if(existing.request_hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');return input.job.renderId;}
  const object=await immutableJson(env,`renders/${input.job.renderId}/input.json`,input),id='render-'+input.job.renderId;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')")
      .bind(input.job.renderId,op.id,generation,hash,object.key,'queued',Date.now(),op.id,generation),
    env.DB.prepare('INSERT INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders WHERE id=?)')
      .bind(id,op.id,'render',canonical({renderId:input.job.renderId}),input.job.renderId)
  ]);
  await env.OUTBOX.send({id,kind:'render',operationId:op.id,payloadJson:canonical({renderId:input.job.renderId})});
  await env.DB.prepare('UPDATE pipeline_outbox SET delivered_at=? WHERE id=?').bind(Date.now(),id).run();return input.job.renderId;
}
