import {PROTOCOL_VERSION} from './version.ts';
import {directingMethodPack, directingMethodRef} from '../../../packages/methods/directing.ts';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import {operation, rights, readJson, immutableJson, getJson} from './store.ts';
import {reconcileOperation, dispatchRender, dispatchRenderProgress} from './render-recovery.ts';
import {dispatchDirectorFailure, dispatchDirectorProgress, getReviewDraft} from './director-recovery.ts';
import {importModelOpening, confirmModelOpening, modelBudgetStatus} from './model-budget.ts';
import {workflowInventory} from './workflow-state.ts';
import {dispatchCreative, recoverWorkflows} from './workflow-recovery.ts';
import {saveNativeProject, loadNativeProject, createNativeRender, NATIVE_COMMIT} from './native-project.ts';
import {flushOutbox} from './outbox.ts';
import {validId, type PipelineEnv, type Json, type Operation} from './pipeline-types.ts';
export {Broker, ShardDO, CoordinatorDO, OperationDO} from './compute.ts';
export {OperationWorkflow} from './director.ts';
export {RenderWorkflow} from './render-workflow.ts';

function authorized(request: Request, env: PipelineEnv) {
  if (env.S1_ENABLED !== 'internal_eval' || !env.EVAL_API_KEY) return false;
  const a = new TextEncoder().encode(request.headers.get('authorization') ?? ''), b = new TextEncoder().encode('Bearer ' + env.EVAL_API_KEY);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index++) difference |= (a[index] ?? 0) ^ b[index]!;
  return difference === 0;
}

/** Internal authenticated reads retain historical artifact ownership and cancellation fences. */
async function artifact(env: PipelineEnv, key: string) {
  let owner: Json | null = null, resources: Json[] = [], native = false;
  if (key.startsWith('renders/')) {
    const row = await env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=? AND status=\'passed\'').bind(key.split('/')[1]).first<Json>();
    const result = row?.result_json ? parseCanonicalJson(row.result_json) as Json : null;
    if (!result?.outputs?.some((output: Json) => output.key === key)) return new Response(null, {status: 404});
    owner = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(row!.operation_id).first<Json>();
    if (owner?.generation !== row!.generation) return new Response(null, {status: 404});
    const input = await getJson(env, row!.job_key);
    native = input.kind === 'native_render_request';
    resources = native ? input.project.resources ?? [] : input.job.resources;
  } else if (key.startsWith('operations/')) {
    const id = key.split('/')[1];
    const context = await env.DB.prepare('SELECT * FROM pipeline_contexts WHERE operation_id=?').bind(id).first<Json>();
    const previews = context?.previews_key ? await getJson(env, context.previews_key) as unknown as Json[] : [];
    if (!previews.some(preview => preview.key === key)) return new Response(null, {status: 404});
    owner = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(id).first<Json>();
    const request = await getJson(env, context!.request_key);
    resources = request.resources ?? [];
  }
  if (owner?.status === 'failed') {
    const draft = await getReviewDraft(env, owner.id);
    const outputs = draft?.kind === 'native_review_draft'
      ? (draft.renders ?? []).flatMap((entry: Json) => entry.result?.outputs ?? [])
      : (draft?.movies ?? []).flatMap((entry: Json) => entry.movie?.outputs ?? []);
    if (!outputs.some((output: Json) => output.key === key)) return new Response(null, {status: 404});
  } else if (!owner || !['active', 'awaiting_user', 'succeeded'].includes(owner.status)) return new Response(null, {status: 404});
  if (!native) await rights(env, owner as Operation, resources);
  const object = await env.MEDIA.get(key);
  if (!object) return new Response(null, {status: 404});
  const mediaType = object.httpMetadata?.contentType ?? 'application/octet-stream';
  const headers: Record<string, string> = {'content-type': mediaType, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff'};
  if (!['video/mp4', 'image/png', 'image/jpeg', 'audio/wav', 'audio/mpeg'].includes(mediaType.split(';')[0]!))
    headers['content-security-policy'] = "default-src 'none'; sandbox";
  return new Response(object.body, {headers});
}

export default {
  async fetch(request: Request, env: PipelineEnv, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/healthz') return Response.json({ok: true, protocol: PROTOCOL_VERSION, runtime: 'huashu-motion', nativeCommit: NATIVE_COMMIT});
    if (!path.startsWith('/internal/s1/') || !authorized(request, env)) return new Response('Not found', {status: 404});
    try {
      if (request.method === 'GET' && path === '/internal/s1/capacity') return Response.json(await env.COORDINATOR.getByName('global-v1').counts());
      if (path === '/internal/s1/model-budget' && request.method === 'GET') return Response.json(await modelBudgetStatus(env));
      if (path === '/internal/s1/model-budget/import' && request.method === 'POST') return Response.json(await importModelOpening(env, await readJson(request)));
      if (path === '/internal/s1/model-budget/confirm' && request.method === 'POST') {
        const input = await readJson(request);
        if (typeof input.evidenceKey !== 'string' || !input.evidenceKey.startsWith('evals/')) throw Error('MODEL_CONFIRMATION_INVALID');
        return Response.json(await confirmModelOpening(env, await getJson(env, input.evidenceKey)));
      }
      if (path === '/internal/s1/workflows/reconcile' && request.method === 'POST') return Response.json(await recoverWorkflows(env));
      if (request.method === 'GET' && path.startsWith('/internal/s1/artifacts/')) return artifact(env, decodeURIComponent(path.slice('/internal/s1/artifacts/'.length)));
      if (request.method === 'POST' && path === '/internal/s1/operations') {
        const input = await readJson(request);
        if (!validId(input.id) || !validId(input.workspaceId) || !validId(input.projectId) || !['evaluation', 'calibration'].includes(input.purpose)
          || !Number.isSafeInteger(input.maxMicros) || input.maxMicros < 1 || input.maxMicros > 10000000) throw Error('OPERATION_INVALID');
        const hash = digest(input), existing = await env.DB.prepare('SELECT request_hash FROM pipeline_operations WHERE id=?').bind(input.id).first<Json>();
        if (existing && existing.request_hash !== hash) throw Error('IDEMPOTENCY_CONFLICT');
        if (!existing) await env.DB.prepare('INSERT INTO pipeline_operations(id,workspace_id,project_id,generation,purpose,status,request_hash,max_micros,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .bind(input.id, input.workspaceId, input.projectId, 0, input.purpose, 'active', hash, input.maxMicros, Date.now()).run();
        return Response.json({operationId: input.id});
      }
      // Existing evidence can still be recorded/read; this is not a new native animation protocol.
      if (request.method === 'POST' && path === '/internal/s1/rights') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        if (!/^res_[A-Za-z0-9_-]{4,64}$/.test(input.resourceId) || !/^[a-f0-9]{64}$/.test(input.sha256)
          || typeof input.licenseRef !== 'string' || input.scope !== 'internal_eval_only') throw Error('RIGHTS_INVALID');
        const evidence = await getJson(env, input.evidenceKey);
        if (evidence.resourceId !== input.resourceId || evidence.sha256 !== input.sha256 || evidence.licenseRef !== input.licenseRef
          || evidence.scope !== input.scope || evidence.approvedBy !== 'owner' || !evidence.source || !evidence.basis) throw Error('RIGHTS_EVIDENCE_INVALID');
        await env.DB.prepare('INSERT INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)')
          .bind(op.id, input.resourceId, input.sha256, input.licenseRef, input.evidenceKey, input.scope).run();
        return new Response(null, {status: 201});
      }
      const releaseRoute = /^\/internal\/s1\/releases\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if (releaseRoute && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT * FROM renderer_releases WHERE id=?').bind(releaseRoute[1]).first<Json>();
        if (!row) return new Response(null, {status: 404});
        return Response.json({...row, currentImageDigest: await env.SHARDS.getByName('release-metadata').imageDigest()});
      }
      if (request.method === 'POST' && path === '/internal/s1/releases') {
        const input = await readJson(request);
        if (!validId(input.id) || input.runtimeVersion !== NATIVE_COMMIT || typeof input.environmentKey !== 'string') throw Error('RELEASE_INVALID');
        input.imageDigest = await env.SHARDS.getByName('release-metadata').imageDigest();
        const previous = await env.DB.prepare('SELECT * FROM renderer_releases WHERE id=?').bind(input.id).first<Json>();
        if (previous && (previous.image_digest !== input.imageDigest || previous.runtime_version !== input.runtimeVersion
          || previous.environment_key !== input.environmentKey)) throw Error('IMMUTABLE_RELEASE_CONFLICT');
        if (!previous) await env.DB.prepare('INSERT INTO renderer_releases(id,image_digest,runtime_version,environment_key,status) VALUES(?,?,?,?,?)')
          .bind(input.id, input.imageDigest, input.runtimeVersion, input.environmentKey, 'active').run();
        return new Response(null, {status: 201});
      }
      if (request.method === 'PUT' && path.startsWith('/internal/s1/objects/')) {
        const key = path.slice('/internal/s1/objects/'.length);
        if (!/^evals\/[A-Za-z0-9_/-]{4,240}\.[a-z0-9]{2,8}$/.test(key) || key.split('/').some(part => part === '..')) throw Error('OBJECT_KEY_INVALID');
        const declared = request.headers.get('content-length'), length = Number(declared);
        if (declared === null || !Number.isSafeInteger(length) || length < 0 || length > 50 << 20) throw Error('OBJECT_TOO_LARGE');
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length !== length) throw Error('OBJECT_LENGTH_MISMATCH');
        const hash = sha256Bytes(bytes), old = await env.MEDIA.head(key), mediaType = request.headers.get('content-type') ?? 'application/octet-stream';
        if (old && old.customMetadata?.sha256 !== hash) throw Error('IMMUTABLE_OBJECT_CONFLICT');
        if (!old) await env.MEDIA.put(key, bytes, {onlyIf: new Headers({'If-None-Match': '*'}), customMetadata: {sha256: hash},
          httpMetadata: {contentType: mediaType}});
        return Response.json({key, sha256: hash, byteLength: bytes.length, mediaType});
      }
      if (request.method === 'POST' && path === '/internal/s1/native/projects') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        return Response.json(await saveNativeProject(env, op, input as any), {status: 201});
      }
      const projectRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/projects\/([a-f0-9]{64})$/.exec(path);
      if (request.method === 'GET' && projectRoute) {
        const op = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=? AND status IN (\'active\',\'awaiting_user\',\'succeeded\')')
          .bind(projectRoute[1]).first<Operation>();
        if (!op) return new Response(null, {status: 404});
        return Response.json(await loadNativeProject(env, op, projectRoute[2]!), {headers: {'cache-control': 'private, no-store'}});
      }
      if (request.method === 'POST' && path === '/internal/s1/renders') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        return Response.json(await createNativeRender(env, op, input as any), {status: 202});
      }
      if (request.method === 'POST' && path === '/internal/s1/creative') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        if (typeof input.contextKey !== 'string' || !input.contextKey.startsWith('evals/')) throw Error('DIRECTOR_CONTEXT_INVALID');
        const previous = await env.DB.prepare('SELECT request_key,engine FROM pipeline_contexts WHERE operation_id=?').bind(op.id).first<Json>();
        if (previous && previous.engine !== 'huashu') throw Error('LEGACY_WORKFLOW_REQUIRES_RECONCILIATION');
        if (previous && previous.request_key !== input.contextKey) throw Error('IDEMPOTENCY_CONFLICT');
        const method = previous ? null : await immutableJson(env, 'operations/' + op.id + '/directing-method-' + directingMethodRef(directingMethodPack).contentHash + '.json', directingMethodPack);
        await env.DB.batch([
          env.DB.prepare('INSERT OR IGNORE INTO pipeline_contexts(operation_id,request_key,directing_method_key,engine) VALUES(?,?,?,\'huashu\')').bind(op.id, input.contextKey, method?.key ?? null),
          env.DB.prepare('INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) VALUES(?,?,?,?)').bind('creative-' + op.id, op.id, 'creative', canonical({operationId: op.id, engine: 'huashu'})),
        ]);
        ctx.waitUntil(flushOutbox(env));
        return Response.json({operationId: op.id}, {status: 202});
      }
      const direction = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/direction$/.exec(path);
      if (direction && request.method === 'POST') {
        const id = direction[1]!, input = await readJson(request);
        await operation(env, id);
        const row = await env.DB.prepare('SELECT * FROM pipeline_contexts WHERE operation_id=?').bind(id).first<Json>();
        if (!row || row.directions_hash !== input.directionsHash || !['fit', 'amplify', 'unexpected'].includes(input.key)) throw Error('DIRECTION_CHOICE_INVALID');
        const hash = digest(input);
        if (row.choice_hash && row.choice_hash !== hash) throw Error('IDEMPOTENCY_CONFLICT');
        await env.DB.prepare('UPDATE pipeline_contexts SET choice=?,choice_hash=? WHERE operation_id=? AND (choice_hash IS NULL OR choice_hash=?)').bind(input.key, hash, id, hash).run();
        await (await env.OPERATION_WORKFLOW.get(id)).sendEvent({type: 'direction-choice', payload: input});
        return Response.json({operationId: id, key: input.key});
      }
      const candidateRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/candidate$/.exec(path);
      if (candidateRoute && request.method === 'GET') {
        const owner = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=? AND status=\'succeeded\'').bind(candidateRoute[1]).first<Json>();
        if (!owner?.result_key) return new Response(null, {status: 404});
        const candidate = await getJson(env, owner.result_key);
        if (!['native_candidate', 's1_internal_candidate'].includes(candidate.kind) || candidate.operationId !== owner.id) throw Error('CANDIDATE_SCOPE_INVALID');
        if (candidate.kind !== 'native_candidate') {
          const context = await env.DB.prepare('SELECT request_key FROM pipeline_contexts WHERE operation_id=?').bind(owner.id).first<Json>();
          if (!context) return new Response(null, {status: 404});
          const input = await getJson(env, context.request_key);
          await rights(env, owner as Operation, [...input.resources, ...(input.audioSources ?? [])]);
        }
        return Response.json(candidate, {headers: {'cache-control': 'private, no-store'}});
      }
      const reviewRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/review-draft$/.exec(path);
      if (reviewRoute && request.method === 'GET') {
        const draft = await getReviewDraft(env, reviewRoute[1]!);
        return draft ? Response.json(draft, {headers: {'cache-control': 'private, no-store'}}) : new Response(null, {status: 404});
      }
      const contextRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if (contextRoute && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT o.*,c.directions_key,c.directions_hash,c.previews_key,c.choice FROM pipeline_operations o LEFT JOIN pipeline_contexts c ON c.operation_id=o.id WHERE o.id=?').bind(contextRoute[1]).first<Json>();
        if (!row) return new Response(null, {status: 404});
        return Response.json({...row, workflows: await workflowInventory(env, row.id),
          ...(row.directions_key ? {directions: await getJson(env, row.directions_key)} : {}),
          ...(row.previews_key ? {previews: await getJson(env, row.previews_key)} : {})});
      }
      const recoveryRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/recovery$/.exec(path);
      if (recoveryRoute && request.method === 'GET') {
        const id = recoveryRoute[1]!, op = await env.DB.prepare('SELECT id,status,generation FROM pipeline_operations WHERE id=?').bind(id).first<Json>();
        if (!op) return new Response(null, {status: 404});
        const rows = await env.DB.prepare('SELECT id,mode,shard_index,instance,status,started_at,stopped_at,result_json FROM pipeline_attempts WHERE operation_id=? ORDER BY started_at,id').bind(id).all<Json>();
        const stopped = new Map<string, boolean | null>();
        const attempts = await Promise.all(rows.results.map(async row => {
          const physicallyStopped = await env.SHARDS.getByName(row.id).isStopped().catch(() => null);
          stopped.set(row.id, physicallyStopped); return {...row, physicallyStopped};
        }));
        const costs = await env.DB.prepare('SELECT r.id,r.kind,r.reserved_micros,s.actual_micros,s.usage_json FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=? ORDER BY r.id').bind(id).all<Json>();
        const costStates = await Promise.all(costs.results.map(async row => row.kind === 'compute' ? {...row,
          physicallyStopped: stopped.has(row.id) ? stopped.get(row.id) : await env.SHARDS.getByName(row.id).isStopped().catch(() => null)} : row));
        const notice = await env.DB.prepare('SELECT payload_json FROM pipeline_outbox WHERE operation_id=? AND kind=\'operation_failure\' ORDER BY rowid LIMIT 1').bind(id).first<{payload_json: string}>();
        return Response.json({operation: op, workflows: await workflowInventory(env, id), attempts, costs: costStates,
          failure: notice ? {...parseCanonicalJson(notice.payload_json) as Json, evidenceStored: !!await env.MEDIA.head('operations/' + id + '/failure.json')} : null});
      }
      const events = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/events$/.exec(path);
      if (request.method === 'GET' && events) return env.OPERATIONS.getByName(events[1]!).watch(events[1]!);
      const renderRoute = /^\/internal\/s1\/renders\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if (request.method === 'GET' && renderRoute) {
        const row = await env.DB.prepare('SELECT id,status,result_json FROM pipeline_renders WHERE id=?').bind(renderRoute[1]).first<Json>();
        return row ? Response.json(row) : new Response(null, {status: 404});
      }
      const cancel = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/cancel$/.exec(path);
      if (request.method === 'POST' && cancel) {
        const id = cancel[1]!;
        await env.DB.batch([
          env.DB.prepare('UPDATE pipeline_operations SET status=\'cancelled\',generation=generation+1,finished_at=? WHERE id=? AND status IN (\'active\',\'awaiting_user\')').bind(Date.now(), id),
          env.DB.prepare('INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND status=\'cancelled\')')
            .bind('cancel-' + id, id, 'cancel', canonical({operationId: id}), id),
        ]);
        ctx.waitUntil(flushOutbox(env));
        return Response.json({operationId: id, status: 'cancelling'});
      }
      const reconcile = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/reconcile$/.exec(path);
      if (request.method === 'POST' && reconcile) return Response.json(await reconcileOperation(env, reconcile[1]!));
      return new Response('Not found', {status: 404});
    } catch (error) {
      const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'PIPELINE_REQUEST_INVALID';
      return Response.json({code}, {status: code.includes('CONFLICT') ? 409 : 422});
    }
  },
  async scheduled(_event: ScheduledController, env: PipelineEnv, ctx: ExecutionContext) {
    if (env.S1_ENABLED === 'internal_eval') ctx.waitUntil((async () => {await flushOutbox(env); await recoverWorkflows(env);})());
  },
  async queue(batch: MessageBatch<Json>, env: PipelineEnv) {
    for (const message of batch.messages) {
      try {
        if (env.S1_ENABLED !== 'internal_eval') throw Error('EXECUTION_DISABLED');
        const item = message.body;
        if (item.kind === 'render') await dispatchRender(env, item);
        else if (item.kind === 'render_progress') await dispatchRenderProgress(env, item);
        else if (item.kind === 'operation_progress') await dispatchDirectorProgress(env, item);
        else if (item.kind === 'operation_failure') await dispatchDirectorFailure(env, item);
        else if (item.kind === 'creative') await dispatchCreative(env, item);
        else if (item.kind === 'cancel') await reconcileOperation(env, item.operationId);
        else throw Error('OUTBOX_KIND_INVALID');
        message.ack();
      } catch {message.retry();}
    }
  },
} satisfies ExportedHandler<PipelineEnv, Json>;
