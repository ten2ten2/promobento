// Drives the deployed G1 pre-probe Worker and writes results/report.json.
// Usage: node run-probes.mjs <worker url> <probe key> [out dir]
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const [base, key, outDir = 'results'] = process.argv.slice(2);
if (!base || !key) throw Error('usage: node run-probes.mjs <worker url> <probe key> [out dir]');
mkdirSync(outDir, {recursive: true});
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {startedAt: new Date().toISOString(), worker: base};
const save = () => writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

async function call(path, body = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(base + path, {method: 'POST', headers: {'x-probe-key': key, 'content-type': 'application/json'}, body: JSON.stringify(body)});
      const text = await response.text();
      try { return JSON.parse(text); } catch { return {httpStatus: response.status, text: text.slice(0, 800)}; }
    } catch (error) {
      if (attempt >= 3) return {fetchError: String(error.message)};
      await sleep(2000);
    }
  }
}
async function task(doName, kind, params = {}, timeoutMs = 20 * 60000) {
  log(`task ${doName} ${kind}`);
  const started = await call(`/do/${doName}/task`, {kind, params});
  if (!started.taskId) return {startError: started};
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await sleep(4000);
    const result = await call(`/do/${doName}/result`, {taskId: started.taskId});
    if (result.status === 'done' || result.status === 'failed') return {...result, wallMs: Date.now() - t0};
  }
  return {status: 'timeout', wallMs: Date.now() - t0};
}
async function start(doName, options = {}) {
  log(`start ${doName}`, JSON.stringify(options));
  const t0 = Date.now();
  return {...(await call(`/do/${doName}/start`, options)), callMs: Date.now() - t0};
}
async function waitStopped(doName, limitMs = 90000, everyMs = 500) {
  const t0 = Date.now();
  let state;
  while (Date.now() - t0 < limitMs) {
    state = await call(`/do/${doName}/state`);
    if (state.running === false) return {stoppedAfterMs: Date.now() - t0, state};
    await sleep(everyMs);
  }
  return {stillRunningAfterMs: Date.now() - t0, state};
}
const used = new Set();
const only = process.env.PROBE_ONLY ? process.env.PROBE_ONLY.split(',') : null;
const run = async (name, fn) => {
  if (only && !only.includes(name)) return;
  log(`== ${name}`);
  try { report[name] = await fn(); } catch (error) { report[name] = {probeError: String(error.stack ?? error)}; }
  save();
};

await run('ajvStandalone', () => call('/ajv'));

await run('main', async () => {
  used.add('main');
  const out = {start: await start('main', {instance: 'standard-3'})};
  for (const kind of ['info', 'network', 'isolation', 'sandbox', 'seam']) out[kind] = await task('main', kind);
  out.capture = await task('main', 'capture', {frames: 90});
  out.destroy = await call('/do/main/destroy');
  out.afterDestroy = await waitStopped('main');
  return out;
});

await run('webglStandard3', async () => {
  used.add('webgl-s3');
  const out = {start: await start('webgl-s3', {instance: 'standard-3'})};
  out.dpr1 = await task('webgl-s3', 'webgl', {dpr: 1, frames: 6, userDataDir: '/chrome/webgl-cache'});
  out.dpr075 = await task('webgl-s3', 'webgl', {dpr: 0.75, frames: 6, userDataDir: '/chrome/webgl-075'});
  out.snapshot = await call('/do/webgl-s3/snapshot', {name: 'g1-pre-webgl'});
  out.destroy = await call('/do/webgl-s3/destroy');
  return out;
});

await run('webglStandard4', async () => {
  used.add('webgl-s4');
  const out = {start: await start('webgl-s4', {instance: 'standard-4'})};
  out.dpr1 = await task('webgl-s4', 'webgl', {dpr: 1, frames: 6, userDataDir: '/chrome/webgl-cache'});
  out.destroy = await call('/do/webgl-s4/destroy');
  return out;
});

await run('captureStandard4', async () => {
  used.add('capture-s4');
  const out = {start: await start('capture-s4', {instance: 'standard-4'})};
  out.capture = await task('capture-s4', 'capture', {frames: 90});
  out.destroy = await call('/do/capture-s4/destroy');
  return out;
});

await run('snapshotRestore', async () => {
  const id = report.webglStandard3?.snapshot?.id;
  if (!id) return {skipped: 'no snapshot id', snapshot: report.webglStandard3?.snapshot};
  used.add('snap-restore');
  const out = {start: await start('snap-restore', {instance: 'standard-3', snapshotId: id})};
  if (out.start.ready) out.webgl = await task('snap-restore', 'webglFromSnapshot', {dpr: 1, userDataDir: '/chrome/webgl-cache'});
  out.destroy = await call('/do/snap-restore/destroy');
  return out;
});

await run('sigterm', async () => {
  used.add('sigterm');
  const out = {start: await start('sigterm', {instance: 'standard-1'})};
  out.sleepTask = await call('/do/sigterm/task', {kind: 'sleep', params: {ms: 120000}});
  await sleep(3000);
  out.signal = await call('/do/sigterm/signal', {signal: 15});
  out.afterSignal = await waitStopped('sigterm', 60000, 250);
  return out;
});

await run('inactivity', async () => {
  used.add('idle-set'); used.add('idle-default');
  const out = {
    setStart: await start('idle-set', {instance: 'standard-1', monitor: false}),
    setTimeout: await call('/do/idle-set/inactivity', {ms: 30000}),
    defaultStart: await start('idle-default', {instance: 'standard-1', monitor: false})
  };
  log('idle for 150 s without touching either Durable Object');
  await sleep(150000);
  out.setStateAfter150s = await call('/do/idle-set/state');
  out.defaultStateAfter150s = await call('/do/idle-default/state');
  return out;
});

await run('churn', async () => {
  const names = prefix => Array.from({length: 6}, (_, i) => `${prefix}-${i}`);
  names('churn-a').concat(names('churn-b')).forEach(name => used.add(name));
  const t0 = Date.now();
  const first = await Promise.all(names('churn-a').map(name => start(name, {instance: 'standard-1'})));
  const firstMs = Date.now() - t0;
  const destroyed = await Promise.all(names('churn-a').map(name => call(`/do/${name}/destroy`)));
  const t1 = Date.now();
  const second = await Promise.all(names('churn-b').map(name => start(name, {instance: 'standard-1'})));
  const secondMs = Date.now() - t1;
  const stoppedA = await Promise.all(names('churn-a').map(name => call(`/do/${name}/state`)));
  return {first, firstMs, destroyed, second, secondMs, stoppedA};
});

await run('workflowChain', async () => {
  used.add('wf-1');
  const t0 = Date.now();
  const created = await call('/wf/start', {doName: 'wf-1', kind: 'info'});
  let status;
  while (Date.now() - t0 < 10 * 60000) {
    await sleep(3000);
    const response = await fetch(`${base}/wf/status?id=${encodeURIComponent(created.id)}`, {headers: {'x-probe-key': key}});
    status = await response.json();
    if (['complete', 'errored', 'terminated'].includes(status.status)) break;
  }
  return {created, status, elapsedMs: Date.now() - t0};
});

// Cold start of a fresh instance (as every shard is), with enough samples for p50/p95:
// 10 sequential, two parallel waves of 6 (one render's shards), then 3 more after 10 idle minutes.
const pct = (values, p) => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.ceil(p * v.length) - 1)] : null; };
async function coldOne(name, instance) {
  used.add(name);
  const t0 = Date.now();
  const started = await start(name, {instance});
  const first = started.ready ? await call(`/do/${name}/firstFrameSync`) : null;
  const sample = {name, instance, readyMs: started.readyMs, ready: started.ready, firstFrame: first?.result ?? first, endToEndMs: Date.now() - t0};
  await call(`/do/${name}/destroy`);
  return sample;
}
const summarize = samples => {
  const pick = key => samples.map(s => key(s));
  return Object.fromEntries(Object.entries({readyMs: s => s.readyMs, launchMs: s => s.firstFrame?.launchMs, loadMs: s => s.firstFrame?.loadMs,
    firstFrameTotalMs: s => s.firstFrame?.totalMs, endToEndMs: s => s.endToEndMs}).map(([k, f]) => [k, {p50: pct(pick(f), 0.5), p95: pct(pick(f), 0.95), max: pct(pick(f), 1), n: pick(f).filter(Number.isFinite).length}]));
};
await run('coldStart', async () => {
  const out = {sequential: [], waves: [], afterIdle: []};
  for (let i = 0; i < 10; i++) { out.sequential.push(await coldOne(`cold-seq-${i}`, 'standard-3')); save(); }
  for (let w = 0; w < 2; w++) {
    const t0 = Date.now();
    const samples = await Promise.all(Array.from({length: 6}, (_, i) => coldOne(`cold-wave${w}-${i}`, 'standard-3')));
    out.waves.push({wallMs: Date.now() - t0, samples});
    save();
  }
  log('idle 10 minutes before the last cold starts');
  await sleep(600000);
  for (let i = 0; i < 3; i++) out.afterIdle.push(await coldOne(`cold-idle-${i}`, 'standard-3'));
  out.summary = {
    sequential: summarize(out.sequential),
    waves: summarize(out.waves.flatMap(w => w.samples)),
    afterIdle: summarize(out.afterIdle),
    all: summarize([...out.sequential, ...out.waves.flatMap(w => w.samples), ...out.afterIdle])
  };
  return out;
});

await run('cleanup', async () => {
  const results = {};
  for (const name of used) results[name] = await call(`/do/${name}/destroy`);
  return results;
});

report.finishedAt = new Date().toISOString();
save();
log('done');
