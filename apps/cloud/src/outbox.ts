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
