import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import {operation, reserve, settle} from './store.ts';
import {assertNativeExecution, nativeContainerInput, nativeRenderPolicy} from './native-task.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const coordinator = (env: PipelineEnv) => env.COORDINATOR.getByName('global-v1');
const sizes: Record<string, [number, number, number]> = {'standard-1': [.5, 4, 8], 'standard-2': [1, 6, 12], 'standard-3': [2, 8, 16], 'standard-4': [4, 12, 20]};
/** Cost reservation upper bound for native container time. */
const computeMicros = (instance: string, ms: number) => {
  const size = sizes[instance];
  if (!size || !Number.isFinite(ms) || ms < 0) throw Error('COMPUTE_USAGE_INVALID');
  const [cpu, memory, disk] = size;
  return Math.ceil(ms / 1000 * (cpu * 20 + memory * 2.5 + disk * .07));
};

type BrokerProps = {token: string; operationId: string; generation: number; reads: string[]; prefix: string; attemptId: string};
export class Broker extends WorkerEntrypoint<PipelineEnv, BrokerProps> {
  async fetch(request: Request): Promise<Response> {
    const scope = this.ctx.props, url = new URL(request.url);
    if (url.hostname !== 'broker.internal' || request.headers.get('authorization') !== 'Bearer ' + scope.token) return new Response(null, {status: 403});
    try {
      const op = await operation(this.env, scope.operationId, scope.generation);
      const key = url.pathname.slice(3).split('/').map(decodeURIComponent).join('/');
      if (key.split('/').some(part => !part || part === '.' || part === '..')) return new Response(null, {status: 403});
      if (request.method === 'GET' && url.pathname.startsWith('/r/') && scope.reads.includes(key)) {
        const object = await this.env.MEDIA.get(key);
        return object ? new Response(object.body) : new Response(null, {status: 404});
      }
      if (request.method !== 'PUT' || !url.pathname.startsWith('/w/') || !key.startsWith(scope.prefix + '/')) return new Response(null, {status: 403});
      const declared = request.headers.get('content-length'), length = Number(declared);
      if (declared === null || !Number.isSafeInteger(length) || length < 0 || length > 50 << 20) return new Response(null, {status: 413});
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length !== length) return new Response(null, {status: 413});
      const hash = sha256Bytes(bytes), previous = await this.env.MEDIA.head(key);
      if (previous && previous.customMetadata?.sha256 !== hash) return new Response(null, {status: 409});
      if (!previous) await this.env.MEDIA.put(key, bytes, {onlyIf: new Headers({'If-None-Match': '*'}),
        customMetadata: {sha256: hash, operationId: op.id, attemptId: scope.attemptId},
        httpMetadata: {contentType: request.headers.get('content-type') ?? 'application/octet-stream'}});
      const actual = await this.env.MEDIA.head(key);
      if (actual?.customMetadata?.sha256 !== hash || actual.size !== length) return new Response(null, {status: 409});
      // A cancellation may leave a staged object. Only generation-fenced workflow commits publish it.
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
  async acquire(id: string, workspace: string, deadline: number) {
    return this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql, existing = sql.exec('SELECT * FROM leases WHERE id=?', id).toArray()[0];
      if (existing) {
        if (existing.workspace !== workspace || existing.kind !== 'render') throw Error('LEASE_CONFLICT');
        return true;
      }
      // Any unconfirmed physical stop still occupies capacity.
      const rows = sql.exec('SELECT workspace,COUNT(*) AS n FROM leases GROUP BY workspace').toArray();
      const global = rows.reduce((sum, row) => sum + Number(row.n), 0);
      const local = rows.filter(row => row.workspace === workspace).reduce((sum, row) => sum + Number(row.n), 0);
      if (global >= nativeRenderPolicy.globalInstances || local >= nativeRenderPolicy.workspaceInstances) return false;
      sql.exec('INSERT INTO leases VALUES(?,?,?,?)', id, workspace, 'render', deadline);
      return true;
    });
  }
  async release(id: string) {
    if (!await this.env.SHARDS.getByName(id).isStopped()) throw Error('COMPUTE_STILL_RUNNING');
    this.ctx.storage.sql.exec('DELETE FROM leases WHERE id=?', id);
  }
  async arm() { await this.ctx.storage.setAlarm(Date.now() + 15000); }
  async alarm() {
    const leases = this.ctx.storage.sql.exec('SELECT * FROM leases WHERE deadline<=?', Date.now()).toArray();
    for (const lease of leases) {
      try { await this.env.SHARDS.getByName(String(lease.id)).stopAndSettle(); await this.release(String(lease.id)); }
      catch { /* A deadline is not proof of stopped compute or settled usage. */ }
    }
    if (this.ctx.storage.sql.exec('SELECT id FROM leases LIMIT 1').toArray().length) await this.arm();
  }
  async counts() { return this.ctx.storage.sql.exec('SELECT workspace,kind,COUNT(*) AS count FROM leases GROUP BY workspace,kind').toArray(); }
}

/** Deployed DO name; its sole execution mode is one complete native project per container. */
export class ShardDO extends DurableObject<PipelineEnv> {
  private token: string | undefined;
  private work: Promise<Json> | undefined;
  private workHash: string | undefined;
  private async call(path: string, body?: unknown, signal?: AbortSignal) {
    return this.ctx.container!.getTcpPort(8080).fetch('http://container' + path,
      {...(body === undefined ? {} : {method: 'POST', body: canonical(body), headers: {'content-type': 'application/json'}}), ...(signal ? {signal} : {})});
  }
  async imageDigest() {
    const hash = this.ctx.container!.images.render?.match(/sha256:[a-f0-9]{64}/)?.[0];
    if (!hash) throw Error('RENDER_IMAGE_DIGEST_UNAVAILABLE');
    return hash;
  }
  async isStopped() { return !this.ctx.container!.running; }
  async stop() {
    // An attempt ID cannot be reused by a delayed execute RPC after a confirmed stop.
    this.ctx.storage.kv.put('stopRequested', true);
    if (this.ctx.container!.running) await this.ctx.container!.destroy();
    if (this.ctx.container!.running) throw Error('COMPUTE_STOP_UNCONFIRMED');
    this.token = undefined;
  }
  async execute(serialized: string): Promise<string> {
    const task = parseCanonicalJson(serialized) as Json, hash = digest(task);
    if (this.work) {
      if (hash !== this.workHash) throw Error('TASK_ALREADY_BOUND');
      return canonical(await this.work);
    }
    this.workHash = hash;
    this.work = this.executeOnce(task);
    return canonical(await this.work);
  }
  private async executeOnce(task: Json): Promise<Json> {
    await assertNativeExecution(task);
    const hash = digest(task), bound = await this.ctx.storage.get<string>('requestHash');
    if (bound && bound !== hash) throw Error('TASK_ALREADY_BOUND');
    const previous = await this.ctx.storage.get<Json>('result');
    if (previous) { await this.stopAndSettle(); return previous; }
    if (this.ctx.storage.kv.get('stopRequested')) throw Error('COMPUTE_ATTEMPT_STOPPED');
    if (bound) throw Error('COMPUTE_ATTEMPT_LOST');
    const op = await operation(this.env, task.operationId, task.generation);
    const release = await this.env.DB.prepare('SELECT * FROM renderer_releases WHERE id=? AND status=\'active\'')
      .bind(task.rendererRelease).first<Json>();
    if (!release || release.runtime_version !== task.runtimeVersion || release.image_digest !== task.imageDigest
      || release.image_digest !== await this.imageDigest()) throw Error('RENDER_ENVIRONMENT_MISMATCH');
    const deadlineAt = task.deadlineAt as number;
    if (deadlineAt <= Date.now()) throw Error('RENDER_DEADLINE');
    let startedAt: number | undefined, reserved = false, acquired = false;
    let failed = false, failure: unknown, phase: 'startup' | 'broker' | 'dispatch' | 'execute' = 'startup';
    try {
      const capacityStartedAt = Date.now();
      for (;;) {
        if (this.ctx.storage.kv.get('stopRequested')) throw Error('COMPUTE_ATTEMPT_STOPPED');
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        await operation(this.env, op.id, op.generation);
        acquired = await coordinator(this.env).acquire(task.taskId, op.workspace_id, deadlineAt + 30000);
        if (acquired) break;
        await sleep(Math.min(250, Math.max(0, deadlineAt - Date.now())));
      }
      const capacityWaitMs = Date.now() - capacityStartedAt;
      await coordinator(this.env).arm();
      await operation(this.env, op.id, op.generation);
      const remaining = deadlineAt - Date.now();
      if (remaining < 1) throw Error('RENDER_DEADLINE');
      await reserve(this.env, op, task.taskId, 'compute', 'render', computeMicros(task.instance, remaining + 30000),
        task, 'cloudflare-containers-2026-10-23-upper-bound', 10000000, op.max_micros);
      reserved = true;
      await this.ctx.storage.put({requestHash: hash, taskId: task.taskId, instance: task.instance});
      await this.ctx.storage.setAlarm(deadlineAt);
      this.token = crypto.randomUUID() + crypto.randomUUID();
      const input = nativeContainerInput(task, this.token);
      const prefix = 'renders/' + task.renderId + '/attempts/' + task.taskId + '/out';
      const broker = this.ctx.exports.Broker({props: {token: this.token, operationId: op.id, generation: op.generation,
        reads: task.project.files.map((file: Json) => file.key), prefix, attemptId: task.taskId}});
      phase = 'broker';
      const brokerStartedAt = Date.now(), brokerDeadline = Math.min(brokerStartedAt + 30000, deadlineAt);
      let brokerTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.ctx.container!.interceptOutboundHttp('broker.internal', broker),
          new Promise<never>((_, reject) => {brokerTimer = setTimeout(() => reject(Error('RENDER_BROKER_REGISTRATION_TIMEOUT')), Math.max(1, brokerDeadline - Date.now()));})]);
        if (Date.now() >= brokerDeadline) throw Error('RENDER_BROKER_REGISTRATION_TIMEOUT');
      } finally { if (brokerTimer !== undefined) clearTimeout(brokerTimer); }
      const brokerRegistrationMs = Date.now() - brokerStartedAt;
      await operation(this.env, op.id, op.generation);
      if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
      startedAt = Date.now();
      await this.ctx.storage.put('startedAt', startedAt);
      if (this.ctx.storage.kv.get('stopRequested')) throw Error('COMPUTE_ATTEMPT_STOPPED');
      phase = 'startup';
      const bootAt = Date.now();
      this.ctx.container!.start({image: this.ctx.container!.images.render!, instance: task.instance, enableInternet: false,
        env: {RENDER_IMAGE_DIGEST: release.image_digest, RENDERER_RELEASE: release.id}});
      const monitor = {state: 'pending' as 'pending' | 'exited' | 'rejected'};
      void this.ctx.container!.monitor().then(() => {monitor.state = 'exited';}, () => {monitor.state = 'rejected';});
      let environmentHealth: Json | null = null;
      const startupDeadline = Math.min(bootAt + nativeRenderPolicy.containerStartupMs, deadlineAt);
      while (Date.now() < startupDeadline && monitor.state === 'pending') {
        await operation(this.env, op.id, op.generation);
        if (this.ctx.storage.kv.get('stopRequested')) throw Error('COMPUTE_ATTEMPT_STOPPED');
        try {
          const health = await this.call('/healthz', undefined, AbortSignal.timeout(Math.max(1, Math.min(5000, startupDeadline - Date.now()))));
          if (health.ok) {
            const value = parseCanonicalJson(await health.text()) as Json;
            if (value?.ok === true && value.runtime === 'huashu-motion' && value.nativeCommit === task.runtimeVersion
              && Date.now() < startupDeadline) {environmentHealth = value; break;}
          }
        } catch { /* Continue the bounded readiness probe; no paid task has been dispatched. */ }
        if (Date.now() < startupDeadline) await sleep(Math.min(250, startupDeadline - Date.now()));
      }
      if (!environmentHealth || monitor.state !== 'pending') throw Error(monitor.state === 'pending' ? 'RENDER_STARTUP_TIMEOUT' : 'RENDER_STARTUP_EXITED');
      const containerReadyMs = Date.now() - bootAt;
      await operation(this.env, op.id, op.generation);
      if (this.ctx.storage.kv.get('stopRequested')) throw Error('COMPUTE_ATTEMPT_STOPPED');
      phase = 'dispatch';
      if (!(await this.call('/task', input, AbortSignal.timeout(Math.max(1, Math.min(15000, deadlineAt - Date.now()))))).ok) throw Error('RENDER_TASK_REJECTED');
      phase = 'execute';
      for (;;) {
        await operation(this.env, op.id, op.generation);
        if (Date.now() >= deadlineAt) throw Error('RENDER_DEADLINE');
        if (monitor.state !== 'pending') throw Error('RENDER_CONTAINER_EXITED');
        const response = await this.call('/result', undefined, AbortSignal.timeout(Math.max(1, Math.min(15000, deadlineAt - Date.now()))));
        if (!response.ok) throw Error('RENDER_CONTROLLER_UNAVAILABLE');
        const value = await response.json<Json>();
        if (value.status === 'failed') {
          const code = value.error?.code ?? value.code;
          throw Error(typeof code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(code) ? code : 'NATIVE_RENDER_FAILED');
        }
        if (value.status === 'cancelled') throw Error('NATIVE_RENDER_CANCELLED');
        if (value.status === 'succeeded') {
          const outcome = {...value, environmentHealth, lifecycleTimings: {capacityWaitMs, brokerRegistrationMs, containerReadyMs}};
          await this.ctx.storage.put('result', outcome);
          return outcome;
        }
        await sleep(1000);
      }
    } catch (error) {
      const message = String((error as {message?: unknown})?.message ?? error);
      const known = /no container instance that can be provided to this Durable Object/i.test(message) ? 'RENDER_CAPACITY_UNAVAILABLE'
        : message === 'Network connection lost.' ? 'RENDER_' + phase.toUpperCase() + '_CONNECTION_LOST' : null;
      failed = true; failure = known ? Error(known) : error;
      const code = known ?? message.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)?.[1] ?? 'RENDER_INTERNAL_ERROR';
      try {
        await this.env.DB.prepare('UPDATE pipeline_attempts SET result_json=COALESCE(result_json,?) WHERE id=?')
          .bind(canonical({status: 'failed', code, phase}), task.taskId).run();
      } catch { /* Diagnostics never replace the first execution failure. */ }
      throw failure;
    } finally {
      try {
        await this.stop();
        if (acquired) await coordinator(this.env).release(task.taskId);
        await this.ctx.storage.deleteAlarm();
        if (reserved) await this.finishCost(task.taskId, task.instance, startedAt);
      } catch (error) { if (failed) throw failure; throw error; }
    }
  }
  private async finishCost(id: string, instance: string, startedAt?: number) {
    const usage = this.ctx.storage.transactionSync(() => {
      const previous = this.ctx.storage.kv.get<Json>('costUsage');
      if (previous) return previous;
      const value = {kind: 'allocated_resource_upper_bound', runningMs: startedAt === undefined ? 0 : Date.now() - startedAt, instance};
      this.ctx.storage.kv.put('costUsage', value);
      return value;
    });
    await settle(this.env, id, computeMicros(instance, usage.runningMs), usage);
  }
  async alarm() { await this.stopAndSettle(); }
  async stopAndSettle() {
    await this.stop();
    const id = await this.ctx.storage.get<string>('taskId'), start = await this.ctx.storage.get<number>('startedAt'),
      instance = await this.ctx.storage.get<string>('instance');
    if (id) {
      await coordinator(this.env).release(id);
      if (instance) await this.finishCost(id, instance, start);
      await this.env.DB.prepare('UPDATE pipeline_attempts SET status=CASE WHEN status=\'active\' THEN \'stopped\' ELSE status END,stopped_at=COALESCE(stopped_at,?) WHERE id=?')
        .bind(Date.now(), id).run();
    }
    await this.ctx.storage.deleteAlarm();
  }
}

export class OperationDO extends DurableObject<PipelineEnv> {
  private listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  async progress(serialized: string) {
    const value = parseCanonicalJson(serialized) as Json;
    await this.ctx.storage.put('progress', value);
    const bytes = new TextEncoder().encode('data: ' + canonical(value) + '\n\n');
    for (const listener of this.listeners) {
      try {listener.enqueue(bytes);} catch {this.listeners.delete(listener);}
    }
  }
  async watch(operationId: string) {
    await operation(this.env, operationId);
    const initial = await this.ctx.storage.get<Json>('progress') ?? {operationId, status: 'active'};
    let listener: ReadableStreamDefaultController<Uint8Array>, timer: ReturnType<typeof setTimeout>;
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        listener = controller; this.listeners.add(controller);
        controller.enqueue(new TextEncoder().encode('data: ' + canonical(initial) + '\n\n'));
        timer = setTimeout(() => {this.listeners.delete(controller); controller.close();}, 25000);
      }, cancel: () => {clearTimeout(timer); this.listeners.delete(listener);},
    });
    return new Response(body, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-store'}});
  }
}
