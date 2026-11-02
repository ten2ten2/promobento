import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {workflowInventory} from './workflow-state.ts';
import {boundedControl,settledPool} from './control-batch.ts';
import type {PipelineEnv,Json} from './pipeline-types.ts';

/** Read-only diagnostics: never infer a physical stop from D1 or a timed-out RPC. */
export async function operationRecoverySnapshot(env:PipelineEnv,id:string):Promise<Response>{
 const op=await env.DB.prepare('SELECT id,status,generation FROM pipeline_operations WHERE id=?').bind(id).first<Json>();
 if(!op)return new Response(null,{status:404});
 const [rows,costs,notice]=await Promise.all([
  env.DB.prepare('SELECT id,mode,instance,status,started_at,stopped_at,result_json FROM pipeline_attempts WHERE operation_id=? ORDER BY started_at,id').bind(id).all<Json>(),
  env.DB.prepare('SELECT r.id,r.kind,r.reserved_micros,s.actual_micros,s.usage_json FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=? ORDER BY r.id').bind(id).all<Json>(),
  env.DB.prepare("SELECT payload_json FROM pipeline_outbox WHERE operation_id=? AND kind='operation_failure' ORDER BY rowid LIMIT 1").bind(id).first<{payload_json:string}>(),
 ]);
 const stopped=new Map<string,boolean|null>();
 const ids=[...new Set([...rows.results.map(row=>row.id as string),
  ...costs.results.filter(row=>row.kind==='compute').map(row=>row.id as string)])];
 const deadline=Date.now()+3_000;
 await settledPool(ids,4,async attemptId=>{
  let physicallyStopped:boolean|null=null;
  const remaining=deadline-Date.now();
  if(remaining>0)try{physicallyStopped=await boundedControl(env.SHARDS.getByName(attemptId).isStopped(),remaining);}
  catch{ /* An unavailable Shard is unknown, not stopped. */ }
  stopped.set(attemptId,physicallyStopped);
 });
 const attempts=rows.results.map(row=>({...row,physicallyStopped:stopped.get(row.id)??null}));
 const costStates=costs.results.map(row=>row.kind==='compute'?{...row,physicallyStopped:stopped.get(row.id)??null}:row);
 return Response.json({operation:op,workflows:await workflowInventory(env,id),attempts,costs:costStates,
  failure:notice?{...parseCanonicalJson(notice.payload_json) as Json,
   evidenceStored:!!await env.MEDIA.head('operations/'+id+'/failure.json')}:null});
}
