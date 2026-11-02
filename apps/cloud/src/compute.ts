import {DurableObject, WorkerEntrypoint} from 'cloudflare:workers';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {operation, rights, reserve, settle} from './store.ts';
import {putBoundedUpload, matchesStoredUpload, verifyUploadStream} from './upload-stream.ts';
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

type BrokerProps = {token: string; operationId: string; generation: number; reads: string[]; resources: Json[]; prefix: string; attemptId: string};
export class Broker extends WorkerEntrypoint<PipelineEnv, BrokerProps> {
  async fetch(request: Request): Promise<Response> {
    const scope = this.ctx.props, url = new URL(request.url);
    if (url.hostname !== 'broker.internal' || request.headers.get('authorization') !== 'Bearer ' + scope.token) return new Response(null, {status: 403});
    try {
      const op = await operation(this.env, scope.operationId, scope.generation);
      const key = url.pathname.slice(3).split('/').map(decodeURIComponent).join('/');
      if (key.split('/').some(part => !part || part === '.' || part === '..')) return new Response(null, {status: 403});
      if (request.method === 'GET' && url.pathname.startsWith('/r/') && scope.reads.includes(key)) {
        await rights(this.env, op, scope.resources);
        const object = await this.env.MEDIA.get(key);
        return object ? new Response(object.body) : new Response(null, {status: 404});
      }
      if (request.method !== 'PUT' || !url.pathname.startsWith('/w/') || !key.startsWith(scope.prefix + '/')) return new Response(null, {status: 403});
      const declared = request.headers.get('content-length'), length = Number(declared);
      const hash = request.headers.get('x-content-sha256');
      if (declared === null || !Number.isSafeInteger(length) || length < 0 || length > 50 << 20) return new Response(null, {status: 413});
      if (!hash || !/^[a-f0-9]{64}$/.test(hash)) return new Response(null, {status: 400});
      const previous = await this.env.MEDIA.head(key);
      if (previous && !matchesStoredUpload(previous, length, hash)) return new Response(null, {status: 409});
      try {
        if (previous) await verifyUploadStream(request.body, length, hash);
        else {
          // R2 validates the declared SHA-256 before committing the object.
          // Both the worker's bounded transform and R2's checksum must pass.
          const created = await putBoundedUpload(this.env.MEDIA, key, request.body, length, {
            onlyIf: new Headers({'If-None-Match': '*'}), sha256: hash,
            customMetadata: {sha256: hash, operationId: op.id, attemptId: scope.attemptId},
            httpMetadata: {contentType: request.headers.get('content-type') ?? 'application/octet-stream'},
          });
          // A lost conditional race may not consume the incoming stream. Require a fresh retry.
          if (!created) return new Response(null, {status: 409});
        }
      } catch { return new Response(null, {status: 422}); }
      const actual = await this.env.MEDIA.head(key);
      if (!matchesStoredUpload(actual, length, hash)) return new Response(null, {status: 409});
      // A cancellation may leave a staged object. Only generation-fenced workflow commits publish it.
      await operation(this.env, scope.operationId, scope.generation);
      return new Response(null, {status: 201});
    } catch { return new Response(null, {status: 403}); }
  }
}

export class CoordinatorDO extends DurableObject<PipelineEnv> {
  constructor(ctx: DurableObjectState, env: PipelineEnv) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY,workspace TEXT NOT NULL,kind TEXT NOT NULL,deadline INTEGER NOT NULL,token TEXT NOT NULL DEFAULT '',generation INTEGER NOT NULL DEFAULT -1)");
    // Preserve leases held by an earlier deployed actor; an old unknown stop still consumes a slot.
    const columns = sql.exec('PRAGMA table_info(leases)').toArray().map(row => String(row.name));
    if (!columns.includes('token')) sql.exec("ALTER TABLE leases ADD COLUMN token TEXT NOT NULL DEFAULT ''");
    if (!columns.includes('generation')) sql.exec('ALTER TABLE leases ADD COLUMN generation INTEGER NOT NULL DEFAULT -1');
  }
  async acquire(id: string, workspace: string, generation: number, deadline: number) {
    const token = crypto.randomUUID();
    const lease = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql, existing = sql.exec('SELECT * FROM leases WHERE id=?', id).toArray()[0];
      if (existing) {
        if (existing.workspace !== workspace || existing.kind !== 'render' || existing.generation !== generation || !existing.token) throw Error('LEASE_CONFLICT');
        return {token: String(existing.token), created: false};
      }
      // Any unconfirmed physical stop still occupies capacity.
      const rows = sql.exec('SELECT workspace,COUNT(*) AS n FROM leases GROUP BY workspace').toArray();
      const global = rows.reduce((sum, row) => sum + Number(row.n), 0);
      const local = rows.filter(row => row.workspace === workspace).reduce((sum, row) => sum + Number(row.n), 0);
      if (global >= nativeRenderPolicy.globalInstances) return {blocked: 'global' as const};
      if (local >= nativeRenderPolicy.workspaceInstances) return {blocked: 'workspace' as const};
      sql.exec('INSERT INTO leases(id,workspace,kind,deadline,token,generation) VALUES(?,?,?,?,?,?)', id, workspace, 'render', deadline, token, generation);
      return {token, created: true};
    });
    if ('token' in lease) await this.arm();
    return lease;
  }
  async assertLease(id: string, workspace: string, generation: number, token: string) {
    const row = this.ctx.storage.sql.exec('SELECT * FROM leases WHERE id=?', id).toArray()[0];
    if (!row || row.workspace !== workspace || row.generation !== generation || row.token !== token || Number(row.deadline) <= Date.now())
      throw Error('RENDER_LEASE_FENCED');
  }
  async extend(id: string, token: string, deadline: number) {
    const changed = this.ctx.storage.sql.exec('UPDATE leases SET deadline=? WHERE id=? AND token=? AND deadline>?', deadline, id, token, Date.now());
    if (!changed.rowsWritten) throw Error('RENDER_LEASE_FENCED');
    await this.arm();
  }
  async release(id: string, token: string) {
    const row = this.ctx.storage.sql.exec('SELECT token FROM leases WHERE id=?', id).toArray()[0];
    if (!row) return;
    if (row.token !== token) throw Error('RENDER_LEASE_FENCED');
    if (!await this.env.SHARDS.getByName(id).isStopped()) throw Error('COMPUTE_STILL_RUNNING');
    const pending = await this.env.DB.prepare('SELECT r.id FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.id=? AND s.reservation_id IS NULL')
      .bind(id).first();
    if (pending) throw Error('COMPUTE_SETTLEMENT_UNCONFIRMED');
    await this.env.DB.prepare("UPDATE pipeline_render_admissions SET status='released' WHERE id=? AND lease_token=? AND status IN ('admitted','running')")
      .bind(id, token).run();
    this.ctx.storage.sql.exec('DELETE FROM leases WHERE id=? AND token=?', id, token);
    // The durable queue is the recovery source if this best-effort notification is lost.
    try { await this.env.OUTBOX.send({kind: 'admission'}); } catch {}
  }
  async arm() {
    const next = Date.now() + 15000;
    const existing = await this.ctx.storage.getAlarm();
    if (existing === null || existing > next) await this.ctx.storage.setAlarm(next);
  }
  async alarm() {
    try {
      const leases = this.ctx.storage.sql.exec('SELECT * FROM leases WHERE deadline<=?', Date.now()).toArray();
      // A stuck storage or Shard RPC cannot hold every other expired slot hostage.
      // The timed-out lease stays counted until a later confirmed stop/settlement.
      await Promise.allSettled(leases.map(async lease => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([(async () => {
            // An old alarm snapshot must not stop a re-granted ticket's Shard.
            const physical = await this.env.DB.prepare(`SELECT p.id FROM pipeline_attempts p
              LEFT JOIN pipeline_render_admissions a ON a.id=p.id
              WHERE p.id=? AND (a.id IS NULL OR a.lease_token=?)`)
              .bind(String(lease.id), String(lease.token)).first();
            if (physical) await this.env.SHARDS.getByName(String(lease.id)).stopAndSettle(false);
            await this.release(String(lease.id), String(lease.token));
          })(), new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error('RENDER_LEASE_CLEANUP_TIMEOUT')), 10_000);
          })]);
        } catch { /* An unconfirmed physical stop/settlement never frees capacity. */ }
        finally {if (timer !== undefined) clearTimeout(timer);}
      }));
    } finally {
      if (this.ctx.storage.sql.exec('SELECT id FROM leases LIMIT 1').toArray().length) await this.arm();
    }
  }
  async counts() { return this.ctx.storage.sql.exec('SELECT workspace,kind,COUNT(*) AS count FROM leases GROUP BY workspace,kind').toArray(); }
}

/** Deployed DO name; its sole execution mode is one complete native project per container. */
export class ShardDO extends DurableObject<PipelineEnv> {
  private token: string | undefined;
  private work: Promise<Json> | undefined;
  private workHash: string | undefined;
  private reservationInFlight: Promise<void> | undefined;
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
  /** Only a never-bound Shard may be reused after an unstarted grant expires. */
  async resetUnstartedAdmission(id: string, leaseToken: string) {
    const safe = await this.env.DB.prepare(`SELECT a.id FROM pipeline_render_admissions a
      JOIN pipeline_renders r ON r.id=a.render_id JOIN pipeline_operations o ON o.id=a.operation_id
      WHERE a.id=? AND a.lease_token=? AND a.status='released' AND r.status='queued'
        AND r.generation=a.generation AND o.status='active' AND o.generation=a.generation
        AND NOT EXISTS (SELECT 1 FROM pipeline_attempts p WHERE p.id=a.id)`)
      .bind(id, leaseToken).first();
    if (!safe || this.ctx.container!.running || this.work || this.workHash ||
      ['requestHash','taskId','taskScope','startedAt','result','costUsage','usageUnknown'].some(key => this.ctx.storage.kv.get(key) !== undefined))
      throw Error('COMPUTE_ATTEMPT_STOPPED');
    this.ctx.storage.kv.delete('stopRequested');
  }
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
  /** Read a proven successful Shard result without ever dispatching a new container task. */
  async recoverCompletedResult(expected: {attemptId: string; renderId: string; operationId: string;
    generation: number; leaseToken: string}): Promise<string | null> {
    // The original RPC may have disconnected while its execution coroutine
    // was still saving the successful result. Its absence is not a failure
    // until that coroutine has finished; an unresolved outcome stays unknown.
    if (!await this.ctx.storage.get<Json>('result') && this.work) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const settled = await Promise.race([this.work.then(() => true, () => true),
          new Promise<boolean>(resolve => {timer = setTimeout(() => resolve(false), 5000);})]);
        if (!settled) throw Error('RENDER_ATTEMPT_OUTCOME_UNKNOWN');
      } finally {if (timer !== undefined) clearTimeout(timer);}
    }
    const result = await this.ctx.storage.get<Json>('result');
    if (!result) {
      // After an isolate restart this.work is gone. A bound task without a
      // durable completion marker may still be committing its final result.
      // A container stop alone cannot turn that unknown outcome into failure.
      if (await this.ctx.storage.get<string>('requestHash')
        && !await this.ctx.storage.get<boolean>('workFinished')) throw Error('RENDER_ATTEMPT_OUTCOME_UNKNOWN');
      return null;
    }
    const scope = await this.ctx.storage.get<typeof expected>('taskScope');
    if (!scope || scope.attemptId !== expected.attemptId || scope.renderId !== expected.renderId
      || scope.operationId !== expected.operationId || scope.generation !== expected.generation
      || scope.leaseToken !== expected.leaseToken
      || result.status !== 'succeeded') throw Error('RENDER_ATTEMPT_SCOPE_INVALID');
    // A stored success is already immutable. Independently confirm stop, cost
    // and lease release even if the original finally is still completing.
    await this.stopAndSettle();
    return canonical(result);
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
    const admission = await this.env.DB.prepare("SELECT admitted_at FROM pipeline_render_admissions WHERE id=? AND render_id=? AND operation_id=? AND generation=? AND status='running' AND lease_token=? AND attempt_deadline_at=?")
      .bind(task.taskId, task.renderId, task.operationId, task.generation, task.leaseToken, deadlineAt).first<{admitted_at: number}>();
    if (!admission) throw Error('RENDER_LEASE_FENCED');
    await coordinator(this.env).assertLease(task.taskId, op.workspace_id, op.generation, task.leaseToken);
    let startedAt: number | undefined;
    let failed = false, failure: unknown, phase: 'startup' | 'broker' | 'dispatch' | 'execute' = 'startup';
    let failedResourceUsage: Json | undefined;
    try {
      const capacityWaitMs = Number(admission.admitted_at) - Number(task.queuedAt ?? admission.admitted_at);
      await operation(this.env, op.id, op.generation);
      const remaining = deadlineAt - Date.now();
      if (remaining < 1) throw Error('RENDER_DEADLINE');
      // Bind the identity durably before D1 may commit a reservation. A lost
      // reserve response must still leave enough state for stopAndSettle.
      await this.ctx.storage.put({requestHash: hash, taskId: task.taskId, instance: task.instance,
        leaseToken: task.leaseToken, taskScope: {attemptId: task.taskId, renderId: task.renderId,
          operationId: task.operationId, generation: task.generation, leaseToken: task.leaseToken}});
      if (this.ctx.storage.kv.get('stopRequested')) throw Error('COMPUTE_ATTEMPT_STOPPED');
      const reservation = reserve(this.env, op, task.taskId, 'compute', 'render', computeMicros(task.instance, remaining + 30000),
        task, 'cloudflare-containers-2026-10-23-upper-bound', 10000000, op.max_micros);
      this.reservationInFlight = reservation;
      try {await reservation;} finally {this.reservationInFlight = undefined;}
      if (this.ctx.storage.kv.get('stopRequested')) throw Error('COMPUTE_ATTEMPT_STOPPED');
      await this.ctx.storage.setAlarm(deadlineAt);
      this.token = crypto.randomUUID() + crypto.randomUUID();
      const input = nativeContainerInput(task, this.token);
      const prefix = 'renders/' + task.renderId + '/attempts/' + task.taskId + '/out';
      const broker = this.ctx.exports.Broker({props: {token: this.token, operationId: op.id, generation: op.generation,
        reads: task.project.files.map((file: Json) => file.key), resources: task.project.resources, prefix, attemptId: task.taskId}});
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
        if (value.status === 'failed' || value.status === 'cancelled') {
          if (value.resourceUsage && typeof value.resourceUsage === 'object') failedResourceUsage = value.resourceUsage;
        }
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
          .bind(canonical({status: 'failed', code, phase, ...(failedResourceUsage ? {resourceUsage: failedResourceUsage} : {})}), task.taskId).run();
      } catch { /* Diagnostics never replace the first execution failure. */ }
      throw failure;
    } finally {
      let cleanupError: unknown;
      try {
        await this.stopAndSettle();
      } catch (error) {cleanupError = error;}
      // The coroutine has finished even when an external cleanup RPC failed.
      // Recovery must still re-confirm stop and settlement before retrying;
      // otherwise a transient cleanup failure leaves workFinished absent forever.
      await this.ctx.storage.put('workFinished', true);
      if (cleanupError) {if (failed) throw failure; throw cleanupError;}
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
  async stopAndSettle(releaseLease = true) {
    const wasRunning = this.ctx.container!.running;
    // Remember an observed running container before destroying the evidence.
    // A later alarm must not mistake the now-stopped container for zero usage.
    if (wasRunning && await this.ctx.storage.get<number>('startedAt') === undefined)
      await this.ctx.storage.put('usageUnknown', true);
    await this.stop();
    // An alarm or cancellation can race an in-flight reserve write. Keep its
    // lease until the write is known, then settle any committed reservation.
    if (this.reservationInFlight) try {await this.reservationInFlight;} catch {}
    const id = await this.ctx.storage.get<string>('taskId'), start = await this.ctx.storage.get<number>('startedAt'),
      instance = await this.ctx.storage.get<string>('instance'), token = await this.ctx.storage.get<string>('leaseToken'),
      requestHash = await this.ctx.storage.get<string>('requestHash');
    if (start === undefined && await this.ctx.storage.get<boolean>('usageUnknown')) throw Error('COMPUTE_USAGE_UNKNOWN');
    if (id) {
      const reservation = await this.env.DB.prepare('SELECT kind,request_hash FROM cost_reservations WHERE id=?')
        .bind(id).first<{kind: string; request_hash: string}>();
      if (reservation) {
        if (!instance || !requestHash || reservation.kind !== 'compute' || reservation.request_hash !== requestHash)
          throw Error('COST_RESERVATION_CONFLICT');
        await this.finishCost(id, instance, start);
      } else if (start !== undefined) {
        // A task with startup evidence cannot be assumed to have zero usage.
        throw Error('COMPUTE_RESERVATION_MISSING');
      }
      await this.env.DB.prepare('UPDATE pipeline_attempts SET status=CASE WHEN status=\'active\' THEN \'stopped\' ELSE status END,stopped_at=COALESCE(stopped_at,?) WHERE id=?')
        .bind(Date.now(), id).run();
      if (releaseLease && token) await coordinator(this.env).release(id, token);
    }
    await this.ctx.storage.deleteAlarm();
  }
}

export class OperationDO extends DurableObject<PipelineEnv> {
  private listeners = new Map<ReadableStreamDefaultController<Uint8Array>,ReturnType<typeof setTimeout>>();
  async progress(serialized: string) {
    const value = parseCanonicalJson(serialized) as Json;
    await this.ctx.storage.put('progress', value);
    const bytes = new TextEncoder().encode('data: ' + canonical(value) + '\n\n');
    for (const [listener,timer] of this.listeners) {
      if (listener.desiredSize === null || listener.desiredSize <= 0) {
        // A slow or abandoned SSE reader must not accumulate an unbounded
        // in-memory progress queue. Its next connection gets the latest snapshot.
        clearTimeout(timer);this.listeners.delete(listener);
        try{listener.close();}catch{}
        continue;
      }
      try{listener.enqueue(bytes);}catch{clearTimeout(timer);this.listeners.delete(listener);}
    }
  }
  async watch(operationId: string) {
    await operation(this.env, operationId);
    if (this.listeners.size >= 100) return new Response(null,{status:429,headers:{'retry-after':'1'}});
    const initial = await this.ctx.storage.get<Json>('progress') ?? {operationId, status: 'active'};
    let listener: ReadableStreamDefaultController<Uint8Array>, timer: ReturnType<typeof setTimeout>;
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        listener = controller;
        controller.enqueue(new TextEncoder().encode('data: ' + canonical(initial) + '\n\n'));
        timer = setTimeout(() => {this.listeners.delete(controller);try{controller.close();}catch{}}, 25000);
        this.listeners.set(controller,timer);
      }, cancel: () => {clearTimeout(timer); this.listeners.delete(listener);},
    },{highWaterMark:8});
    return new Response(body, {headers: {'content-type': 'text/event-stream', 'cache-control': 'no-store'}});
  }
}
