import type {PipelineEnv, Json} from './pipeline-types.ts';

export async function flushOutbox(env: PipelineEnv, id?: string) {
  const statement = id
    ? env.DB.prepare('SELECT * FROM pipeline_outbox WHERE id=? AND delivered_at IS NULL').bind(id)
    : env.DB.prepare('SELECT * FROM pipeline_outbox WHERE delivered_at IS NULL ORDER BY rowid LIMIT 100');
  const rows = await statement.all<Json>();
  for (const row of rows.results) {
    await env.OUTBOX.send({id: row.id, kind: row.kind, operationId: row.operation_id, payloadJson: row.payload_json});
    await env.DB.prepare('UPDATE pipeline_outbox SET delivered_at=? WHERE id=? AND delivered_at IS NULL').bind(Date.now(), row.id).run();
  }
}
