import type {PipelineEnv, Json} from './pipeline-types.ts';
import {boundedControl,settledPool} from './control-batch.ts';

export async function flushOutbox(env: PipelineEnv, id?: string) {
  const statement = id
    ? env.DB.prepare('SELECT * FROM pipeline_outbox WHERE id=? AND delivered_at IS NULL').bind(id)
    : env.DB.prepare('SELECT * FROM pipeline_outbox WHERE delivered_at IS NULL ORDER BY rowid LIMIT 100');
  const rows = await statement.all<Json>();
  const results = await settledPool(rows.results, 8, async row => {
    await boundedControl(env.OUTBOX.send({id: row.id, kind: row.kind, operationId: row.operation_id, payloadJson: row.payload_json}));
    await env.DB.prepare('UPDATE pipeline_outbox SET delivered_at=? WHERE id=? AND delivered_at IS NULL').bind(Date.now(), row.id).run();
  });
  if (results.some(result => result.status === 'rejected')) throw Error('OUTBOX_DELIVERY_UNCONFIRMED');
}

/** A Queue can exhaust its delivery retries before the first Workflow is registered.
 * Re-enqueue only an unstarted, still-current native job. Never restart a job
 * whose Workflow identity already exists or replay a terminal operation.
 */
export async function recoverUnregisteredDispatches(env: PipelineEnv) {
  const now = Date.now();
  // Drive the sweep from live operations and queued renders, not from all
  // historically delivered outbox rows. CROSS JOIN keeps this access order
  // so an ever-growing history cannot make each minute's sweep unbounded.
  const rows = await env.DB.prepare(`SELECT * FROM (
    SELECT b.id,b.kind,b.operation_id,b.payload_json,b.delivered_at
      FROM pipeline_operations o CROSS JOIN pipeline_outbox b
      WHERE o.status IN ('active','awaiting_user') AND b.id='creative-'||o.id AND b.kind='creative'
        AND b.operation_id=o.id
        AND EXISTS(SELECT 1 FROM pipeline_contexts c WHERE c.operation_id=o.id AND c.engine='huashu')
        AND CASE WHEN json_valid(b.payload_json) THEN
          json_extract(b.payload_json,'$.engine')='huashu' AND json_extract(b.payload_json,'$.operationId')=o.id
          ELSE 0 END
        AND b.delivered_at IS NOT NULL AND b.delivered_at<=?
        AND NOT EXISTS(SELECT 1 FROM pipeline_workflows w WHERE w.kind='operation' AND w.id=o.id)
    UNION ALL
    SELECT b.id,b.kind,b.operation_id,b.payload_json,b.delivered_at
      FROM pipeline_renders r CROSS JOIN pipeline_operations o CROSS JOIN pipeline_outbox b
      WHERE r.status='queued' AND o.id=r.operation_id AND o.status='active' AND o.generation=r.generation
        AND b.id='render-'||r.id AND b.operation_id=o.id AND b.kind='render'
        AND CASE WHEN json_valid(b.payload_json) THEN
          json_extract(b.payload_json,'$.engine')='huashu' AND json_extract(b.payload_json,'$.renderId')=r.id
          ELSE 0 END
        AND b.delivered_at IS NOT NULL AND b.delivered_at<=?
        AND NOT EXISTS(SELECT 1 FROM pipeline_workflows w WHERE w.kind='render' AND w.id=r.id)
    ) ORDER BY delivered_at,id LIMIT 32`).bind(now - 5 * 60_000,now - 5 * 60_000).all<Json>();
  const results = await settledPool(rows.results, 5, async row => {
    await boundedControl(env.OUTBOX.send({id:row.id,kind:row.kind,operationId:row.operation_id,payloadJson:row.payload_json}));
    // A concurrent sweep can also enqueue this identity; both are safe because
    // Workflow registration and execution claims are already idempotent.
    await env.DB.prepare('UPDATE pipeline_outbox SET delivered_at=? WHERE id=? AND delivered_at=?')
      .bind(Date.now(),row.id,row.delivered_at).run();
  });
  if (results.some(result => result.status==='rejected')) throw Error('OUTBOX_REDELIVERY_UNCONFIRMED');
}
