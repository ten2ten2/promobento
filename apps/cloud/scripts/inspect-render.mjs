// Read-only D1 and Workflow diagnosis. Never starts an operation, deploys, changes a secret or reconciles cost.
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
const {CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, INSPECT_RUN: run, DEPLOYED_SHA: sha, INSPECT_OPERATION: operationId} = process.env;
if (process.env.GITHUB_ACTIONS !== 'true' || !/^\d{8,20}$/.test(run ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '')
  || !/^[A-Za-z0-9_-]{4,96}$/.test(operationId ?? '') || !token || !/^[a-f0-9]{32}$/.test(account ?? ''))
  throw Error('INSPECTION_SCOPE_INVALID');
const config = parseCanonicalJson(readFileSync('apps/cloud/wrangler.jsonc', 'utf8').replace(/^\/\/.*\n/, ''));
const base = 'https://api.cloudflare.com/client/v4/accounts/' + account;
const query = async sql => {
  const response = await fetch(base + '/d1/database/' + config.env.staging.d1_databases[0].database_id + '/query', {
    method: 'POST', headers: {authorization: 'Bearer ' + token, 'content-type': 'application/json'},
    body: canonical({sql, params: [operationId]}), signal: AbortSignal.timeout(20000),
  });
  const value = parseCanonicalJson(await response.text());
  if (!response.ok || !value.success) throw Error('D1_INSPECTION_HTTP_' + response.status);
  return value.result[0].results;
};
const report = {
  scope: 'read_only_staging_operation_diagnosis', deploymentSha: sha, requestedRunId: run, operationId,
  operations: await query('SELECT id,status,generation,created_at,finished_at FROM pipeline_operations WHERE id=?'),
  renders: await query('SELECT id,status,created_at,finished_at,result_json FROM pipeline_renders WHERE operation_id=?'),
  attempts: await query('SELECT id,mode,instance,status,started_at,stopped_at,result_json FROM pipeline_attempts WHERE operation_id=?'),
  costs: await query('SELECT r.id,r.kind,r.reserved_micros,s.actual_micros,s.usage_json FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.operation_id=?'),
  workflows: await query('SELECT * FROM pipeline_workflows WHERE operation_id=?'),
  workflowStatuses: [],
};
if (report.operations.length !== 1) throw Error('INSPECTION_OPERATION_NOT_FOUND');
for (const workflow of report.workflows.slice(0, 100)) {
  try {
    const response = await fetch(base + '/workflows/promobento-staging-' + workflow.kind + '/instances/' + encodeURIComponent(workflow.id), {
      headers: {authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(20000),
    });
    const value = parseCanonicalJson(await response.text());
    report.workflowStatuses.push({kind: workflow.kind, id: workflow.id, httpStatus: response.status,
      status: response.ok && value.success ? value.result : 'unavailable'});
  } catch {
    report.workflowStatuses.push({kind: workflow.kind, id: workflow.id, status: 'unavailable'});
  }
}
mkdirSync('artifacts/staging', {recursive: true});
writeFileSync('artifacts/staging/inspection.json', canonical(report));
console.log(canonical({scope: report.scope, operationId, operations: report.operations,
  renders: report.renders.map(({id, status}) => ({id, status})), attemptCount: report.attempts.length,
  settledMicros: report.costs.reduce((sum, cost) => sum + (cost.actual_micros ?? 0), 0),
  pendingCosts: report.costs.filter(cost => cost.actual_micros === null).map(({id, reserved_micros}) => ({id, reserved_micros}))}));
