import type {WorkflowStep} from 'cloudflare:workers';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {operation,rights} from './store.ts';
import {renderFailureCode} from './render-recovery.ts';
import type {PipelineEnv,Json,Operation} from './pipeline-types.ts';
import policy from '../../../config/agent-policy.json';

const retryable=new Set(['RENDER_CAPACITY_UNAVAILABLE','RENDER_STARTUP_CONNECTION_LOST','RENDER_DISPATCH_CONNECTION_LOST',
 'RENDER_EXECUTE_CONNECTION_LOST','RENDER_RPC_CONNECTION_LOST']);

/** One durable scheduler, new physical attempts, unchanged generation/deadline/budget. */
export async function runRenderTask(env:PipelineEnv,step:WorkflowStep,
 context:{renderId:string;op:Operation;job:Json;imageDigest:string;deadlineAt:number},
 task:{name:string;mode:string;instance:string;additions:Json}):Promise<Json>{
 const {renderId,op,job,imageDigest,deadlineAt}=context,{name,mode,instance,additions}=task;
 let lastCode='RENDER_INTERNAL_ERROR';
 for(let index=0;index<policy.limits.maxRenderAttempts;index++){
  const attemptName=index?name+'-retry-'+index:name;
  if(index){
   const waitMs=index===1?15000:60000;
   if(Date.now()+waitMs>=deadlineAt)throw Error('RENDER_DEADLINE');
   await operation(env,op.id,op.generation);
   await step.sleep(attemptName+'-backoff',index===1?'15 seconds':'60 seconds');
  }
  // Original step names and successful canonical-text results remain replay-compatible.
  const attemptId=await step.do(attemptName+'-id',async()=>crypto.randomUUID());
  const result=parseCanonicalJson(await step.do(attemptName,{retries:{limit:0,delay:'1 second'},timeout:'10 minutes'},async()=>{
   if(Date.now()>=deadlineAt)throw Error('RENDER_DEADLINE');
   await operation(env,op.id,op.generation);await rights(env,op,job.resources);
   const payload={schemaVersion:'3.0.0',kind:'render_task',taskId:attemptId,mode,instance,generation:op.generation,deadlineAt,imageDigest,job,...additions};
   await env.DB.prepare("INSERT OR IGNORE INTO pipeline_attempts(id,render_id,operation_id,generation,mode,shard_index,instance,status,started_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id WHERE r.id=? AND r.operation_id=? AND r.generation=? AND r.status NOT IN ('passed','blocked','cancelled') AND o.status='active' AND o.generation=?)")
    .bind(attemptId,renderId,op.id,op.generation,mode,additions.shard?.index??null,instance,'active',Date.now(),renderId,op.id,op.generation,op.generation).run();
   const admitted=await env.DB.prepare("SELECT a.id FROM pipeline_attempts a JOIN pipeline_renders r ON r.id=a.render_id WHERE a.id=? AND a.render_id=? AND a.operation_id=? AND a.generation=? AND a.stopped_at IS NULL AND r.status NOT IN ('passed','blocked','cancelled')")
    .bind(attemptId,renderId,op.id,op.generation).first();
   if(!admitted)throw Error('RENDER_FENCED');
   const compute=env.SHARDS.getByName(attemptId);
   try{
    const value=parseCanonicalJson(await compute.execute(canonical(payload))) as Json;
    if(!await compute.isStopped())throw Error('COMPUTE_STOP_UNCONFIRMED');
    await env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=? WHERE id=?')
     .bind('succeeded',Date.now(),canonical(value),attemptId).run();return canonical(value);
   }catch(error){
    const code=String((error as {message?:unknown})?.message??error)==='Network connection lost.'?'RENDER_RPC_CONNECTION_LOST':renderFailureCode(error);
    let confirmed=false;
    try{
     await compute.stopAndSettle();if(!await compute.isStopped())throw Error('COMPUTE_STOP_UNCONFIRMED');
     const pending=await env.DB.prepare('SELECT r.id FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.id=? AND s.reservation_id IS NULL').bind(attemptId).first();
     if(pending)throw Error('COMPUTE_SETTLEMENT_UNCONFIRMED');
     await env.DB.prepare('UPDATE pipeline_attempts SET status=?,stopped_at=?,result_json=COALESCE(result_json,?) WHERE id=?')
      .bind('failed',Date.now(),canonical({status:'failed',code}),attemptId).run();confirmed=true;
    }catch{ /* Preserve first cause. Unknown stop/usage never admits another physical attempt. */ }
    if(!confirmed||!retryable.has(code))throw code==='RENDER_RPC_CONNECTION_LOST'?Error(code):error;
    // Persist this failed attempt as data so Workflow replay cannot repeat its execution or budget.
    return canonical({kind:'render_platform_retry',code,attemptId});
   }
  })) as Json;
  if(result.kind!=='render_platform_retry')return result;
  lastCode=result.code;
 }
 throw Error(lastCode);
}
