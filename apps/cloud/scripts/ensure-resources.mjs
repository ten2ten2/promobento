#!/usr/bin/env node
// Creates the D1 databases, R2 buckets and Queues listed in resources.json if they are missing.
// Idempotent; runs from CI with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID. Never prints the account ID.
import { readFileSync, appendFileSync } from 'node:fs';
import {parseCanonicalJson} from '../../../packages/contracts/src/canonical.mjs';

const token = process.env.CLOUDFLARE_API_TOKEN, account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required');
const { environments,shared } = parseCanonicalJson(readFileSync(new URL('../resources.json', import.meta.url)));
const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;

async function api(method, path, body) {
  const response = await fetch(base + path, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body && JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) {
    const errors = (json.errors ?? []).map(e => `${e.code} ${e.message}`).join('; ');
    throw Error(`${method} ${path.split('?')[0]} failed: HTTP ${response.status} ${errors}`);
  }
  return json.result;
}

async function listAll(path, key) {
  const items = [];
  for (let page = 1; ; page++) {
    const result = await api('GET', `${path}${path.includes('?') ? '&' : '?'}page=${page}&per_page=100`);
    const batch = key ? result[key] ?? [] : result ?? [];
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

const rows = [];
const d1 = await listAll('/d1/database');
if(shared?.modelLedger){
  let database=d1.find(database=>database.name===shared.modelLedger),created=false;
  if(!database){database=await api('POST','/d1/database',{name:shared.modelLedger});created=true;}
  rows.push(['shared','D1',shared.modelLedger,database.uuid,created]);
}
const buckets = (await api('GET', '/r2/buckets')).buckets ?? [];
const queues = await listAll('/queues');
for (const [env, names] of Object.entries(environments)) {
  let db = d1.find(x => x.name === names.d1), created = false;
  if (!db) { db = await api('POST', '/d1/database', { name: names.d1 }); created = true; }
  rows.push([env, 'D1', names.d1, db.uuid, created]);
  created = false;
  if (!buckets.some(x => x.name === names.r2)) { await api('POST', '/r2/buckets', { name: names.r2 }); created = true; }
  rows.push([env, 'R2', names.r2, '', created]);
  let queue = queues.find(x => x.queue_name === names.queue); created = false;
  if (!queue) { queue = await api('POST', '/queues', { queue_name: names.queue }); created = true; }
  rows.push([env, 'Queue', names.queue, queue.queue_id, created]);
}

const table = ['| Environment | Kind | Name | ID | Action |', '| --- | --- | --- | --- | --- |',
  ...rows.map(([env, kind, name, id, created]) => `| ${env} | ${kind} | ${name} | ${id} | ${created ? 'created' : 'exists'} |`)].join('\n');
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table + '\n');
