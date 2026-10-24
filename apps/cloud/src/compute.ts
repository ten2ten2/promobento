import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import {assertRenderTask} from '@promobento/contracts/render';
import {operation, rights, reserve, settle} from './store.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';
import policy from '../../../config/agent-policy.json';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const coordinator = (env: PipelineEnv) => env.COORDINATOR.getByName('global-v1');
const sizes: Record<string, [number, number, number]> = {'standard-1': [.5, 4, 8], 'standard-2': [1, 6, 12], 'standard-3': [2, 8, 16], 'standard-4': [4, 12, 20]};
/** Full allocated CPU is an upper-bound estimate, not a claim about metered CPU utilization. */
const computeMicros = (instance: string, ms: number) => {
  const [cpu, memory, disk] = sizes[instance]!;
  return Math.ceil(ms / 1000 * (cpu! * 20 + memory! * 2.5 + disk! * .07));
};

type BrokerProps = {token: string; operationId: string; generation: number; resources: Json[]; reads: string[]; prefix: string; attemptId: string};
export class Broker extends WorkerEntrypoint<PipelineEnv, BrokerProps> {
  async fetch(request: Request): Promise<Response> {
    const scope = this.ctx.props, url = new URL(request.url);
    if (url.hostname !== 'broker.internal' || request.headers.get('authorization') !== 'Bearer ' + scope.token) return new Response(null, {status: 403});
    try {
      const op = await operation(this.env, scope.operationId, scope.generation); await rights(this.env, op, scope.resources);
      const key = url.pathname.slice(3).split('/').map(decodeURIComponent).join('/');
      if (key.split('/').some(part => !part || part === '.' || part === '..')) return new Response(null, {status: 403});
      if (request.method === 'GET' && url.pathname.startsWith('/r/') && scope.reads.includes(key)) {
        const object = await this.env.MEDIA.get(key); return object ? new Response(object.body) : new Response(null, {status: 404});
      }
      if (request.method !== 'PUT' || !url.pathname.startsWith('/w/') || !key.startsWith(scope.prefix + '/')) return new Response(null, {status: 403});
      const length = Number(request.headers.get('content-length'));
      if (!Number.isSafeInteger(length) || length < 1 || length > 50 << 20) return new Response(null, {status: 413});
      const bytes = new Uint8Array(await request.arrayBuffer()); if (bytes.length !== length) return new Response(null, {status: 413});
      const hash = sha256Bytes(bytes), old = await this.env.MEDIA.head(key);
      if (old && old.customMetadata?.sha256 !== hash) return new Response(null, {status: 409});
      if (!old) await this.env.MEDIA.put(key, bytes, {onlyIf: new Headers({'If-None-Match': '*'}),
        customMetadata: {sha256: hash, operationId: op.id, attemptId: scope.attemptId}, httpMetadata: {contentType: request.headers.get('content-type') ?? 'application/octet-stream'}});
      const actual = await this.env.MEDIA.head(key); if (actual?.customMetadata?.sha256 !== hash) return new Response(null, {status: 409});
      // The object stays staged if cancellation races a write; only generation-fenced workflow commits publish it.
      await operation(this.env, scope.operationId, scope.generation);
      return new Response(null, {status: 201});
    } catch { return new Response(null, {status: 403}); }
  }
}

export class CoordinatorDO extends DurableObject<PipelineEnv> {
  constructor(ctx: DurableObjectState, env: PipelineEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,kind TEXT NOT NULL,deadline INTEGER NOT NULL)');
  }
  async acquire(id: string, workspace: string, kind: 'shard' | 'studio', deadline: number) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql, existing = sql.exec('SELECT * FROM leases WHERE id=?', id).toArray()[0];
      if (existing) { if (existing.workspace !== workspace || existing.kind !== kind) throw Error('LEASE_CONFLICT'); return true; }
      const counts = sql.exec('SELECT workspace,kind,COUNT(*) AS n FROM leases GROUP BY workspace,kind').toArray();
      const count = (filter: (row: Json) => boolean) => counts.filter(filter).reduce((sum, row) => sum + Number(row.n), 0);
      const global = kind === 'studio' ? policy.limits.globalStudioInstances : policy.limits.globalShardInstances;
      if (count(row => row.kind === kind) >= global || kind === 'shard' && count(row => row.kind === kind && row.workspace === workspace) >= policy.limits.workspaceShardInstances) return false;
      sql.exec('INSERT INTO leases VALUES(?,?,?,?)', id, workspace, kind, deadline); return true;
    });
  }
  async release(id: string) {
    // A timeout is not evidence of stopped compute. The owning ShardDO must confirm its instance is gone.
    if (!await this.env.SHARDS.getByName(id).isStopped()) throw Error('COMPUTE_STILL_RUNNING');
    this.ctx.storage.sql.exec('DELETE FROM leases WHERE id=?', id);
  }
  async arm() { await this.ctx.storage.setAlarm(Date.now() + 15000); }
  async alarm() {
    const leases = this.ctx.storage.sql.exec('SELECT * FROM leases WHERE deadline<=?', Date.now()).toArray();
    for (const lease of leases) {
      try { await this.env.SHARDS.getByName(String(lease.id)).stopAndSettle(); await this.release(String(lease.id)); } catch { /* Hold the slot until confirmed stopped. */ }
    }
    if (this.ctx.storage.sql.exec('SELECT id FROM leases LIMIT 1').toArray().length) await this.arm();
  }
  async counts() { return this.ctx.storage.sql.exec('SELECT workspace,kind,COUNT(*) AS count FROM leases GROUP BY workspace,kind').toArray(); }
  async rendererHealth(key:string){return canonical(await this.ctx.storage.get('rendererHealth:'+key)??null);}
  async rememberRendererHealth(key:string,value:string){await this.ctx.storage.put('rendererHealth:'+key,parseCanonicalJson(value));}
}

export class ShardDO extends DurableObject<PipelineEnv> {
  private token: string | undefined;
  private work: Promise<Json> | undefined;
  private workHash: string | undefined;
  private async call(path: string, body?: unknown) {
    return this.ctx.container!.getTcpPort(8080).fetch('http://container' + path, body === undefined ? undefined : {method: 'POST', body: canonical(body)});
  }
  async imageDigest() {
    const image = this.ctx.container!.images.render;
    const hash = image?.match(/sha256:[a-f0-9]{64}/)?.[0];
    if (!hash) throw Error('RENDER_IMAGE_DIGEST_UNAVAILABLE'); return hash;
  }
  async isStopped() { return !this.ctx.container!.running; }
  async stop() {
    // Attempt IDs are never reusable. A delayed execute RPC must not start after a confirmed stop.
    this.ctx.storage.kv.put('stopRequested',true);
    await this.ctx.container!.destroy();
    if (this.ctx.container!.running) throw Error('COMPUTE_STOP_UNCONFIRMED');
    this.token = undefined;
  }
  async execute(serialized: string): Promise<string> {
    const task = parseCanonicalJson(serialized) as Json, hash = digest(task);
    if (this.work) { if (hash !== this.workHash) throw Error('TASK_ALREADY_BOUND'); return canonical(await this.work); }
    this.workHash = hash; this.work = this.executeOnce(task);
    return canonical(await this.work);
  }
  private async executeOnce(task: Json): Promise<Json> {
    // Never persist the broker token. The task object arrives only over Worker RPC.
    const hash = digest(task), bound = await this.ctx.storage.get<string>('requestHash');
    if (bound && bound !== hash) throw Error('TASK_ALREADY_BOUND');
    const previous = await this.ctx.storage.get<Json>('result'); if (previous) { await this.stopAndSettle(); return previous; }
    if(this.ctx.storage.kv.get('stopRequested'))throw Error('COMPUTE_ATTEMPT_STOPPED');
    if (bound) throw Error('COMPUTE_ATTEMPT_LOST'); // Retry uses a new DO, not an old possibly-running instance.
    const op = await operation(this.env, task.job.operationId, task.generation);
    await rights(this.env, op, task.job.resources);
    const release = await this.env.DB.prepare('SELECT * FROM renderer_releases WHERE id=? AND status=\'active\'').bind(task.job.rendererRelease).first<Json>();
    if (!release || release.runtime_version !== task.job.runtimeVersion || release.image_digest !== task.imageDigest || release.image_digest !== await this.imageDigest()) throw Error('RENDER_ENVIRONMENT_MISMATCH');
    const intrinsicLimit = task.mode === 'studio' ? 1200000 : task.mode === 'shard' ? (task.shard.end - task.shard.start) * (task.instance === 'standard-4' ? 6000 : 1000) + 60000 : 300000;
    const deadlineAt=Math.min(Date.now()+intrinsicLimit,task.deadlineAt===undefined?Infinity:Number(task.deadlineAt));
    if(!Number.isFinite(deadlineAt)||deadlineAt<=Date.now())throw Error('RENDER_DEADLINE');
    const leaseKind = task.mode === 'studio' ? 'studio' : 'shard';
    let startedAt: number | undefined, outcome: Json | undefined, reserved = false,acquired=false;
    try {
      // 24 WebGL shards and audio share a 24-slot workspace. Wait without a container or reservation;
      // the original render deadline, generation and stop latch still bound this attempt.
      const capacityStartedAt=Date.now();
      for(;;){
        if(this.ctx.storage.kv.get('stopRequested'))throw Error('COMPUTE_ATTEMPT_STOPPED');
        if(Date.now()>=deadlineAt)throw Error('RENDER_DEADLINE');
        await operation(this.env,op.id,op.generation);
        acquired=await coordinator(this.env).acquire(task.taskId,op.workspace_id,leaseKind,deadlineAt+30000);
        if(acquired)break;
        await sleep(Math.min(250,Math.max(0,deadlineAt-Date.now())));
      }
      const capacityWaitMs=Date.now()-capacityStartedAt;
      await coordinator(this.env).arm();
      await operation(this.env,op.id,op.generation);await rights(this.env,op,task.job.resources);
      const limit=deadlineAt-Date.now();if(limit<1)throw Error('RENDER_DEADLINE');
      await reserve(this.env, op, task.taskId, 'compute', 'render', computeMicros(task.instance, limit + 30000), task,
        'cloudflare-containers-2026-10-23-upper-bound', 10000000, op.max_micros);
      reserved = true;
      await this.ctx.storage.put({requestHash: hash, taskId: task.taskId, instance: task.instance});
      await this.ctx.storage.setAlarm(Date.now() + limit);
      this.token = crypto.randomUUID() + crypto.randomUUID();
      const {generation: _generation, imageDigest: _imageDigest, deadlineAt: _deadline, ...input} = task;
      input.brokerToken = this.token; assertRenderTask(input);
      const suffix = task.mode === 'shard' ? '/shards/' + task.shard.index : task.mode === 'audio' ? '/audio' : '/out';
      const broker = this.ctx.exports.Broker({props: {token: this.token, operationId: op.id, generation: op.generation,
        resources: task.job.resources, reads: task.inputs.map((input: Json) => input.key),
        prefix: `renders/${task.job.renderId}/attempts/${task.taskId}${suffix}`, attemptId: task.taskId}});
      startedAt = Date.now(); await this.ctx.storage.put('startedAt', startedAt);
      if(this.ctx.storage.kv.get('stopRequested'))throw Error('COMPUTE_ATTEMPT_STOPPED');
      this.ctx.container!.start({image: this.ctx.container!.images.render!, instance: task.instance, enableInternet: false,
        env: {RENDER_IMAGE_DIGEST: release.image_digest, RENDERER_RELEASE: release.id}});
      await this.ctx.container!.interceptOutboundHttp('broker.internal', broker);
      void this.ctx.container!.monitor().catch(() => {});
      let environmentHealth: Json | string | null = null;
      while (Date.now() - startedAt < 30000) {
        await operation(this.env, op.id, op.generation);
        try {
          const health=await this.call('/healthz');
          if(health.ok){const text=await health.text();environmentHealth=text==='ready'?text:parseCanonicalJson(text) as Json;break;}
        } catch {}
        await sleep(250);
      }
      const containerReadyMs=environmentHealth===null?null:Date.now()-startedAt;
      const peak=typeof environmentHealth==='object'?environmentHealth?.memoryPeak:null;
      // Owner-approved missing interface remains explicit; permission/invalid-value failures still block.
      if(task.mode==='shard'&&peak?.available===false&&!(peak.mib===null&&peak.bytes===null&&peak.unavailableReason==='cgroup_peak_not_exposed')){
        await this.env.DB.prepare('UPDATE pipeline_attempts SET result_json=? WHERE id=?').bind(canonical({status:'failed',code:'RENDER_MEMORY_METRIC_UNAVAILABLE',environmentHealth}),task.taskId).run();
        throw Error('RENDER_MEMORY_METRIC_UNAVAILABLE');
      }
      if (!(await this.call('/task', input)).ok) throw Error('RENDER_TASK_REJECTED');
      for (;;) {
        await operation(this.env, op.id, op.generation);
        if (Date.now() - startedAt > limit) throw Error('RENDER_DEADLINE');
        const response = await this.call('/result'); if (!response.ok) throw Error('RENDER_CONTROLLER_UNAVAILABLE');
        const value = await response.json<Json>();
        if (value.status === 'failed') {
          await this.env.DB.prepare('UPDATE pipeline_attempts SET result_json=? WHERE id=?').bind(canonical({status:'failed',code:value.code,diagnostic:value.diagnostic??null,environmentHealth}),task.taskId).run();
          throw Error(value.code);
        }
        if (value.status === 'succeeded') { outcome = {...value,lifecycleTimings:{capacityWaitMs,containerReadyMs}}; break; }
        if (value.status === 'ready' && task.mode === 'studio') {
          await this.ctx.storage.put('studio', {operationId: op.id, generation: op.generation, resources: task.job.resources});
          return {...value,environmentHealth}; // Lease and budget stay held while the studio exists.
        }
        await sleep(1000);
      }
      await this.ctx.storage.put('result', outcome);
      return outcome;
    } finally {
      if (!(await this.ctx.storage.get('studio'))) {
        await this.stop();if(acquired)await coordinator(this.env).release(task.taskId);await this.ctx.storage.deleteAlarm();
        if (reserved) await this.finishCost(task.taskId, task.instance, startedAt);
      }
    }
  }
  async frame(taskId: string, frameIndex: number) {
    const studio = await this.ctx.storage.get<Json>('studio'); if (!studio) throw Error('STUDIO_NOT_READY');
    const op = await operation(this.env, studio.operationId, studio.generation); await rights(this.env, op, studio.resources);
    return this.call('/studio/frame', {taskId, frameIndex});
  }
  private async finishCost(id: string, instance: string, startedAt?: number) {
    const usage = this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.kv.get<Json>('costUsage');
      if (previous) return previous;
      const value = {kind: 'allocated_resource_upper_bound', runningMs: startedAt === undefined ? 0 : Date.now() - startedAt, instance};
      this.ctx.storage.kv.put('costUsage', value); return value;
    });
    await settle(this.env, id, computeMicros(instance, usage.runningMs), usage);
  }
  async alarm() { await this.stopAndSettle(); }
  async stopAndSettle() {
    await this.stop();
    const id = await this.ctx.storage.get<string>('taskId'), start = await this.ctx.storage.get<number>('startedAt'), instance = await this.ctx.storage.get<string>('instance');
    await this.ctx.storage.delete('studio');
    if (id) { await coordinator(this.env).release(id); if (instance) await this.finishCost(id, instance, start); }
    if (id) await this.env.DB.prepare("UPDATE pipeline_attempts SET status=CASE WHEN status='active' THEN 'stopped' ELSE status END,stopped_at=COALESCE(stopped_at,?) WHERE id=?").bind(Date.now(),id).run();
    await this.ctx.storage.deleteAlarm();
  }
}

export class OperationDO extends DurableObject<PipelineEnv> {
  private listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private clearStudio(taskId:string){this.ctx.storage.transactionSync(()=>{
    if(this.ctx.storage.kv.get<Json>('studio')?.taskId===taskId)this.ctx.storage.kv.delete('studio');
  });}
  async progress(serialized: string) {
    const value=parseCanonicalJson(serialized) as Json;
    await this.ctx.storage.put('progress',value);
    const bytes = new TextEncoder().encode('data: '+canonical(value)+'\n\n');
    for (const listener of this.listeners) {try {listener.enqueue(bytes);} catch {this.listeners.delete(listener);}}
  }
  async watch(operationId: string) {
    await operation(this.env,operationId);
    const initial = await this.ctx.storage.get<Json>('progress') ?? {operationId,status:'active'};
    let listener: ReadableStreamDefaultController<Uint8Array>, timer: ReturnType<typeof setTimeout>;
    const body = new ReadableStream<Uint8Array>({start: controller => {listener=controller;this.listeners.add(controller);controller.enqueue(new TextEncoder().encode('data: '+canonical(initial)+'\n\n'));
      timer=setTimeout(()=>{this.listeners.delete(controller);controller.close();},25000);},cancel:()=>{clearTimeout(timer);this.listeners.delete(listener);}});
    return new Response(body,{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});
  }
  async studio(operationId: string, serialized: string) {
    const task=parseCanonicalJson(serialized) as Json;
    const op = await operation(this.env, operationId, task.generation); if (task.job.operationId !== op.id) throw Error('OPERATION_SCOPE_INVALID');
    const existing = await this.ctx.storage.get<Json>('studio');
    if (existing && existing.taskId !== task.taskId) await this.env.SHARDS.getByName(existing.taskId).stopAndSettle();
    // Publish ownership before awaiting execute, so cancellation/failed startup can find and stop it.
    await this.ctx.storage.put('studio', {taskId: task.taskId, operationId, generation: op.generation});
    try{
      const result=await this.env.SHARDS.getByName(task.taskId).execute(canonical(task));
      const current=await this.ctx.storage.get<Json>('studio');
      if(current?.taskId!==task.taskId)throw Error('OPERATION_FENCED');
      await operation(this.env,operationId,op.generation);return result;
    }catch(error){
      try{await this.env.SHARDS.getByName(task.taskId).stopAndSettle();
        this.clearStudio(task.taskId);
      }catch{ /* Keep the handle for the operation cleanup outbox and shard alarm. */ }
      throw error;
    }
  }
  async closeStudio() { const studio = await this.ctx.storage.get<Json>('studio');if(studio){
    await this.env.SHARDS.getByName(studio.taskId).stopAndSettle();this.clearStudio(studio.taskId);
  } }
  async frame(operationId: string, frameIndex: number) {
    const studio = await this.ctx.storage.get<Json>('studio');
    if (!studio || studio.operationId !== operationId) throw Error('STUDIO_NOT_READY');
    await operation(this.env, operationId, studio.generation); return this.env.SHARDS.getByName(studio.taskId).frame(studio.taskId, frameIndex);
  }
}
