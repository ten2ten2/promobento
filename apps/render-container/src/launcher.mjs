import http from 'node:http';
import {spawn} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync} from 'node:fs';
import {canonical, parseCanonicalJson} from '../../../packages/contracts/src/canonical.mjs';

if (process.getuid() !== 10002) throw Error('NATIVE_LAUNCHER_UID_REQUIRED');
process.umask(0o007);
const SOCKET = '/run/promobento/native.sock';
const taskIdOk = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
let active = null;

function processIdentity(pid) {
  try {
    const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return {pid: Number(pid), parent: Number(fields[1]), started: fields[19]};
  } catch { return null; }
}
function descendants(pid) {
  const all = readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(processIdentity).filter(Boolean);
  const ids = new Set([pid]); let changed;
  do { changed = false; for (const row of all) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } } while (changed);
  return all.filter(row => ids.has(row.pid));
}
async function stopActive() {
  if (!active) return;
  const job = active, tree = descendants(job.child.pid);
  job.cancelled = true;
  job.child.kill('SIGTERM'); // Upstream cleans its separately detached Chrome groups on SIGTERM.
  await Promise.race([job.closed, new Promise(resolve => setTimeout(resolve, 2000))]);
  for (const row of tree.reverse()) {
    if (processIdentity(row.pid)?.started !== row.started) continue;
    try { process.kill(row.pid, 'SIGKILL'); } catch {}
  }
}

async function runTask(taskId) {
  if (!taskIdOk(taskId)) throw Error('NATIVE_TASK_ID_INVALID');
  if (active) throw Error('NATIVE_JOB_BUSY');
  const requestPath = `/jobs/${taskId}/request.json`;
  const task = parseCanonicalJson(readFileSync(requestPath));
  if (task.taskId !== taskId || !['preview', 'export'].includes(task.mode) || Object.hasOwn(task, 'brokerToken')) throw Error('NATIVE_LAUNCH_SCOPE_INVALID');
  const temporary = `/chrome/${taskId}`;
  mkdirSync(temporary, {recursive: false, mode: 0o700});
  const child = spawn(process.execPath, ['/app/apps/render-container/src/job.mjs', requestPath], {
    cwd: '/app', stdio: ['ignore', 'ignore', 'pipe'], env: {
      PATH: '/usr/local/bin:/usr/bin:/bin', HOME: temporary, TMPDIR: temporary, LANG: 'C.UTF-8',
      OM_CHROME: '/opt/chrome-headless-shell-linux64/chrome-headless-shell', HUASHU_MOTION_ROOT: '/opt/huashu-motion',
      FONTCONFIG_FILE: '/app/apps/render-container/tests/fontconfig.conf',
    },
  });
  let diagnostic = '';
  child.stderr.on('data', bytes => { diagnostic = (diagnostic + bytes).slice(-12_000); });
  const closed = new Promise(resolve => { child.once('error', error => resolve({code: 1, error})); child.once('close', (code, signal) => resolve({code, signal})); });
  active = {child, closed, cancelled: false}; const job = active;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void stopActive(); }, task.mode === 'preview' ? 180_000 : 900_000);
  try {
    const done = await closed;
    if (timedOut || job.cancelled) throw Error(timedOut ? 'NATIVE_JOB_TIMEOUT' : 'NATIVE_JOB_CANCELLED');
    if (done.code !== 0) {
      const failurePath = `/jobs/${taskId}/failure.json`;
      const detail = existsSync(failurePath) ? parseCanonicalJson(readFileSync(failurePath)) : {code: 'NATIVE_JOB_FAILED'};
      // Detailed stderr stays in the private container log, never in a browser-visible status object.
      process.stderr.write(diagnostic + '\n');
      throw Object.assign(Error(detail.code), {detail});
    }
    return {ok: true};
  } finally { clearTimeout(timer); if (active === job) active = null; }
}

if (existsSync(SOCKET)) unlinkSync(SOCKET);
const server = http.createServer(async (request, response) => {
  const send = (status, value) => response.writeHead(status, {'content-type': 'application/json'}).end(canonical(value));
  try {
    if (request.method !== 'POST') return send(404, {error: 'NOT_FOUND'});
    if (request.url === '/cancel') { await stopActive(); return send(200, {ok: true}); }
    if (request.url !== '/run') return send(404, {error: 'NOT_FOUND'});
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1024) throw Error('NATIVE_LAUNCH_REQUEST_TOO_LARGE'); chunks.push(chunk); }
    const body = parseCanonicalJson(Buffer.concat(chunks));
    return send(200, await runTask(body.taskId));
  } catch (error) { return send(500, {error: error.message, ...(error.detail ? {detail: error.detail} : {})}); }
});
server.listen(SOCKET, () => chmodSync(SOCKET, 0o660));
const stop = async () => { await stopActive(); server.close(); process.stdin.pause(); };
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.stdin.on('data', data => { if (String(data).includes('terminate\n')) void stop(); });
