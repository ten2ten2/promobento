import {PROTOCOL_VERSION} from './version.ts';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import {assertRenderJob, assertRenderTask, planShards} from '@promobento/contracts/render';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {operation, rights, readJson, immutableJson, getJson} from './store.ts';
import {validId, type PipelineEnv, type Json} from './pipeline-types.ts';
export {Broker, ShardDO, CoordinatorDO, OperationDO} from './compute.ts';
export {OperationWorkflow} from './director.ts';
export {RenderWorkflow} from './render-workflow.ts';

function authorized(request: Request, env: PipelineEnv) {
  if (env.S1_ENABLED !== 'internal_eval' || !env.EVAL_API_KEY) return false;
  const a = new TextEncoder().encode(request.headers.get('authorization') ?? ''), b = new TextEncoder().encode('Bearer ' + env.EVAL_API_KEY);
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) difference |= (a[i] ?? 0) ^ b[i]!;
  return difference === 0;
}
async function flush(env: PipelineEnv) {
  const rows = await env.DB.prepare('SELECT * FROM pipeline_outbox WHERE delivered_at IS NULL ORDER BY rowid LIMIT 100').all<Json>();
  for (const row of rows.results) {
    await env.OUTBOX.send({id: row.id, kind: row.kind, operationId: row.operation_id, payloadJson: row.payload_json});
    await env.DB.prepare('UPDATE pipeline_outbox SET delivered_at=? WHERE id=? AND delivered_at IS NULL').bind(Date.now(), row.id).run();
  }
}

export default {
  async fetch(request: Request, env: PipelineEnv, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/healthz') return Response.json({ok: true, protocol: PROTOCOL_VERSION});
    if (!path.startsWith('/internal/s1/') || !authorized(request, env)) return new Response('Not found', {status: 404});
    try {
      if(request.method==='GET'&&path==='/internal/s1/capacity')return Response.json(await env.COORDINATOR.getByName('global-v1').counts());
      if(request.method==='GET'&&path.startsWith('/internal/s1/artifacts/')){
        const key=decodeURIComponent(path.slice('/internal/s1/artifacts/'.length));let owner:Json|null=null,resources:Json[]=[];
        if(key.startsWith('renders/')){
          const renderId=key.split('/')[1];
          const render=await env.DB.prepare("SELECT * FROM pipeline_renders WHERE id=? AND status='passed'").bind(renderId).first<Json>();
          const result=render?.result_json?parseCanonicalJson(render.result_json) as Json:null;
          if(!result?.outputs.some((output:Json)=>output.key===key))return new Response(null,{status:404});
          owner=await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(render!.operation_id).first<Json>();
          if(owner?.generation!==render!.generation)return new Response(null,{status:404});
          resources=(await getJson(env,render!.job_key)).job.resources;
        }else if(key.startsWith('operations/')){
          const id=key.split('/')[1],context=await env.DB.prepare('SELECT * FROM pipeline_contexts WHERE operation_id=?').bind(id).first<Json>();
          const previews=context?.previews_key?await getJson(env,context.previews_key) as unknown as Json[]:[];
          if(!previews.some(preview=>preview.key===key))return new Response(null,{status:404});
          owner=await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(id).first<Json>();
          resources=(await getJson(env,context!.request_key)).resources;
        }
        if(!owner||!['active','awaiting_user','succeeded'].includes(owner.status))return new Response(null,{status:404});
        await rights(env,owner as any,resources);const object=await env.MEDIA.get(key);if(!object)return new Response(null,{status:404});
        return new Response(object.body,{headers:{'content-type':object.httpMetadata?.contentType??'application/octet-stream','cache-control':'private, no-store'}});
      }
      if (request.method === 'POST' && path === '/internal/s1/operations') {
        const input = await readJson(request);
        if (!validId(input.id) || !validId(input.workspaceId) || !validId(input.projectId) || !['evaluation','calibration'].includes(input.purpose)
          || !Number.isSafeInteger(input.maxMicros) || input.maxMicros < 1 || input.maxMicros > 10000000) throw Error('OPERATION_INVALID');
        const hash = digest(input), existing = await env.DB.prepare('SELECT request_hash FROM pipeline_operations WHERE id=?').bind(input.id).first<Json>();
        if (existing && existing.request_hash !== hash) throw Error('IDEMPOTENCY_CONFLICT');
        if (!existing) await env.DB.prepare('INSERT INTO pipeline_operations(id,workspace_id,project_id,generation,purpose,status,request_hash,max_micros,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .bind(input.id,input.workspaceId,input.projectId,0,input.purpose,'active',hash,input.maxMicros,Date.now()).run();
        return Response.json({operationId: input.id});
      }
      if (request.method === 'POST' && path === '/internal/s1/rights') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        if (!/^res_[A-Za-z0-9_-]{4,64}$/.test(input.resourceId) || !/^[a-f0-9]{64}$/.test(input.sha256)
          || typeof input.licenseRef !== 'string' || input.scope !== 'internal_eval_only') throw Error('RIGHTS_INVALID');
        const evidence = await getJson(env, input.evidenceKey);
        if (evidence.resourceId !== input.resourceId || evidence.sha256 !== input.sha256 || evidence.licenseRef !== input.licenseRef
          || evidence.scope !== input.scope || evidence.approvedBy !== 'owner' || !evidence.source || !evidence.basis) throw Error('RIGHTS_EVIDENCE_INVALID');
        await env.DB.prepare('INSERT INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)')
          .bind(op.id,input.resourceId,input.sha256,input.licenseRef,input.evidenceKey,input.scope).run();
        return new Response(null, {status: 201});
      }
      if (request.method === 'POST' && path === '/internal/s1/releases') {
        const input = await readJson(request);
        input.imageDigest = await env.SHARDS.getByName('release-metadata').imageDigest();
        if (!validId(input.id) || typeof input.runtimeVersion !== 'string' || typeof input.environmentKey !== 'string') throw Error('RELEASE_INVALID');
        const previous = await env.DB.prepare('SELECT * FROM renderer_releases WHERE id=?').bind(input.id).first<Json>();
        if (previous && (previous.image_digest !== input.imageDigest || previous.runtime_version !== input.runtimeVersion)) throw Error('IMMUTABLE_RELEASE_CONFLICT');
        if (!previous) await env.DB.prepare('INSERT INTO renderer_releases(id,image_digest,runtime_version,environment_key,status) VALUES(?,?,?,?,?)')
          .bind(input.id,input.imageDigest,input.runtimeVersion,input.environmentKey,'active').run();
        return new Response(null, {status: 201});
      }
      if (request.method === 'PUT' && path.startsWith('/internal/s1/objects/')) {
        const key = path.slice('/internal/s1/objects/'.length);
        if (!/^evals\/[A-Za-z0-9_/-]{4,240}\.[a-z0-9]{2,8}$/.test(key) || key.split('/').some(part => part === '..')) throw Error('OBJECT_KEY_INVALID');
        const length = Number(request.headers.get('content-length')); if (!Number.isSafeInteger(length) || length < 1 || length > 50 << 20) throw Error('OBJECT_TOO_LARGE');
        const bytes = new Uint8Array(await request.arrayBuffer()); if (bytes.length !== length) throw Error('OBJECT_LENGTH_MISMATCH');
        const hash = sha256Bytes(bytes), old = await env.MEDIA.head(key);
        if (old && old.customMetadata?.sha256 !== hash) throw Error('IMMUTABLE_OBJECT_CONFLICT');
        if (!old) await env.MEDIA.put(key,bytes,{onlyIf:new Headers({'If-None-Match':'*'}),customMetadata:{sha256:hash},httpMetadata:{contentType:request.headers.get('content-type')??'application/octet-stream'}});
        return Response.json({key,sha256:hash,byteLength:bytes.length});
      }
      if (request.method === 'POST' && path === '/internal/s1/creative') {
        const input=await readJson(request),op=await operation(env,input.operationId);
        if(typeof input.contextKey!=='string'||!input.contextKey.startsWith('evals/'))throw Error('DIRECTOR_CONTEXT_INVALID');
        const previous=await env.DB.prepare('SELECT request_key FROM pipeline_contexts WHERE operation_id=?').bind(op.id).first<Json>();
        if(previous&&previous.request_key!==input.contextKey)throw Error('IDEMPOTENCY_CONFLICT');
        const id='creative-'+op.id;
        await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO pipeline_contexts(operation_id,request_key) VALUES(?,?)').bind(op.id,input.contextKey),
          env.DB.prepare('INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) VALUES(?,?,?,?)').bind(id,op.id,'creative',canonical({operationId:op.id}))]);
        ctx.waitUntil(flush(env));return Response.json({operationId:op.id},{status:202});
      }
      const direction=/^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/direction$/.exec(path);
      if(direction&&request.method==='POST'){
        const id=direction[1]!,input=await readJson(request),row=await env.DB.prepare('SELECT * FROM pipeline_contexts WHERE operation_id=?').bind(id).first<Json>();
        if(!row||row.directions_hash!==input.directionsHash||!['fit','amplify','unexpected'].includes(input.key))throw Error('DIRECTION_CHOICE_INVALID');
        const hash=digest(input);if(row.choice_hash&&row.choice_hash!==hash)throw Error('IDEMPOTENCY_CONFLICT');
        await env.DB.prepare('UPDATE pipeline_contexts SET choice=?,choice_hash=? WHERE operation_id=? AND (choice_hash IS NULL OR choice_hash=?)').bind(input.key,hash,id,hash).run();
        const workflow=await env.OPERATION_WORKFLOW.get(id);await workflow.sendEvent({type:'direction-choice',payload:input});
        return Response.json({operationId:id,key:input.key});
      }
      const contextRoute=/^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if(contextRoute&&request.method==='GET'){
        const row=await env.DB.prepare('SELECT o.*,c.directions_key,c.directions_hash,c.previews_key,c.choice FROM pipeline_operations o LEFT JOIN pipeline_contexts c ON c.operation_id=o.id WHERE o.id=?').bind(contextRoute[1]).first<Json>();
        if(!row)return new Response(null,{status:404});
        return Response.json({...row,...(row.directions_key?{directions:await getJson(env,row.directions_key),previews:await getJson(env,row.previews_key)}:{})});
      }
      if (request.method === 'POST' && path === '/internal/s1/renders') {
        const input = await readJson(request); assertRenderJob(input.job);
        if (input.job.quality === 'still') throw Error('USE_STUDIO_FOR_STILLS');
        const op = await operation(env,input.job.operationId), hash = digest(input);
        const existing = await env.DB.prepare('SELECT request_hash FROM pipeline_renders WHERE id=?').bind(input.job.renderId).first<Json>();
        if (existing) {if (existing.request_hash !== hash) throw Error('IDEMPOTENCY_CONFLICT'); return Response.json({renderId:input.job.renderId});}
        await rights(env,op,input.job.resources);
        const raw = await getJson(env,input.inputs.find((object:Json)=>object.name==='film')?.key);
        if (filmSourceHash(canonical(raw)) !== input.job.sourceHash) throw Error('SOURCE_IDENTITY_MISMATCH');
        const shards = planShards(input.job,raw,{seed:input.options.seed}).shards;
        // Validate exact private transport before scheduling any paid compute; rights still come from D1.
        assertRenderTask({schemaVersion:'3.0.0',kind:'render_task',taskId:crypto.randomUUID(),brokerToken:crypto.randomUUID(),
          mode:'shard',instance:shards[0]!.instance,job:input.job,options:input.options,inputs:input.inputs,shard:shards[0]});
        assertRenderTask({schemaVersion:'3.0.0',kind:'render_task',taskId:crypto.randomUUID(),brokerToken:crypto.randomUUID(),
          mode:'audio',instance:'standard-1',job:input.job,inputs:input.audioInputsBlobs,audioInputs:input.audioInputs});
        const object = await immutableJson(env,`renders/${input.job.renderId}/input.json`,input), outboxId='render-'+input.job.renderId;
        await env.DB.batch([
          env.DB.prepare('INSERT INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status=\'active\')')
            .bind(input.job.renderId,op.id,op.generation,hash,object.key,'queued',Date.now(),op.id,op.generation),
          env.DB.prepare('INSERT INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders WHERE id=?)')
            .bind(outboxId,op.id,'render',canonical({renderId:input.job.renderId}),input.job.renderId)
        ]);
        ctx.waitUntil(flush(env)); return Response.json({renderId:input.job.renderId},{status:202});
      }
      if (request.method === 'POST' && path === '/internal/s1/studio') {
        const input = await readJson(request), op = await operation(env, input.job?.operationId);
        if (input.mode !== 'studio' || input.job.quality !== 'still' || input.instance !== 'standard-3') throw Error('STUDIO_SCOPE_INVALID');
        assertRenderTask({...input, brokerToken: crypto.randomUUID()}); await rights(env,op,input.job.resources);
        const release = await env.DB.prepare("SELECT image_digest FROM renderer_releases WHERE id=? AND status='active'").bind(input.job.rendererRelease).first<Json>();
        if (!release) throw Error('RENDER_ENVIRONMENT_MISMATCH');
        const result = await env.OPERATIONS.getByName(op.id).studio(op.id,canonical({...input,generation:op.generation,imageDigest:release.image_digest}));
        return Response.json(parseCanonicalJson(result));
      }
      const studioFrame = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/frames\/(\d+)$/.exec(path);
      if (request.method === 'GET' && studioFrame) return env.OPERATIONS.getByName(studioFrame[1]!).frame(studioFrame[1]!,Number(studioFrame[2]));
      const events = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/events$/.exec(path);
      if (request.method === 'GET' && events) return env.OPERATIONS.getByName(events[1]!).watch(events[1]!);
      const render = /^\/internal\/s1\/renders\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if (request.method === 'GET' && render) {
        const row=await env.DB.prepare('SELECT id,status,result_json FROM pipeline_renders WHERE id=?').bind(render[1]).first<Json>();
        return row ? Response.json(row) : new Response(null,{status:404});
      }
      const cancel = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/cancel$/.exec(path);
      if (request.method === 'POST' && cancel) {
        const id=cancel[1]!;
        await env.DB.batch([
          env.DB.prepare("UPDATE pipeline_operations SET status='cancelled',generation=generation+1,finished_at=? WHERE id=? AND status IN ('active','awaiting_user')").bind(Date.now(),id),
          env.DB.prepare('INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND status=\'cancelled\')')
            .bind('cancel-'+id,id,'cancel',canonical({operationId:id}),id)
        ]);ctx.waitUntil(flush(env));return Response.json({operationId:id,status:'cancelling'});
      }
      return new Response('Not found',{status:404});
    } catch(error) {
      const code=error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'PIPELINE_REQUEST_INVALID';
      return Response.json({code},{status:code.includes('CONFLICT')?409:422});
    }
  },
  async scheduled(_event: ScheduledController,env:PipelineEnv,ctx:ExecutionContext){if(env.S1_ENABLED==='internal_eval')ctx.waitUntil(flush(env));},
  async queue(batch:MessageBatch<Json>,env:PipelineEnv){
    for(const message of batch.messages){
      try{
        const item=message.body;
        if(item.kind==='render'){
          const row=await env.DB.prepare('SELECT id FROM pipeline_renders WHERE id=?').bind(item.id.slice('render-'.length)).first<Json>();
          if(!row)throw Error('OUTBOX_SCOPE_INVALID');
          try{await env.RENDER_WORKFLOW.create({id:row.id,params:{renderId:row.id}});}catch(error){
            const instance=await env.RENDER_WORKFLOW.get(row.id);await instance.status();
          }
        }else if(item.kind==='creative'){
          try{await env.OPERATION_WORKFLOW.create({id:item.operationId,params:{operationId:item.operationId}});}catch{await(await env.OPERATION_WORKFLOW.get(item.operationId)).status();}
        }else if(item.kind==='cancel'){
          const rows=await env.DB.prepare('SELECT id FROM pipeline_attempts WHERE operation_id=? AND stopped_at IS NULL').bind(item.operationId).all<{id:string}>();
          await Promise.all(rows.results.map(row=>env.SHARDS.getByName(row.id).stopAndSettle()));
          await env.OPERATIONS.getByName(item.operationId).closeStudio();
        }else throw Error('OUTBOX_KIND_INVALID');
        message.ack();
      }catch{message.retry();}
    }
  }
} satisfies ExportedHandler<PipelineEnv, Json>;
