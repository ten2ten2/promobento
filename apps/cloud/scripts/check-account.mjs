#!/usr/bin/env node
// Read-mostly account checks before S1: Workers AI can run a model, and whether the preview domain
// is a zone on this account. One tiny embedding call (well inside the free daily allocation).
// Runs from CI with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID; never prints the account ID.
import { appendFileSync } from 'node:fs';

const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
const previewDomain = 'promobentousercontent.com';

async function call(method, path, body) {
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  const ok = response.ok && json.success !== false;
  return { ok, status: response.status, result: json.result, errors: (json.errors ?? []).map(e => `${e.code} ${e.message}`).join('; ') };
}

const rows = [];
const run = await call('POST', `/accounts/${account}/ai/run/@cf/baai/bge-small-en-v1.5`, { text: ['promobento'] });
const dims = run.result?.data?.[0]?.length;
rows.push(['Workers AI run', run.ok && dims > 0 ? 'pass' : 'fail', run.ok ? `embedding of ${dims} dims` : `HTTP ${run.status} ${run.errors}`]);
const zones = await call('GET', `/zones?name=${previewDomain}&account.id=${account}`);
const zone = zones.result?.[0];
rows.push(['Preview zone', zone ? 'pass' : 'fail',
  zone ? `${previewDomain} status ${zone.status}, plan ${zone.plan?.name ?? 'unknown'}` : zones.ok ? `${previewDomain} is not a zone visible to this token` : `HTTP ${zones.status} ${zones.errors}`]);

const table = ['| Check | Result | Detail |', '| --- | --- | --- |', ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n');
if (rows.some(r => r[1] !== 'pass')) process.exitCode = 1;
