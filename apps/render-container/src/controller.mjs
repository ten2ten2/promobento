import http from 'node:http';
import {mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {assertRenderTask} from '@promobento/contracts/render';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {brokerClient} from './broker.mjs';
import {renderShard} from './shard.mjs';
import {assemble} from './media.mjs';
import {renderAudio} from './audio.mjs';
import {filmSession} from './browser.mjs';
import {deadline} from './process.mjs';
import {memoryHealth,filesystemDiagnostic} from './memory.mjs';
import {assertStudioFrame,checkStudio,benchmarkCapture} from './studio-tools.mjs';
import {hostIsolation} from './isolation.mjs';

if (process.platform !== 'linux' || process.getuid() !== 10001) throw Error('RENDER_CONTAINER_REQUIRED');
const rules = parseCanonicalJson(readFileSync(new URL('../../../config/platform-presets.json', import.meta.url)));
const lock = parseCanonicalJson(readFileSync(new URL('../environment.lock.json', import.meta.url)));
const fontCatalog = parseCanonicalJson(readFileSync('/opt/fonts/catalog.json'));
let task, requestHash, result, session, workDirectory,studioBusy=false, stored = new Map();
const abort = new AbortController();
const launch = async command => {
  const response = await fetch('http://127.0.0.1:9300/' + command, {method: 'POST', signal: AbortSignal.timeout(35000)});
  if (!response.ok) throw Error('CHROMIUM_UNAVAILABLE');
};
const relativeFiles = directory => readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? relativeFiles(path) : [path];
});

async function execute(input) {
  workDirectory = mkdtempSync('/work/task-');
  const broker = brokerClient(input.brokerToken, abort.signal), objects = new Map(input.inputs.map(object => [object.name, object]));
  const bytes = async (name, maxBytes) => {
    if (!objects.has(name)) throw Error('TASK_INPUT_MISSING');
    if (!stored.has(name)) stored.set(name, await broker.read(objects.get(name), maxBytes));
    return stored.get(name);
  };
  const font = face => {
    const installed = fontCatalog.fonts.find(item => item.fontId === face.fontId && item.weight === face.weight && item.style === face.style);
    if (!installed) throw Error('FONT_FACE_UNAVAILABLE');
    if (face.licenseRef !== installed.licenseRef) throw Error('FONT_LICENSE_MISMATCH');
    return readFileSync('/opt/fonts/' + installed.file);
  };
  const resource = async resourceId => {
    const expected = input.job.resources.find(resource => resource.resourceId === resourceId), actual = objects.get('resource:' + resourceId);
    if (!expected || !actual || expected.sha256 !== actual.sha256) throw Error('RESOURCE_SCOPE_MISMATCH');
    return bytes('resource:' + resourceId);
  };
  const config = {width: rules.aspectLayouts[input.job.aspectId].width, height: rules.aspectLayouts[input.job.aspectId].height,
    encoding: rules.encodingProfiles.mp4_h264_1080_v1, threads: input.instance === 'standard-4' ? 4 : input.mode === 'audio' ? 1 : 2};
  if (input.job.quality === 'review') { config.encoding = {...config.encoding, fps: 15, targetVideoBitrate: 2000000, maxVideoBitrate: 2500000}; }
  const prefix = 'renders/' + input.job.renderId + '/attempts/' + input.taskId + (input.mode === 'shard' ? '/shards/' + input.shard.index : input.mode === 'audio' ? '/audio' : '/out');
  let report;
  if (input.mode === 'shard' || input.mode === 'studio') {
    await launch('start');
    const raw = await bytes('film', 8 << 20);
    if (filmSourceHash(raw) !== input.job.sourceHash) throw Error('SOURCE_SCOPE_MISMATCH');
    input.options.fonts = input.options.fonts.map(face => {
      const installed = fontCatalog.fonts.find(item => item.fontId === face.fontId && item.weight === face.weight && item.style === face.style);
      if (!installed) throw Error('FONT_FACE_UNAVAILABLE');
      if (face.licenseRef !== installed.licenseRef) throw Error('FONT_LICENSE_MISMATCH');
      return {...face, codePoints: installed.codePoints};
    });
    if (input.options.target.width !== config.width || input.options.target.height !== config.height) throw Error('TARGET_SCOPE_MISMATCH');
    const shared = {raw, options: input.options, resource, font, videoFrame: (id, index) => bytes('frame:' + id + ':' + index, 12 << 20),
      signal: abort.signal, browserVersion: lock.browser.version,expectedWebglRenderer:lock.webgl.renderer,killBrowser: () => launch('kill')};
    if (input.mode === 'shard') report = await renderShard({...shared, job: input.job, shard: input.shard, directory: workDirectory,
      imageDigest: process.env.RENDER_IMAGE_DIGEST, encoding: config.encoding, threads: config.threads});
    else {
      session = await filmSession(shared);
      const cpuInfo=readFileSync('/proc/cpuinfo','utf8');
      result = {status: 'ready', frames: input.job.frames, taskId: input.taskId,webgl:session.webgl,
        cpuModel:cpuInfo.match(/^model name\s*:\s*(.*)$/m)?.[1]??'unknown',cpuFlagsHash:digest((cpuInfo.match(/^flags\s*:\s*(.*)$/m)?.[1]??'').split(/\s+/).sort())};
      return;
    }
    await launch('kill');
  } else if (input.mode === 'assemble') {
    const shards = [];
    for (const object of input.inputs.filter(object => /^shard:\d+$/.test(object.name)).sort((a, b) => Number(a.name.slice(6)) - Number(b.name.slice(6)))) {
      const path = join(workDirectory, object.name.replace(':', '-') + '.h264'); writeFileSync(path, await bytes(object.name)); shards.push(path);
    }
    let audioPath;
    if (objects.has('audio')) { audioPath = join(workDirectory, 'mixed.wav'); writeFileSync(audioPath, await bytes('audio')); }
    report = await assemble({shards, audioPath, outputPath: join(workDirectory, 'film.mp4'), posterPath: join(workDirectory, 'poster.png'),
      coverFrame: input.job.quality === 'review' ? Math.floor(input.coverFrame / 2) : input.coverFrame,
      config: input.job.quality === 'review' ? {...config, width: config.width / 2, height: config.height / 2} : config,
      totalFrames: input.job.totalFrames / (input.job.quality === 'review' ? 2 : 1), maxBytes: rules.productLimits.maxOutputFileBytes, signal: abort.signal});
  } else {
    const plan = parseCanonicalJson(await bytes('audio-plan', 4 << 20));
    const {audioPlanHash} = await import('../../../packages/audio/src/plan.mjs');
    if (audioPlanHash(plan,{seed:input.audioInputs.seed}) !== input.job.audioPlanHash) throw Error('AUDIO_PLAN_SCOPE_MISMATCH');
    const bytesBySource = new Map();
    for (const source of plan.sources.filter(source => source.sha256)) bytesBySource.set(source.sourceId, await bytes('audio:' + source.sourceId));
    report = await renderAudio({plan, inputs: {...input.audioInputs, clearedSources: new Map(input.audioInputs.clearedSources.map(source => [source.sourceId, source])),
      bytesBySource, scores: new Map(input.audioInputs.scores ?? [])}, directory: workDirectory, signal: abort.signal});
    report = {...report, path: 'mixed.wav'};
  }
  writeFileSync(join(workDirectory, 'report.json'), canonical(report));
  const outputs = [];
  // Temporary sources and intermediate pre-master PCM are never uploaded as deliverables.
  const allowed = input.mode === 'assemble' ? ['film.mp4', 'poster.png', 'report.json'] : input.mode === 'audio' ? ['mixed.wav', 'report.json'] : null;
  for (const path of relativeFiles(workDirectory)) {
    const name = relative(workDirectory, path); if (allowed && !allowed.includes(name)) continue;
    const mediaType = name.endsWith('.png') ? 'image/png' : name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.h264') ? 'video/h264'
      : name.endsWith('.wav') ? 'audio/wav' : 'application/json';
    outputs.push(await broker.write(prefix + '/' + name, readFileSync(path), mediaType));
  }
  return {status: 'succeeded', taskId: input.taskId, outputs, report};
}

function assertTask(input) {
  assertRenderTask(input);
  if (input.job.rendererRelease !== process.env.RENDERER_RELEASE || !/^sha256:[0-9a-f]{64}$/.test(process.env.RENDER_IMAGE_DIGEST ?? '')) throw Error('RENDER_ENVIRONMENT_MISMATCH');
  if (input.mode === 'shard' && !input.shard || input.mode === 'studio' && input.job.quality !== 'still') throw Error('TASK_INVALID');
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200, {'content-type':'application/json'}).end(canonical({status:'ready',memoryPeak:memoryHealth()})); return;
    }
    if (request.method === 'GET' && request.url === '/result') { response.writeHead(200, {'content-type': 'application/json'}).end(canonical(result ?? {status: 'idle'})); return; }
    if (request.method !== 'POST' || !['/task', '/studio/frame','/studio/check','/studio/benchmark','/studio/isolation'].includes(request.url)) { response.writeHead(404).end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 4 << 20) throw Error('TASK_TOO_LARGE'); chunks.push(chunk); }
    const input = parseCanonicalJson(Buffer.concat(chunks));
    if (request.url.startsWith('/studio/')) {
      assertStudioFrame(task,input,Boolean(session&&result?.status==='ready'));
      if(studioBusy)throw Error('STUDIO_COMMAND_IN_PROGRESS');studioBusy=true;
      try{
       if(request.url==='/studio/frame'){
        const png=await session.frame(input.frameIndex,{format:'png'});response.writeHead(200,{'content-type':'image/png'}).end(png);
       }else if(request.url==='/studio/isolation'){
        const work=(async()=>{
         await session.frame(input.frameIndex,{format:'png'});
         const page=await session.isolation(),host=await hostIsolation(task,abort.signal);
         const uidResponse=await fetch('http://127.0.0.1:9300/isolation',{method:'POST',signal:AbortSignal.timeout(5000)});
         if(!uidResponse.ok)throw Error('ISOLATION_LAUNCHER_UNAVAILABLE');
         const uid=parseCanonicalJson(await uidResponse.text());
         return{scope:'S1_fixed_network_token_uid_and_browser_corpus_not_S2_arbitrary_code_faults',passed:page.passed&&host.passed&&uid.passed,sandbox:session.sandbox,page,host,uid};
        })();
        const value=await deadline(work,30000,'ISOLATION_TIMEOUT',()=>abort.abort());
        response.writeHead(200,{'content-type':'application/json'}).end(canonical(value));
       }else{
        const work=request.url==='/studio/check'?checkStudio(session,task,input.frameIndex):benchmarkCapture(session,input.frameIndex,workDirectory,abort.signal);
        const value=await deadline(work,request.url==='/studio/check'?task.options.frameTimeoutMs:30000,'STUDIO_TOOL_TIMEOUT',()=>abort.abort());
        response.writeHead(200,{'content-type':'application/json'}).end(canonical(value));
       }
      }finally{studioBusy=false;}
      return;
    }
    assertTask(input);
    const identity = digest({...input, brokerToken: null});
    if (task && identity !== requestHash) { response.writeHead(409).end('TASK_ALREADY_BOUND'); return; }
    if (!task) {
      task = input; requestHash = identity; result = {status: 'active', taskId: input.taskId};
      const limit = input.mode === 'studio' ? 20 * 60000 : input.mode === 'shard' ? (input.shard.end - input.shard.start) * (input.instance === 'standard-4' ? 6000 : 1000) + 60000 : 300000;
      void deadline(execute(input), limit, 'RENDER_DEADLINE', () => abort.abort()).then(value => { if (value) result = value; },
        error => { result = {status: 'failed', taskId: input.taskId, code: error.message.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)?.[1] ?? 'RENDER_INTERNAL_ERROR',diagnostic:filesystemDiagnostic(error)}; })
        .finally(() => { if (input.mode !== 'studio') { stored.clear(); if (workDirectory) rmSync(workDirectory, {recursive: true, force: true}); } });
    }
    response.writeHead(202, {'content-type': 'application/json'}).end(canonical({taskId: task.taskId, status: result.status}));
  } catch (error) { response.writeHead(422).end(/^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : 'TASK_INVALID'); }
});
server.listen(8080, '0.0.0.0');
const stop = async () => {
  abort.abort(); await session?.close().catch(() => {}); await launch('kill').catch(() => {});
  server.close(); server.closeAllConnections(); stored.clear(); if (workDirectory) rmSync(workDirectory, {recursive: true, force: true}); process.stdin.pause();
};
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.stdin.on('data', data => { if (String(data).includes('terminate\n')) void stop(); });
