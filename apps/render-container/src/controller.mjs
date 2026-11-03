import http from 'node:http';
import {existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, relative} from 'node:path';
import {canonical, parseCanonicalJson} from '../../../packages/contracts/src/canonical.mjs';
import {assertNativeProject, assertNativePath, nativeProjectHash} from '../../../packages/contracts/src/native-project.mjs';
import {NATIVE_COMMIT, frameTimes, projectPath} from '../../../packages/native-motion/src/index.mjs';
import {fileIdentity} from '../../../packages/native-motion/src/files.mjs';
import {brokerClient} from './broker.mjs';
import {mapIO} from './process.mjs';
import {monitorResources} from './resources.mjs';
import {persistQualityFailure} from './quality-failure.mjs';

if (process.getuid() !== 10001) throw Error('CONTROLLER_UID_REQUIRED');
process.umask(0o007);
let current = null;
const idOk = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const safeCode = value => /^[A-Z][A-Z0-9_]{2,80}$/.test(value || '') ? value : 'NATIVE_TASK_FAILED';

function launcher(path, data = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({socketPath: '/run/promobento/native.sock', path, method: 'POST', headers: {'content-type': 'application/json'}}, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 64 << 10) request.destroy(Error('LAUNCHER_RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
      response.once('end', () => {
        try {
          const result = parseCanonicalJson(Buffer.concat(chunks));
          if (response.statusCode !== 200) return reject(Object.assign(Error(safeCode(result.error)), {detail: result.detail}));
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject); request.end(canonical(data));
  });
}

async function execute(task, brokerToken, state) {
  const base = '/jobs/' + task.taskId, projectDir = join(base, 'project');
  const broker = brokerClient(brokerToken, state.abort.signal);
  const resources = monitorResources();
  try {
    mkdirSync(base, {recursive: false, mode: 0o2770});
    mkdirSync(projectDir, {mode: 0o2770});
    await mapIO(task.project.files, async file => {
      const full = projectPath(projectDir, file.path);
      mkdirSync(dirname(full), {recursive: true, mode: 0o2770});
      await broker.readToFile(file, full);
    }, 2);
    // The broker bearer never reaches disk, native Node, Chromium, an argument or an inherited environment.
    writeFileSync(join(base, 'request.json'), canonical(task), {flag: 'wx', mode: 0o640});
    state.abort.signal.throwIfAborted();
    await launcher('/run', {taskId: task.taskId});
    state.abort.signal.throwIfAborted();
    const result = parseCanonicalJson(readFileSync(join(base, 'result.json')));
    const {report, localOutputs} = result;
    if (report.nativeCommit !== NATIVE_COMMIT || report.projectHash !== await nativeProjectHash(task.project)
      || report.inputSourceSha256 !== task.project.files.find(file => file.path === 'index.html').sha256
      || canonical(report.composition) !== canonical(task.project.composition) || report.pageErrors?.length !== 0
      || report.timelineDurationSeconds !== task.project.composition.durationSeconds || report.timelinePaused !== true
      || report.frames !== (task.mode === 'export' ? task.project.composition.durationSeconds * 30 : 0)
      || !Array.isArray(localOutputs) || localOutputs.length > 530) throw Error('NATIVE_RESULT_INVALID');
    const prefix = `renders/${task.renderId}/attempts/${task.taskId}/out/`;
    const outputs = await mapIO(localOutputs, async output => {
      assertNativePath(output.name);
      const full = realpathSync(output.path), inside = relative(base, full);
      if (!inside || inside.startsWith('../') || inside.startsWith('/') || !statSync(full).isFile() || statSync(full).size > 50_000_000) throw Error('NATIVE_OUTPUT_PATH_INVALID');
      const identity = fileIdentity(full);
      if (identity.byteLength !== output.byteLength || identity.sha256 !== output.sha256) throw Error('NATIVE_OUTPUT_IDENTITY_MISMATCH');
      const blob = await broker.writeFile(prefix + output.name, full, identity, output.mediaType);
      return {name: output.name, ...blob};
    }, 2);
    if (task.mode === 'export') {
      const files = localOutputs.filter(output => output.projectPath).map(output => {
        const blob = outputs.find(item => item.name === output.name);
        return {path: output.projectPath, key: blob.key, sha256: blob.sha256, byteLength: blob.byteLength, mediaType: blob.mediaType};
      });
      const renderedProject = {...task.project, files};
      assertNativeProject(renderedProject);
      outputs.push({name: 'rendered-project.json', ...await broker.write(prefix + 'rendered-project.json', Buffer.from(canonical(renderedProject)), 'application/json')});
      report.renderedProjectHash = await nativeProjectHash(renderedProject);
    }
    report.resourceUsage = resources.stop();
    outputs.push({name: 'report.json', ...await broker.write(prefix + 'report.json', Buffer.from(canonical(report)), 'application/json')});
    state.result = {status: 'succeeded', outputs, report};
  } catch (error) {
    const code=safeCode(error.message);let qaEvidence=null,qaPersistenceError=false;
    const qa=error.detail?.qualityFailure;
    if(code==='NATIVE_DYNAMIC_QA_BLOCKED'&&!state.abort.signal.aborted&&qa?.kind==='encoded_quality_failure'){
      try{
        qaEvidence=await persistQualityFailure({task,base,evidence:qa,broker});
      }catch{qaPersistenceError=true;}
    }
    state.result = {status: state.abort.signal.aborted ? 'cancelled' : 'failed',
      error: {code,...(qaEvidence?{qaEvidence}:{}),...(qaPersistenceError?{qaEvidencePersisted:false}:{})},
      resourceUsage: resources.stop()};
    await launcher('/cancel').catch(() => {});
  } finally {
    resources.stop();
    brokerToken = null;
    // The task container is stopped by its DO after a terminal receipt; no next task can reuse its directory.
    rmSync(base, {recursive: true, force: true});
  }
}

const server = http.createServer(async (request, response) => {
  const send = (status, value) => response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}).end(canonical(value));
  try {
    // Browser-origin requests cannot invoke controller operations, even from a hostile file:// composition.
    if (request.headers.origin || request.headers['sec-fetch-site']) return send(403, {error: 'BROWSER_REQUEST_FORBIDDEN'});
    if (request.method === 'GET' && request.url === '/healthz') {
      const ready = existsSync('/run/promobento/native.sock');
      return send(ready ? 200 : 503, {ok: ready, runtime: 'huashu-motion', nativeCommit: NATIVE_COMMIT});
    }
    if (request.method === 'GET' && request.url === '/result') return send(200, current?.result || {status: current ? 'running' : 'idle'});
    if (request.method !== 'POST' || !/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) return send(404, {error: 'NOT_FOUND'});
    if (request.url === '/cancel') {
      current?.abort.abort(); await launcher('/cancel').catch(() => {});
      return send(200, {status: 'cancelling'});
    }
    if (request.url !== '/task') return send(404, {error: 'NOT_FOUND'});
    if (current) return send(409, {error: 'CONTAINER_ALREADY_USED'});
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 2 << 20) throw Error('TASK_TOO_LARGE'); chunks.push(chunk); }
    const input = parseCanonicalJson(Buffer.concat(chunks));
    if (!idOk(input.taskId) || !idOk(input.renderId) || !['preview', 'export'].includes(input.mode)) throw Error('NATIVE_TASK_INVALID');
    assertNativeProject(input.project);
    if (input.mode === 'preview') frameTimes(input.project.composition, input.frames);
    if (typeof input.brokerToken !== 'string' || !input.brokerToken || input.brokerToken.length > 16384) throw Error('BROKER_TOKEN_REQUIRED');
    const task = {taskId: input.taskId, renderId: input.renderId, mode: input.mode, project: input.project, ...(input.frames == null ? {} : {frames: input.frames})};
    // Body reads can overlap. Claim the one-task container without another await
    // between checking its state and publishing the accepted task.
    if (current) return send(409, {error: 'CONTAINER_ALREADY_USED'});
    current = {abort: new AbortController(), result: null};
    void execute(task, input.brokerToken, current);
    return send(202, {status: 'running', taskId: input.taskId});
  } catch (error) { return send(400, {error: safeCode(error.message)}); }
});
server.listen(8080, '0.0.0.0');
const stop = async () => { current?.abort.abort(); await launcher('/cancel').catch(() => {}); server.close(); process.stdin.pause(); };
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.stdin.on('data', data => { if (String(data).includes('terminate\n')) void stop(); });
