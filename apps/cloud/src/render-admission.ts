import {canonical} from '@promobento/contracts/canonical';
import {operation} from './store.ts';
import {nativeRenderPolicy} from './native-policy.ts';
import type {WorkflowStep} from 'cloudflare:workers';
import type {PipelineEnv, Json, Operation} from './pipeline-types.ts';

type Admission = {
  id: string; render_id: string; operation_id: string; generation: number; workspace_id: string;
  attempt_index: number; status: string; requested_at: number; queue_deadline_at: number;
  lease_token: string | null; admitted_at: number | null; attempt_deadline_at: number | null;
  notification_sent_at: number | null; notification_retry_at: number; notification_failures: number;
  operation_deadline_at?: number; mode?: string;
};

const coordinator = (env: PipelineEnv) => env.COORDINATOR.getByName('global-v1');
const eventType = (index: number) => `native-admission-${index}`;

/** A queue ticket is not a physical attempt and does not reserve compute budget. */
export async function requestRenderAdmission(env: PipelineEnv, renderId: string, op: Operation, id: string, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= nativeRenderPolicy.maxAttempts) throw Error('RENDER_ATTEMPT_LIMIT');
  const render = await env.DB.prepare('SELECT queue_deadline_at,operation_deadline_at FROM pipeline_renders WHERE id=? AND operation_id=? AND generation=?')
    .bind(renderId, op.id, op.generation).first<{queue_deadline_at: number | null; operation_deadline_at: number | null}>();
  if (!render?.queue_deadline_at || !render.operation_deadline_at) throw Error('RENDER_ADMISSION_MISSING');
  // A physical retry gets its own waiting window, but never extends the render's total deadline.
  const queueDeadlineAt = index === 0 ? render.queue_deadline_at : Math.min(Date.now() + nativeRenderPolicy.queueWaitMs, render.operation_deadline_at);
  await env.DB.prepare(`INSERT OR IGNORE INTO pipeline_render_admissions
    (id,render_id,operation_id,generation,workspace_id,attempt_index,status,requested_at,queue_deadline_at)
    SELECT ?,?,?,?,?,?,'queued',?,? WHERE EXISTS
    (SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id
      WHERE r.id=? AND r.operation_id=? AND r.generation=? AND r.status='queued'
      AND o.status='active' AND o.generation=?)`)
    .bind(id, renderId, op.id, op.generation, op.workspace_id, index, Date.now(), queueDeadlineAt,
      renderId, op.id, op.generation, op.generation).run();
  const row = await env.DB.prepare('SELECT * FROM pipeline_render_admissions WHERE id=? AND render_id=? AND operation_id=? AND generation=? AND attempt_index=?')
    .bind(id, renderId, op.id, op.generation, index).first<Admission>();
  if (!row || !['queued', 'admitted', 'running'].includes(row.status)) throw Error('RENDER_FENCED');
  await dispatchRenderAdmissions(env);
  return {id, requestedAt: row.requested_at, queueDeadlineAt: row.queue_deadline_at, operationDeadlineAt: render.operation_deadline_at};
}

async function notify(env: PipelineEnv, row: Admission) {
  const markDone = () => env.DB.prepare(`UPDATE pipeline_render_admissions SET notification_sent_at=?
    WHERE id=? AND status=? AND COALESCE(lease_token,'')=? AND notification_sent_at IS NULL`)
    .bind(Date.now(), row.id, row.status, row.lease_token ?? '').run();
  try {
    await (await env.RENDER_WORKFLOW.get(row.render_id)).sendEvent({type: eventType(row.attempt_index), payload: {
      attemptId: row.id, ...(row.status === 'expired' ? {expired: true} : {leaseToken: row.lease_token}),
    }});
  } catch (error) {
    let terminal = false;
    try {
      const status = await (await env.RENDER_WORKFLOW.get(row.render_id)).status();
      terminal = ['complete', 'errored', 'terminated'].includes(status.status);
    } catch { /* An unknown Workflow state is not proof that delivery is impossible. */ }
    if (terminal) {
      try {
        // A finished Workflow cannot consume the event. An admitted orphan must also return its slot.
        if (row.status === 'admitted') await stopRenderAdmissions(env, row.render_id);
        await markDone();
        return;
      } catch { /* A failed physical stop must remain retryable. */ }
    }
    const delay = Math.min(5 * 60_000, 5000 * 2 ** Math.min(row.notification_failures, 6));
    await env.DB.prepare(`UPDATE pipeline_render_admissions
      SET notification_failures=notification_failures+1,notification_retry_at=MAX(notification_retry_at,?)
      WHERE id=? AND status=? AND COALESCE(lease_token,'')=? AND notification_sent_at IS NULL`)
      .bind(Date.now() + delay, row.id, row.status, row.lease_token ?? '').run();
    throw error;
  }
  await markDone();
}

/** Called by new tickets, freed capacity and a slow recovery sweep. No busy-waiting consumers. */
export async function dispatchRenderAdmissions(env: PipelineEnv) {
  const expired = await env.DB.prepare(`SELECT a.* FROM pipeline_render_admissions a
    JOIN pipeline_renders r ON r.id=a.render_id JOIN pipeline_operations o ON o.id=a.operation_id
    WHERE a.status='queued' AND r.status='queued' AND o.status='active' AND o.generation=a.generation
      AND (a.queue_deadline_at<=? OR r.operation_deadline_at<=?)
    ORDER BY a.requested_at LIMIT 128`).bind(Date.now(), Date.now()).all<Admission>();
  for (const row of expired.results) {
    const changed = await env.DB.prepare("UPDATE pipeline_render_admissions SET status='expired' WHERE id=? AND status='queued'").bind(row.id).run();
    if (changed.meta.changes) try {await notify(env, {...row,status:'expired'});} catch {}
  }
  const waiting = await env.DB.prepare(`WITH ready AS (
    SELECT a.*,r.mode,r.operation_deadline_at,
      ROW_NUMBER() OVER(PARTITION BY a.workspace_id ORDER BY a.requested_at,a.render_id) AS workspace_rank
    FROM pipeline_render_admissions a JOIN pipeline_renders r ON r.id=a.render_id
      JOIN pipeline_operations o ON o.id=a.operation_id
    WHERE a.status='queued' AND r.status='queued' AND r.generation=a.generation
      AND o.status='active' AND o.generation=a.generation)
    SELECT * FROM ready WHERE workspace_rank=1 ORDER BY requested_at,render_id LIMIT 64`).all<Admission>();
  for (const row of waiting.results) {
    if (Date.now() >= Math.min(row.queue_deadline_at, row.operation_deadline_at!)) {
      const expired = await env.DB.prepare("UPDATE pipeline_render_admissions SET status='expired' WHERE id=? AND status='queued'")
        .bind(row.id).run();
      if (expired.meta.changes) try {await notify(env, {...row, status: 'expired'});} catch {}
      continue;
    }
    const attemptMs = row.mode === 'preview' ? nativeRenderPolicy.previewDeadlineMs : nativeRenderPolicy.exportDeadlineMs;
    const lease = await coordinator(env).acquire(row.id, row.workspace_id, row.generation,
      Math.min(row.operation_deadline_at!, Date.now() + attemptMs + 2 * 60_000));
    if ('blocked' in lease) {
      if (lease.blocked === 'global') break;
      continue;
    }
    const updated = await env.DB.prepare(`UPDATE pipeline_render_admissions SET status='admitted',lease_token=?,admitted_at=?
      WHERE id=? AND status='queued' AND queue_deadline_at>? AND EXISTS
      (SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id
        WHERE r.id=? AND r.status='queued' AND r.generation=? AND r.operation_deadline_at>?
          AND o.status='active' AND o.generation=?)`)
      .bind(lease.token, Date.now(), row.id, Date.now(), row.render_id, row.generation, Date.now(), row.generation).run();
    if (!updated.meta.changes) {
      // A second dispatcher may have won the D1 CAS using our already-created DO lease.
      // It must not be released out from under that winner.
      const current = await env.DB.prepare('SELECT status,lease_token FROM pipeline_render_admissions WHERE id=?')
        .bind(row.id).first<{status: string; lease_token: string | null}>();
      if (lease.created && !(current?.lease_token === lease.token && ['admitted','running'].includes(current.status)))
        await coordinator(env).release(row.id, lease.token);
      continue;
    }
    try {await notify(env, {...row, status: 'admitted', lease_token: lease.token});} catch {}
  }
  // Event delivery can fail after admission; its D1 record remains retryable.
  const unsent = await env.DB.prepare(`SELECT * FROM pipeline_render_admissions
    WHERE status IN ('admitted','expired') AND notification_sent_at IS NULL AND notification_retry_at<=?
    ORDER BY CASE status WHEN 'admitted' THEN 0 ELSE 1 END,notification_retry_at,requested_at LIMIT 32`)
    .bind(Date.now()).all<Admission>();
  for (const row of unsent.results) {
    try { await notify(env, row); } catch { /* Scheduled sweep retries without granting a second lease. */ }
  }
}

type AdmissionTicket = {id: string; queueDeadlineAt: number; operationDeadlineAt: number};

async function timelyAdmission(env: PipelineEnv, ticket: AdmissionTicket) {
  const row = await env.DB.prepare(`SELECT a.status,a.admitted_at,a.lease_token,a.workspace_id,a.generation FROM pipeline_render_admissions a
    JOIN pipeline_renders r ON r.id=a.render_id JOIN pipeline_operations o ON o.id=a.operation_id
    WHERE a.id=? AND r.generation=a.generation AND r.status IN ('queued','rendering')
      AND o.generation=a.generation AND o.status='active'`)
    .bind(ticket.id).first<{status: string; admitted_at: number | null; lease_token: string | null; workspace_id: string; generation: number}>();
  if (!row || !['admitted', 'running'].includes(row.status) || !row.lease_token
    || row.admitted_at === null || row.admitted_at > Math.min(ticket.queueDeadlineAt, ticket.operationDeadlineAt)
    || Date.now() >= ticket.operationDeadlineAt) return null;
  // D1 can lag the Coordinator alarm; never return an expired physical lease.
  try { await coordinator(env).assertLease(ticket.id, row.workspace_id, row.generation, row.lease_token); }
  catch { return null; }
  return row.lease_token;
}

/** A released grant with no physical attempt may reuse its original queue window. */
async function restoreUnstartedAdmission(env: PipelineEnv, ticket: AdmissionTicket) {
  if (Date.now() >= Math.min(ticket.queueDeadlineAt, ticket.operationDeadlineAt)) return;
  const row = await env.DB.prepare(`SELECT a.status,a.lease_token FROM pipeline_render_admissions a
    JOIN pipeline_renders r ON r.id=a.render_id JOIN pipeline_operations o ON o.id=a.operation_id
    WHERE a.id=? AND r.status='queued' AND r.generation=a.generation
      AND o.status='active' AND o.generation=a.generation`)
    .bind(ticket.id).first<{status: string; lease_token: string | null}>();
  if (row?.status !== 'released' || !row.lease_token) return;
  const physical = await env.DB.prepare('SELECT id FROM pipeline_attempts WHERE id=?').bind(ticket.id).first();
  if (physical) return; // A real attempt must never be replayed as a capacity ticket.
  // release() is idempotent and serves as a barrier for a concurrent alarm that
  // wrote D1 before deleting the old CoordinatorDO lease.
  await coordinator(env).release(ticket.id, row.lease_token);
  // The alarm stopped this ShardDO even if no execution ever started. Reusing
  // its ticket requires clearing that permanent stop fence under D1 guards.
  await env.SHARDS.getByName(ticket.id).resetUnstartedAdmission(ticket.id, row.lease_token);
  const changed = await env.DB.prepare(`UPDATE pipeline_render_admissions
    SET status='queued',lease_token=NULL,admitted_at=NULL,attempt_deadline_at=NULL,notification_sent_at=NULL,
      notification_retry_at=0,notification_failures=0
    WHERE id=? AND status='released' AND lease_token=? AND queue_deadline_at>?
      AND NOT EXISTS(SELECT 1 FROM pipeline_attempts WHERE id=?)
      AND EXISTS(SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id
        WHERE r.id=pipeline_render_admissions.render_id AND r.status='queued'
          AND r.operation_deadline_at>? AND r.generation=pipeline_render_admissions.generation
          AND o.status='active' AND o.generation=r.generation)`)
    .bind(ticket.id, row.lease_token, Date.now(), ticket.id, Date.now()).run();
  if (changed.meta.changes) await dispatchRenderAdmissions(env);
}

export async function waitForRenderAdmission(env: PipelineEnv, step: WorkflowStep, name: string, ticket: AdmissionTicket, index: number) {
  const heartbeatMs = 60_000;
  const checks = Math.ceil(nativeRenderPolicy.queueWaitMs / heartbeatMs) + 3;
  for (let check = 0; check < checks; check++) {
    const state = await step.do<{token: string | null; seconds: number}>(name + '-check-' + check,
      {retries: {limit: 0, delay: '1 second'}}, async () => {
        await restoreUnstartedAdmission(env, ticket);
        const token = await timelyAdmission(env, ticket);
        if (token) return {token, seconds: 0};
        const remaining = Math.min(ticket.queueDeadlineAt, ticket.operationDeadlineAt) - Date.now();
        if (remaining <= 0) throw Error('RENDER_QUEUE_EXPIRED');
        return {token: null, seconds: Math.max(1, Math.ceil(Math.min(heartbeatMs, remaining) / 1000))};
      });
    if (state.token) return state.token;
    let payload: Json | null = null;
    const startedWaitingAt = Date.now();
    try {
      const event = await step.waitForEvent<Json>(name + '-event-' + check,
        {type: eventType(index), timeout: `${state.seconds} seconds`});
      payload = event.payload as Json;
    } catch { /* An event timeout or delivery error still requires a persisted-state recheck. */ }
    const recovered = await step.do<string | null>(name + '-resolved-' + check,
      {retries: {limit: 0, delay: '1 second'}}, async () => {
        if (payload?.attemptId && payload.attemptId !== ticket.id) throw Error('RENDER_ADMISSION_CONFLICT');
        if (payload?.expired) throw Error('RENDER_QUEUE_EXPIRED');
        return timelyAdmission(env, ticket); // D1 fences stale tokens from an earlier lease.
      });
    if (recovered) return recovered;
    // An immediate API error or a burst of stale events must not exhaust all
    // recovery checks before the original 15-minute queue window has elapsed.
    const remaining = state.seconds * 1000 - (Date.now() - startedWaitingAt);
    if (remaining > 1000) await step.sleep(name + '-event-backoff-' + check, `${Math.ceil(remaining / 1000)} seconds`);
  }
  throw Error('RENDER_QUEUE_EXPIRED');
}

/** The execution clock starts only after admission; the database is the final fence. */
export async function claimRenderAdmission(env: PipelineEnv, op: Operation, input: Json, attemptId: string, token: string) {
  const row = await env.DB.prepare(`SELECT a.*,r.operation_deadline_at,r.mode FROM pipeline_render_admissions a
    JOIN pipeline_renders r ON r.id=a.render_id WHERE a.id=? AND a.render_id=? AND a.operation_id=? AND a.generation=?`)
    .bind(attemptId, input.renderId, op.id, op.generation).first<Admission>();
  if (!row || row.lease_token !== token || !['admitted','running'].includes(row.status)) throw Error('RENDER_FENCED');
  await operation(env, op.id, op.generation);
  if (row.status === 'running') {
    if (!row.attempt_deadline_at) throw Error('RENDER_ADMISSION_CONFLICT');
    const attempt = await env.DB.prepare(`SELECT p.id FROM pipeline_attempts p JOIN pipeline_renders r ON r.id=p.render_id
      WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=? AND r.status='rendering'`)
      .bind(attemptId, input.renderId, op.id, op.generation).first();
    if (!attempt) throw Error('RENDER_ADMISSION_CONFLICT');
    return row.attempt_deadline_at;
  }
  const duration = input.mode === 'preview' ? nativeRenderPolicy.previewDeadlineMs : nativeRenderPolicy.exportDeadlineMs;
  const deadlineAt = Math.min(Date.now() + duration, row.operation_deadline_at!);
  if (deadlineAt <= Date.now()) throw Error('RENDER_DEADLINE');
  await coordinator(env).extend(attemptId, token, deadlineAt + 30_000);
  // D1 batch is transactional: an interrupted claim must not leave a running ticket
  // without the corresponding physical attempt and render state.
  const changed = await env.DB.batch([
    env.DB.prepare(`UPDATE pipeline_render_admissions SET status='running',attempt_deadline_at=?
      WHERE id=? AND status='admitted' AND lease_token=? AND EXISTS
      (SELECT 1 FROM pipeline_renders r JOIN pipeline_operations o ON o.id=r.operation_id
         WHERE r.id=? AND r.status='queued' AND r.generation=? AND o.status='active' AND o.generation=?)`)
      .bind(deadlineAt, attemptId, token, input.renderId, op.generation, op.generation),
    env.DB.prepare(`INSERT OR IGNORE INTO pipeline_attempts(id,render_id,operation_id,generation,mode,instance,status,started_at)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_render_admissions WHERE id=? AND status='running' AND lease_token=?)`)
      .bind(attemptId, input.renderId, op.id, op.generation, 'native_' + input.mode, nativeRenderPolicy.instance, 'active', Date.now(), attemptId, token),
    env.DB.prepare(`UPDATE pipeline_renders SET status='rendering'
      WHERE id=? AND operation_id=? AND generation=? AND status='queued'
        AND EXISTS(SELECT 1 FROM pipeline_render_admissions WHERE id=? AND status='running' AND lease_token=?)`)
      .bind(input.renderId, op.id, op.generation, attemptId, token),
  ]);
  if (changed.some(item => item.meta.changes !== 1)) throw Error('RENDER_FENCED');
  try {await env.OPERATIONS.getByName(op.id).progress(canonical({operationId:op.id,renderId:input.renderId,status:'rendering'}));} catch {}
  return deadlineAt;
}

export async function requeueRenderAfterAttempt(env: PipelineEnv, op: Operation, renderId: string, attemptId: string) {
  // A replay of the completed requeue is harmless; an old attempt cannot reset a newer admission.
  const updated = await env.DB.prepare(`UPDATE pipeline_renders SET status='queued'
    WHERE id=? AND operation_id=? AND generation=? AND status IN ('rendering','queued')
      AND EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')
      AND EXISTS(SELECT 1 FROM pipeline_attempts p JOIN pipeline_render_admissions a ON a.id=p.id
        WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=?
          AND p.status='failed' AND p.stopped_at IS NOT NULL AND a.status='released'
          AND NOT EXISTS(SELECT 1 FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id
            WHERE r.id=p.id AND s.reservation_id IS NULL)
          AND NOT EXISTS(SELECT 1 FROM pipeline_render_admissions next
            WHERE next.render_id=? AND next.attempt_index>a.attempt_index))`)
    .bind(renderId, op.id, op.generation, op.id, op.generation,
      attemptId, renderId, op.id, op.generation, renderId).run();
  if (updated.meta.changes !== 1) throw Error('RENDER_FENCED');
}

/** Reconcile a ticket that was admitted but never started, including cancelled operations. */
export async function stopRenderAdmissions(env: PipelineEnv, renderId: string) {
  const rows = await env.DB.prepare("SELECT id,lease_token FROM pipeline_render_admissions WHERE render_id=? AND status IN ('admitted','running')")
    .bind(renderId).all<{id: string; lease_token: string}>();
  const stopped = await Promise.allSettled(rows.results.map(async row => {
    await env.SHARDS.getByName(row.id).stopAndSettle();
    await coordinator(env).release(row.id, row.lease_token);
  }));
  if (stopped.some(item => item.status === 'rejected')) throw Error('COMPUTE_STOP_UNCONFIRMED');
}
