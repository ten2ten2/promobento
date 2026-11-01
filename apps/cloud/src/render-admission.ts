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

/** A hung Workflow/Coordinator RPC cannot pin all capacity notifications or a queue precheck. */
async function boundedAdmission<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('RENDER_ADMISSION_RPC_TIMEOUT')), 3_000);
    })]);
  } finally {if (timer !== undefined) clearTimeout(timer);}
}

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
  // The queue step itself can lose its checkpoint. Return the original ticket
  // for a safe no-start release; the admission wait owns its lease restoration.
  if (row?.status === 'released' && await canRetryUnstartedAdmission(env, op, renderId,
    {id, queueDeadlineAt: row.queue_deadline_at, operationDeadlineAt: render.operation_deadline_at}, index))
    return {id, requestedAt: row.requested_at, queueDeadlineAt: row.queue_deadline_at,
      operationDeadlineAt: render.operation_deadline_at};
  if (!row || !['queued', 'admitted', 'running'].includes(row.status)) throw Error('RENDER_FENCED');
  await dispatchRenderAdmissions(env);
  return {id, requestedAt: row.requested_at, queueDeadlineAt: row.queue_deadline_at, operationDeadlineAt: render.operation_deadline_at};
}

async function notify(env: PipelineEnv, row: Admission) {
  const markDone = () => env.DB.prepare(`UPDATE pipeline_render_admissions SET notification_sent_at=?
    WHERE id=? AND status=? AND COALESCE(lease_token,'')=? AND notification_sent_at IS NULL`)
    .bind(Date.now(), row.id, row.status, row.lease_token ?? '').run();
  try {
    await boundedAdmission((async () => (await env.RENDER_WORKFLOW.get(row.render_id)).sendEvent({type: eventType(row.attempt_index), payload: {
      attemptId: row.id, ...(row.status === 'expired' ? {expired: true} : {leaseToken: row.lease_token}),
    }}))());
  } catch (error) {
    let terminal = false;
    try {
      const status = await boundedAdmission((async () => (await env.RENDER_WORKFLOW.get(row.render_id)).status())());
      terminal = ['complete', 'errored', 'terminated'].includes(status.status);
    } catch { /* An unknown Workflow state is not proof that delivery is impossible. */ }
    if (terminal) {
      try {
        // A finished Workflow cannot consume the event. An admitted orphan must also return its slot.
        if (row.status === 'admitted') await stopRenderAdmissions(env, row.render_id);
        await boundedAdmission(markDone());
        return;
      } catch { /* A failed physical stop must remain retryable. */ }
    }
    const delay = Math.min(5 * 60_000, 5000 * 2 ** Math.min(row.notification_failures, 6));
    await boundedAdmission(env.DB.prepare(`UPDATE pipeline_render_admissions
      SET notification_failures=notification_failures+1,notification_retry_at=MAX(notification_retry_at,?)
      WHERE id=? AND status=? AND COALESCE(lease_token,'')=? AND notification_sent_at IS NULL`)
      .bind(Date.now() + delay, row.id, row.status, row.lease_token ?? '').run());
    throw error;
  }
  await boundedAdmission(markDone());
}

async function deliverAdmissionNotifications(env: PipelineEnv, rows: Admission[]) {
  let next = 0;
  await Promise.allSettled(Array.from({length: Math.min(8, rows.length)}, async () => {
    while (next < rows.length) {
      const row = rows[next++]!;
      try {await notify(env, row);} catch { /* Notification is retried from D1, not by acquiring a new lease. */ }
    }
  }));
}

/** Called by new tickets, freed capacity and a slow recovery sweep. No busy-waiting consumers. */
export async function dispatchRenderAdmissions(env: PipelineEnv) {
  const notifications: Admission[] = [];
  const expired = await env.DB.prepare(`SELECT a.* FROM pipeline_render_admissions a
    JOIN pipeline_renders r ON r.id=a.render_id JOIN pipeline_operations o ON o.id=a.operation_id
    WHERE a.status='queued' AND r.status='queued' AND o.status='active' AND o.generation=a.generation
      AND (a.queue_deadline_at<=? OR r.operation_deadline_at<=?)
    ORDER BY a.requested_at LIMIT 128`).bind(Date.now(), Date.now()).all<Admission>();
  for (const row of expired.results) {
    await env.DB.prepare("UPDATE pipeline_render_admissions SET status='expired' WHERE id=? AND status='queued'").bind(row.id).run();
    // Expired notices are durable and low priority; the bounded recovery sweep
    // handles them without delaying freshly granted compute capacity.
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
      await env.DB.prepare("UPDATE pipeline_render_admissions SET status='expired' WHERE id=? AND status='queued'")
        .bind(row.id).run();
      // Keep expired notifications durable for the separate, paced sweep.
      continue;
    }
    const attemptMs = row.mode === 'preview' ? nativeRenderPolicy.previewDeadlineMs : nativeRenderPolicy.exportDeadlineMs;
    let lease: Awaited<ReturnType<ReturnType<typeof coordinator>['acquire']>>;
    try {
      lease = await boundedAdmission((async () => coordinator(env).acquire(row.id, row.workspace_id, row.generation,
        Math.min(row.operation_deadline_at!, Date.now() + attemptMs + 2 * 60_000)))());
    } catch {continue; /* An ambiguous acquire keeps its DO slot until recovery, not a paid attempt. */}
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
        try {await boundedAdmission(coordinator(env).release(row.id, lease.token));} catch {}
      continue;
    }
    notifications.push({...row, status: 'admitted', lease_token: lease.token});
  }
  await deliverAdmissionNotifications(env, notifications);
  // Event delivery can fail after admission; its D1 record remains retryable.
  const unsent = await env.DB.prepare(`SELECT * FROM pipeline_render_admissions
    WHERE status IN ('admitted','expired') AND notification_sent_at IS NULL AND notification_retry_at<=?
    ORDER BY CASE status WHEN 'admitted' THEN 0 ELSE 1 END,notification_retry_at,requested_at LIMIT 8`)
    .bind(Date.now()).all<Admission>();
  await deliverAdmissionNotifications(env, unsent.results);
}

type AdmissionTicket = {id: string; queueDeadlineAt: number; operationDeadlineAt: number};

/** Claim failed before a physical attempt: is another admission round still safe? */
export async function canRetryUnstartedAdmission(env: PipelineEnv, op: Operation, renderId: string,
  ticket: AdmissionTicket, index: number) {
  if (Date.now() >= Math.min(ticket.queueDeadlineAt, ticket.operationDeadlineAt)) return false;
  const row = await env.DB.prepare(`SELECT a.id FROM pipeline_render_admissions a
    JOIN pipeline_renders r ON r.id=a.render_id JOIN pipeline_operations o ON o.id=a.operation_id
    WHERE a.id=? AND a.render_id=? AND a.operation_id=? AND a.generation=? AND a.attempt_index=?
      AND a.status IN ('queued','admitted','released') AND a.queue_deadline_at>?
      AND r.status='queued' AND r.generation=a.generation AND r.operation_deadline_at>?
      AND o.status='active' AND o.generation=a.generation
      AND NOT EXISTS(SELECT 1 FROM pipeline_attempts p WHERE p.id=a.id)`)
    .bind(ticket.id, renderId, op.id, op.generation, index, Date.now(), Date.now()).first();
  return Boolean(row);
}

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
  try { await boundedAdmission(coordinator(env).assertLease(ticket.id, row.workspace_id, row.generation, row.lease_token)); }
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
  try {await boundedAdmission(coordinator(env).release(ticket.id, row.lease_token));}
  catch {return; /* The old lease may still own capacity; recheck on the next event. */}
  // The alarm stopped this ShardDO even if no execution ever started. Reusing
  // its ticket requires clearing that permanent stop fence under D1 guards.
  try {await boundedAdmission(env.SHARDS.getByName(ticket.id).resetUnstartedAdmission(ticket.id, row.lease_token));}
  catch {return;}
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

async function waitForGrantEvent(env: PipelineEnv, step: WorkflowStep, name: string, ticket: AdmissionTicket, index: number) {
  const heartbeatMs = 60_000;
  const checks = Math.ceil(nativeRenderPolicy.queueWaitMs / heartbeatMs) + 3;
  for (let check = 0; check < checks; check++) {
    const state = await step.do<{token: string | null; seconds: number; wakeAt: number}>(name + '-check-' + check,
      {retries: {limit: 0, delay: '1 second'}}, async () => {
        await restoreUnstartedAdmission(env, ticket);
        const token = await timelyAdmission(env, ticket);
        if (token) return {token, seconds: 0, wakeAt: 0};
        const remaining = Math.min(ticket.queueDeadlineAt, ticket.operationDeadlineAt) - Date.now();
        if (remaining <= 0) throw Error('RENDER_QUEUE_EXPIRED');
        const duration = Math.min(heartbeatMs, remaining);
        return {token: null, seconds: Math.max(1, Math.ceil(duration / 1000)), wakeAt: Date.now() + duration};
      });
    if (state.token) return state.token;
    // A buffered stale event must not trigger a blind 60s sleep: another grant
    // may arrive while the original queue/operation deadline is approaching.
    // Re-arm the durable event waiter for the *remaining* checkpointed window.
    let eventIndex = 0;
    // On Workflow replay, wall time may already be past wakeAt while a
    // previously completed waitForEvent/resolved step still needs replaying.
    // Probe those named steps before advancing to a new deadline check.
    while (Date.now() < state.wakeAt || eventIndex < 64) {
      let payload: Json | null = null, unavailable = false;
      try {
        const event = await step.waitForEvent<Json>(name + '-event-' + check + '-' + eventIndex,
          {type: eventType(index), timeout: `${Math.max(1, Math.ceil((state.wakeAt - Date.now()) / 1000))} seconds`});
        payload = event.payload as Json;
      } catch {unavailable = true; /* Timeout or delivery error: recheck D1. */}
      const recovered = await step.do<string | null>(name + '-resolved-' + check + '-' + eventIndex,
        {retries: {limit: 0, delay: '1 second'}}, async () => {
          if (payload?.attemptId && payload.attemptId !== ticket.id) throw Error('RENDER_ADMISSION_CONFLICT');
          if (payload?.expired) throw Error('RENDER_QUEUE_EXPIRED');
          await restoreUnstartedAdmission(env, ticket);
          return timelyAdmission(env, ticket); // Fences any earlier lease's stale token.
        });
      if (recovered) return recovered;
      // Once the original window has closed, a missing event ends the replay
      // probe; buffered stale events may precede the cached valid grant.
      if (unavailable && Date.now() >= state.wakeAt) break;
      // Pace failed APIs and sustained stale-event floods without suppressing
      // the next real event for the rest of the original heartbeat window.
      if (Date.now() < state.wakeAt && (unavailable || eventIndex % 8 === 7)) {
        await step.sleepUntil(name + '-event-backoff-' + check + '-' + eventIndex,
          Math.min(state.wakeAt, Date.now() + 1_000));
      }
      eventIndex++;
    }
  }
  throw Error('RENDER_QUEUE_EXPIRED');
}

/** Revalidate cached grants on every Workflow replay, before a physical claim. */
export async function waitForRenderAdmission(env: PipelineEnv, step: WorkflowStep, name: string, ticket: AdmissionTicket, index: number) {
  const rounds = Math.ceil(nativeRenderPolicy.queueWaitMs / 60_000) + 3;
  for (let round = 0; round < rounds; round++) {
    // A completed claim is a stronger checkpoint than a transient event. It
    // never authorizes new execution by itself: claim/Shard still fence it.
    const claimed = await env.DB.prepare(`SELECT a.lease_token FROM pipeline_attempts p
      JOIN pipeline_render_admissions a ON a.id=p.id
      JOIN pipeline_renders r ON r.id=p.render_id
      JOIN pipeline_operations o ON o.id=p.operation_id
      WHERE p.id=? AND a.attempt_index=? AND a.queue_deadline_at=? AND r.operation_deadline_at=?
        AND a.render_id=p.render_id AND a.operation_id=p.operation_id AND a.generation=p.generation
        AND a.status IN ('running','released') AND a.lease_token IS NOT NULL
        AND p.mode='native_' || r.mode AND r.generation=p.generation
        AND r.status IN ('rendering','verifying')
        AND o.generation=p.generation AND o.status='active' AND a.workspace_id=o.workspace_id`)
      .bind(ticket.id, index, ticket.queueDeadlineAt, ticket.operationDeadlineAt)
      .first<{lease_token: string}>();
    if (claimed) return claimed.lease_token;
    const token = await waitForGrantEvent(env, step, round ? `${name}-regrant-${round}` : name, ticket, index);
    // A physical attempt may have finished while the Workflow was replaying.
    // Never requeue it; the execution step itself must return its cached result
    // or resume the same attempt, never create another physical attempt.
    const physical = await env.DB.prepare(`SELECT a.lease_token FROM pipeline_attempts p
      JOIN pipeline_render_admissions a ON a.id=p.id WHERE p.id=?`)
      .bind(ticket.id).first<{lease_token: string | null}>();
    if (physical) return physical.lease_token ?? token;
    if (await timelyAdmission(env, ticket) === token) return token;
    // The checkpointed token outlived its Coordinator lease before claim.
    // A new round uses new step names so its restored ticket is not masked by
    // the earlier step's cached grant token.
  }
  throw Error('RENDER_QUEUE_EXPIRED');
}

/** The execution clock starts only after admission; the database is the final fence. */
async function runningClaimDeadline(env: PipelineEnv, op: Operation, input: Json, row: Admission, token: string) {
  if (row.status !== 'running' || row.lease_token !== token || !row.attempt_deadline_at
    || row.render_id !== input.renderId || row.operation_id !== op.id || row.generation !== op.generation
    || row.workspace_id !== op.workspace_id) throw Error('RENDER_FENCED');
  const attempt = await env.DB.prepare(`SELECT p.id FROM pipeline_attempts p JOIN pipeline_renders r ON r.id=p.render_id
    WHERE p.id=? AND p.render_id=? AND p.operation_id=? AND p.generation=? AND p.mode=?
      AND p.status='active' AND p.stopped_at IS NULL AND r.status='rendering' AND r.generation=p.generation`)
    .bind(row.id, input.renderId, op.id, op.generation, 'native_' + input.mode).first();
  if (!attempt) throw Error('RENDER_ADMISSION_CONFLICT');
  await coordinator(env).assertLease(row.id, op.workspace_id, op.generation, token);
  return row.attempt_deadline_at;
}

export async function claimRenderAdmission(env: PipelineEnv, op: Operation, input: Json, attemptId: string, token: string) {
  const row = await env.DB.prepare(`SELECT a.*,r.operation_deadline_at,r.mode FROM pipeline_render_admissions a
    JOIN pipeline_renders r ON r.id=a.render_id WHERE a.id=? AND a.render_id=? AND a.operation_id=? AND a.generation=?`)
    .bind(attemptId, input.renderId, op.id, op.generation).first<Admission>();
  if (!row || row.lease_token !== token || !['admitted','running'].includes(row.status)) throw Error('RENDER_FENCED');
  await operation(env, op.id, op.generation);
  if (row.status === 'running') return runningClaimDeadline(env, op, input, row, token);
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
  if (changed.some(item => item.meta.changes !== 1)) {
    // A timed-out first claim may commit after the retry reads 'admitted'.
    // Re-read the same fenced identity before treating a zero-row batch as loss.
    const current = await env.DB.prepare(`SELECT a.*,r.operation_deadline_at,r.mode FROM pipeline_render_admissions a
      JOIN pipeline_renders r ON r.id=a.render_id WHERE a.id=? AND a.render_id=? AND a.operation_id=? AND a.generation=?`)
      .bind(attemptId, input.renderId, op.id, op.generation).first<Admission>();
    if (!current) throw Error('RENDER_FENCED');
    return runningClaimDeadline(env, op, input, current, token);
  }
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
  const rows = await boundedAdmission(env.DB.prepare("SELECT id,lease_token FROM pipeline_render_admissions WHERE render_id=? AND status IN ('admitted','running')")
    .bind(renderId).all<{id: string; lease_token: string}>());
  const stopped = await Promise.allSettled(rows.results.map(async row => {
    // Both barriers are remote. A stuck stop must keep its lease counted, not
    // prevent unrelated tickets from completing their notification round.
    await boundedAdmission(env.SHARDS.getByName(row.id).stopAndSettle());
    await boundedAdmission(coordinator(env).release(row.id, row.lease_token));
  }));
  if (stopped.some(item => item.status === 'rejected')) throw Error('COMPUTE_STOP_UNCONFIRMED');
}
