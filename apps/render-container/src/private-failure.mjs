import {canonical} from '@promobento/contracts/canonical';

/** Bounded internal evidence stays behind the attempt-scoped broker, never stdout or public diagnostics. */
export async function savePrivateFailure(error,task,write){
  const clean=value=>String(value??'').replaceAll(task.brokerToken,'[redacted]')
    .replace(/Bearer\s+[^\s"'<>]+/gi,'Bearer [redacted]').slice(0,2048);
  const suffix=task.mode==='shard'?'/shards/'+task.shard.index:task.mode==='audio'?'/audio':'/out';
  const key='renders/'+task.job.renderId+'/attempts/'+task.taskId+suffix+'/private-failure.json';
  const value={kind:'private_render_failure',taskId:task.taskId,name:clean(error.name),message:clean(error.message),
    ...(error.cause?{cause:{name:clean(error.cause.name),code:clean(error.cause.code),message:clean(error.cause.message)}}:{})};
  try{return await write(key,new TextEncoder().encode(canonical(value)),'application/json');}
  catch{return null;} // Evidence delivery must not replace the rendering failure or its recovery path.
}
