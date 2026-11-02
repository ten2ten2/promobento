import {NATIVE_PROJECT_SCHEMA_VERSION} from './version.ts';
import {directingMethodPack, directingMethodRef} from '../../../packages/methods/directing.ts';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {registerOperation,cancelOperation} from './operation-registration.ts';
import {operation, rights, readJson, immutableStream, immutableJson, getJson} from './store.ts';
import {reconcileOperation, dispatchRender, deliverDirectorEvent, recoverDirectorEvents} from './render-recovery.ts';
import {chooseDirection} from './director-choice.ts';
import {dispatchDirectorFailure, dispatchDirectorProgress, dispatchOperationCancellation, getReviewDraft} from './director-recovery.ts';
import {importModelOpening, confirmModelOpening, modelBudgetStatus} from './model-budget.ts';
import {workflowInventory} from './workflow-state.ts';
import {dispatchCreative, recoverWorkflows} from './workflow-recovery.ts';
import {saveNativeProject, loadNativeProject, createNativeRender, NATIVE_COMMIT} from './native-project.ts';
import {flushOutbox,recoverUnregisteredDispatches} from './outbox.ts';
import {dispatchRenderAdmissions} from './render-admission.ts';
import {processQueueMessages} from './control-batch.ts';
import {operationRecoverySnapshot} from './recovery-api.ts';
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

function privateJson(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cache-control', 'private, no-store');
  return Response.json(value, {...init, headers});
}

/** Internal artifact reads are restricted to native results and the owning operation. */
async function artifact(env: PipelineEnv, key: string) {
  let owner: Json | null = null, resources: Json[] = [];
  if (key.startsWith('renders/')) {
    const row = await env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=? AND status=\'passed\'').bind(key.split('/')[1]).first<Json>();
    const result = row?.result_json ? parseCanonicalJson(row.result_json) as Json : null;
    if (!result?.outputs?.some((output: Json) => output.key === key)) return new Response(null, {status: 404});
    owner = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(row!.operation_id).first<Json>();
    if (owner?.generation !== row!.generation) return new Response(null, {status: 404});
    const input = await getJson(env, row!.job_key);
    if (input.kind !== 'native_render_request') return new Response(null, {status: 404});
    resources = input.project.resources ?? [];
  } else if (key.startsWith('operations/')) {
    const id = key.split('/')[1];
    const context = await env.DB.prepare('SELECT * FROM pipeline_contexts WHERE operation_id=?').bind(id).first<Json>();
    const previews = context?.previews_key ? await getJson(env, context.previews_key) as unknown as Json[] : [];
    if (!previews.some(preview => preview.key === key)) return new Response(null, {status: 404});
    owner = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(id).first<Json>();
    const request = await getJson(env, context!.request_key);
    // The Director also accepts separately supplied audio. Direction previews
    // can contain that audio even when it is absent from the visual resources
    // list; revoking it must fence artifact reads just like rendered films.
    resources = [...(request.resources ?? []), ...(request.audioSources ?? [])];
  }
  if (owner?.status === 'failed') {
    const draft = await getReviewDraft(env, owner.id);
    const outputs = (draft?.renders ?? []).flatMap((entry: Json) => entry.result?.outputs ?? []);
    if (!outputs.some((output: Json) => output.key === key)) return new Response(null, {status: 404});
  } else if (!owner || !['active', 'awaiting_user', 'succeeded'].includes(owner.status)) return new Response(null, {status: 404});
  await rights(env, owner as Operation, resources);
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
    if (request.method === 'GET' && path === '/healthz') return Response.json({ok: true, nativeProjectSchema: NATIVE_PROJECT_SCHEMA_VERSION, runtime: 'huashu-motion', nativeCommit: NATIVE_COMMIT});
    if (!path.startsWith('/internal/s1/') || !authorized(request, env)) return new Response('Not found', {status: 404});
    try {
      if (request.method === 'GET' && path === '/internal/s1/capacity') {
        const leases = await env.COORDINATOR.getByName('global-v1').counts();
        const queued = await env.DB.prepare(`SELECT COUNT(*) AS count,MIN(a.requested_at) AS oldest FROM pipeline_render_admissions a
          JOIN pipeline_renders r ON r.id=a.render_id JOIN pipeline_operations o ON o.id=a.operation_id
          WHERE a.status='queued' AND r.status='queued' AND o.status='active' AND o.generation=a.generation`).first<{count:number;oldest:number|null}>();
        return privateJson({leases,queued:queued?.count??0,oldestWaitMs:queued?.oldest?Date.now()-queued.oldest:null});
      }
      if (path === '/internal/s1/model-budget' && request.method === 'GET') return privateJson(await modelBudgetStatus(env));
      if (path === '/internal/s1/model-budget/import' && request.method === 'POST') return privateJson(await importModelOpening(env, await readJson(request)));
      if (path === '/internal/s1/model-budget/confirm' && request.method === 'POST') {
        const input = await readJson(request);
        if (typeof input.evidenceKey !== 'string' || !input.evidenceKey.startsWith('evals/')) throw Error('MODEL_CONFIRMATION_INVALID');
        return privateJson(await confirmModelOpening(env, await getJson(env, input.evidenceKey, 'MODEL_CONFIRMATION_INVALID')));
      }
      if (path === '/internal/s1/workflows/reconcile' && request.method === 'POST') return privateJson(await recoverWorkflows(env));
      if (request.method === 'GET' && path.startsWith('/internal/s1/artifacts/')) {
        let key: string;
        try {key=decodeURIComponent(path.slice('/internal/s1/artifacts/'.length));}
        catch {throw Error('OBJECT_KEY_INVALID');}
        return await artifact(env,key);
      }
      if (request.method === 'POST' && path === '/internal/s1/operations') {
        return privateJson(await registerOperation(env,await readJson(request)));
      }
      // Rights evidence is required for native material reads and execution.
      if (request.method === 'POST' && path === '/internal/s1/rights') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        if (typeof input.resourceId !== 'string' || !/^res_[A-Za-z0-9_-]{4,64}$/.test(input.resourceId)
          || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)
          || typeof input.licenseRef !== 'string' || !input.licenseRef.trim() || input.licenseRef.length > 2048
          || input.scope !== 'internal_eval_only'
          || typeof input.evidenceKey !== 'string' || !/^evals\/[A-Za-z0-9_/-]{4,240}\.json$/.test(input.evidenceKey)
          || input.evidenceKey.split('/').some(part=>part==='..')) throw Error('RIGHTS_INVALID');
        const evidence = await getJson(env, input.evidenceKey, 'RIGHTS_EVIDENCE_INVALID');
        if (evidence.resourceId !== input.resourceId || evidence.sha256 !== input.sha256 || evidence.licenseRef !== input.licenseRef
          || evidence.scope !== input.scope || evidence.approvedBy !== 'owner'
          || typeof evidence.source !== 'string' || !evidence.source.trim()
          || typeof evidence.basis !== 'string' || !evidence.basis.trim()) throw Error('RIGHTS_EVIDENCE_INVALID');
        await env.DB.prepare('INSERT OR IGNORE INTO pipeline_rights(operation_id,resource_id,sha256,license_ref,evidence_key,scope) VALUES(?,?,?,?,?,?)')
          .bind(op.id, input.resourceId, input.sha256, input.licenseRef, input.evidenceKey, input.scope).run();
        const stored = await env.DB.prepare('SELECT license_ref,evidence_key,scope,revoked_at FROM pipeline_rights WHERE operation_id=? AND resource_id=? AND sha256=?')
          .bind(op.id,input.resourceId,input.sha256).first<Json>();
        if (!stored || stored.license_ref !== input.licenseRef || stored.evidence_key !== input.evidenceKey
          || stored.scope !== input.scope || stored.revoked_at !== null) throw Error('RIGHTS_IDEMPOTENCY_CONFLICT');
        return new Response(null, {status: 201});
      }
      const releaseRoute = /^\/internal\/s1\/releases\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if (releaseRoute && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT * FROM renderer_releases WHERE id=?').bind(releaseRoute[1]).first<Json>();
        if (!row) return new Response(null, {status: 404});
        return privateJson({...row, currentImageDigest: await env.SHARDS.getByName('release-metadata').imageDigest()});
      }
      if (request.method === 'POST' && path === '/internal/s1/releases') {
        const input = await readJson(request);
        if (!validId(input.id) || input.runtimeVersion !== NATIVE_COMMIT || typeof input.environmentKey !== 'string') throw Error('RELEASE_INVALID');
        input.imageDigest = await env.SHARDS.getByName('release-metadata').imageDigest();
        const previous = await env.DB.prepare('SELECT * FROM renderer_releases WHERE id=?').bind(input.id).first<Json>();
        if (previous && (previous.image_digest !== input.imageDigest || previous.runtime_version !== input.runtimeVersion
          || previous.environment_key !== input.environmentKey)) throw Error('IMMUTABLE_RELEASE_CONFLICT');
        if (!previous) await env.DB.prepare('INSERT OR IGNORE INTO renderer_releases(id,image_digest,runtime_version,environment_key,status) VALUES(?,?,?,?,?)')
          .bind(input.id, input.imageDigest, input.runtimeVersion, input.environmentKey, 'active').run();
        const persisted = await env.DB.prepare('SELECT image_digest,runtime_version,environment_key FROM renderer_releases WHERE id=?').bind(input.id).first<Json>();
        if (!persisted || persisted.image_digest !== input.imageDigest || persisted.runtime_version !== input.runtimeVersion
          || persisted.environment_key !== input.environmentKey) throw Error('IMMUTABLE_RELEASE_CONFLICT');
        return new Response(null, {status: 201});
      }
      if (request.method === 'PUT' && path.startsWith('/internal/s1/objects/')) {
        const key = path.slice('/internal/s1/objects/'.length);
        if (!/^evals\/[A-Za-z0-9_/-]{4,240}\.[a-z0-9]{2,8}$/.test(key) || key.split('/').some(part => part === '..')) throw Error('OBJECT_KEY_INVALID');
        const declared = request.headers.get('content-length'), length = Number(declared);
        if (declared === null || !Number.isSafeInteger(length) || length < 0 || length > 50 << 20) throw Error('OBJECT_TOO_LARGE');
        const mediaType = request.headers.get('content-type') ?? 'application/octet-stream';
        const object = await immutableStream(env,key,request.body,length,request.headers.get('x-content-sha256') ?? '',mediaType);
        return privateJson({key,sha256:object.sha256,byteLength:object.byteLength,mediaType});
      }
      if (request.method === 'POST' && path === '/internal/s1/native/projects') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        return privateJson(await saveNativeProject(env, op, input as any), {status: 201});
      }
      const projectRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/projects\/([a-f0-9]{64})$/.exec(path);
      if (request.method === 'GET' && projectRoute) {
        const op = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=? AND status IN (\'active\',\'awaiting_user\',\'succeeded\')')
          .bind(projectRoute[1]).first<Operation>();
        if (!op) return new Response(null, {status: 404});
        return privateJson(await loadNativeProject(env, op, projectRoute[2]!));
      }
      if (request.method === 'POST' && path === '/internal/s1/renders') {
        const input = await readJson(request), op = await operation(env, input.operationId);
        return privateJson(await createNativeRender(env, op, input as any), {status: 202});
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
        return privateJson({operationId: op.id}, {status: 202});
      }
      const direction = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/direction$/.exec(path);
      if (direction && request.method === 'POST') {
        const id = direction[1]!, input = await readJson(request);
        const result = await chooseDirection(env, await operation(env, id), input);
        ctx.waitUntil(flushOutbox(env, result.outboxId));
        return privateJson({operationId: id, key: result.key});
      }
      const candidateRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/candidate$/.exec(path);
      if (candidateRoute && request.method === 'GET') {
        const owner = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=? AND status=\'succeeded\'').bind(candidateRoute[1]).first<Json>();
        if (!owner?.result_key) return new Response(null, {status: 404});
        const candidate = await getJson(env, owner.result_key);
        if (candidate.kind !== 'native_candidate' || candidate.operationId !== owner.id) throw Error('CANDIDATE_SCOPE_INVALID');
        return privateJson(candidate);
      }
      const reviewRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/review-draft$/.exec(path);
      if (reviewRoute && request.method === 'GET') {
        const draft = await getReviewDraft(env, reviewRoute[1]!);
        return draft ? privateJson(draft) : new Response(null, {status: 404});
      }
      const contextRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if (contextRoute && request.method === 'GET') {
        const row = await env.DB.prepare('SELECT o.*,c.directions_key,c.directions_hash,c.previews_key,c.choice FROM pipeline_operations o LEFT JOIN pipeline_contexts c ON c.operation_id=o.id WHERE o.id=?').bind(contextRoute[1]).first<Json>();
        if (!row) return new Response(null, {status: 404});
        return privateJson({...row, workflows: await workflowInventory(env, row.id),
          ...(row.directions_key ? {directions: await getJson(env, row.directions_key)} : {}),
          ...(row.previews_key ? {previews: await getJson(env, row.previews_key)} : {})});
      }
      const recoveryRoute = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/recovery$/.exec(path);
      if (recoveryRoute && request.method === 'GET') return await operationRecoverySnapshot(env,recoveryRoute[1]!);
      const events = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/events$/.exec(path);
      if (request.method === 'GET' && events) return await env.OPERATIONS.getByName(events[1]!).watch(events[1]!);
      const renderRoute = /^\/internal\/s1\/renders\/([A-Za-z0-9_-]{4,96})$/.exec(path);
      if (request.method === 'GET' && renderRoute) {
        const row = await env.DB.prepare(`SELECT r.id,r.result_json,
          CASE WHEN r.status='queued' AND EXISTS(SELECT 1 FROM pipeline_render_admissions a WHERE a.render_id=r.id AND a.status='admitted')
            THEN 'admitted' ELSE r.status END AS status FROM pipeline_renders r WHERE r.id=?`).bind(renderRoute[1]).first<Json>();
        return row ? privateJson(row) : new Response(null, {status: 404});
      }
      const cancel = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/cancel$/.exec(path);
      if (request.method === 'POST' && cancel) {
        const id = cancel[1]!;
        const result = await cancelOperation(env,id);
        ctx.waitUntil(flushOutbox(env));
        return privateJson(result);
      }
      const reconcile = /^\/internal\/s1\/operations\/([A-Za-z0-9_-]{4,96})\/reconcile$/.exec(path);
      if (request.method === 'POST' && reconcile) return privateJson(await reconcileOperation(env, reconcile[1]!));
      return new Response('Not found', {status: 404});
    } catch (error) {
      // A transport/runtime fault must not masquerade as invalid client input.
      // Do not expose raw exception messages to the future Studio API.
      // Match codes from the pipeline domain, not arbitrary uppercase errors
      // returned by D1, R2 or another runtime component.
      const known = error instanceof Error && /^(?:ASSET|BODY|CANDIDATE|CAPACITY|COMPUTE|CONTROL|COST|DIRECTION|DIRECTOR|EXECUTION|IDEMPOTENCY|IMMUTABLE|LEASE|LEGACY|MODEL|NATIVE|OBJECT|OPERATION|OUTBOX|RELEASE|RENDER|REVIEW|RIGHTS|SOURCE|TASK|WORKFLOW)_[A-Z0-9_]+$/.test(error.message);
      const code = known ? (error as Error).message : 'PIPELINE_INTERNAL_ERROR';
      const status = !known ? 500 : code.includes('CONFLICT') ? 409
        : /(?:_TIMEOUT|_UNCONFIRMED|_UNAVAILABLE)$/.test(code) ? 503 : 422;
      return privateJson({code}, {status});
    }
  },
  async scheduled(_event: ScheduledController, env: PipelineEnv, ctx: ExecutionContext) {
    if (env.S1_ENABLED === 'internal_eval') ctx.waitUntil((async () => {
      // Independent recovery lanes: a Queue outage must not stop Director wake-up retries.
      const results = await Promise.allSettled([flushOutbox(env),dispatchRenderAdmissions(env),recoverDirectorEvents(env),recoverWorkflows(env),recoverUnregisteredDispatches(env)]);
      const failed = results.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    })());
  },
  async queue(batch: MessageBatch<Json>, env: PipelineEnv) {
    await processQueueMessages(batch.messages, async message => {
        if (env.S1_ENABLED !== 'internal_eval') throw Error('EXECUTION_DISABLED');
        const item = message.body;
        if (item.kind === 'render') await dispatchRender(env, item);
        else if (item.kind === 'admission') await dispatchRenderAdmissions(env);
        else if (item.kind === 'render_progress' || item.kind === 'render_terminal' || item.kind === 'direction_choice') await deliverDirectorEvent(env, item);
        else if (item.kind === 'operation_progress') await dispatchDirectorProgress(env, item);
        else if (item.kind === 'operation_failure') await dispatchDirectorFailure(env, item);
        else if (item.kind === 'creative') await dispatchCreative(env, item);
        else if (item.kind === 'cancel') await dispatchOperationCancellation(env, item);
        else throw Error('OUTBOX_KIND_INVALID');
    });
  },
} satisfies ExportedHandler<PipelineEnv, Json>;
