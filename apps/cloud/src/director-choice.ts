import {canonical} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import type {PipelineEnv,Json,Operation} from './pipeline-types.ts';

/** Commit a single user decision and its Workflow wake-up atomically. */
export async function chooseDirection(env:PipelineEnv,op:Operation,input:Json){
 const choice={key:input.key,directionsHash:input.directionsHash};
 if(!['fit','amplify','unexpected'].includes(choice.key)||typeof choice.directionsHash!=='string')
  throw Error('DIRECTION_CHOICE_INVALID');
 const hash=digest(choice),id=op.id;
 const row=await env.DB.prepare('SELECT directions_hash,choice_hash FROM pipeline_contexts WHERE operation_id=?')
  .bind(id).first<{directions_hash:string|null;choice_hash:string|null}>();
 if(!row?.directions_hash||row.directions_hash!==choice.directionsHash)throw Error('DIRECTION_CHOICE_INVALID');
 if(row.choice_hash&&row.choice_hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
 const payload=canonical({...choice,operationId:id,generation:op.generation,choiceHash:hash});
 await env.DB.batch([
  env.DB.prepare(`UPDATE pipeline_contexts SET choice=?,choice_hash=?
    WHERE operation_id=? AND directions_hash=? AND (choice_hash IS NULL OR choice_hash=?)
      AND EXISTS(SELECT 1 FROM pipeline_operations o
        WHERE o.id=pipeline_contexts.operation_id AND o.status='awaiting_user' AND o.generation=?)`)
   .bind(choice.key,hash,id,choice.directionsHash,hash,op.generation),
  env.DB.prepare(`INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json)
    SELECT ?,c.operation_id,'direction_choice',? FROM pipeline_contexts c
      JOIN pipeline_operations o ON o.id=c.operation_id
    WHERE c.operation_id=? AND c.choice_hash=? AND c.choice=? AND c.directions_hash=?
      AND o.generation=? AND o.status='awaiting_user'`)
   .bind('direction-'+id,payload,id,hash,choice.key,choice.directionsHash,op.generation),
 ]);
 const current=await env.DB.prepare('SELECT choice_hash FROM pipeline_contexts WHERE operation_id=?')
  .bind(id).first<{choice_hash:string|null}>();
 if(current?.choice_hash!==hash)throw Error(current?.choice_hash?'IDEMPOTENCY_CONFLICT':'DIRECTION_CHOICE_INVALID');
 return {operationId:id,key:choice.key,outboxId:'direction-'+id};
}
