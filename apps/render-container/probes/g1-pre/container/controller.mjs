// Runs as uid 10001. Receives the broker token in the first task request body and keeps it
// only in memory. Each task kind answers one G1 pre-probe question.
import http from 'node:http';
import {readFileSync, writeFileSync, existsSync, statSync, readdirSync} from 'node:fs';
import {join, extname, normalize} from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import dns from 'node:dns';
import net from 'node:net';
import dgram from 'node:dgram';
import {chromium} from 'playwright-core';

const envToken = process.env.DUMMY_ENV_TOKEN || null;
delete process.env.DUMMY_ENV_TOKEN;
let bodyToken = null;

const SITE = '/site';
const WORK = '/work';
const now = () => performance.now();
const round = n => Math.round(n * 10) / 10;
const stats = values => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return {n: s.length, mean: round(s.reduce((a, b) => a + b, 0) / s.length), p50: round(q(0.5)), p95: round(q(0.95)), max: round(s.at(-1))};
};
const read = path => { try { return readFileSync(path, 'utf8').trim(); } catch (error) { return `unavailable: ${error.code}`; } };
const field = (text, name) => text.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))?.[1] ?? null;

function machine() {
  const cpuinfo = read('/proc/cpuinfo');
  return {
    kernel: read('/proc/version').split(' ').slice(0, 3).join(' '),
    cpu: cpuinfo.match(/^model name\s*:\s*(.*)$/m)?.[1] ?? null,
    cpuFamilyModel: `${cpuinfo.match(/^cpu family\s*:\s*(.*)$/m)?.[1]}/${cpuinfo.match(/^model\s*:\s*(.*)$/m)?.[1]}`,
    nproc: Number(execFileSync('nproc').toString()),
    cgroupCpuMax: read('/sys/fs/cgroup/cpu.max'),
    memTotal: field(read('/proc/meminfo'), 'MemTotal')
  };
}

// ---------- static site for the test pages ----------
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary'};
http.createServer((request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://site').pathname));
  const file = join(SITE, path);
  if (!file.startsWith(SITE + '/') || !existsSync(file) || statSync(file).isDirectory()) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'content-type': TYPES[extname(file)] ?? 'application/octet-stream'}).end(readFileSync(file));
}).listen(8090, '127.0.0.1');

// ---------- Chromium via the uid-10002 launcher ----------
async function launcher(path, body = {}) {
  const response = await fetch('http://127.0.0.1:9300' + path, {method: 'POST', body: JSON.stringify(body)});
  const json = await response.json();
  if (!response.ok) throw Error(json.error ?? `launcher ${response.status}`);
  return json;
}
async function openBrowser(userDataDir = `/chrome/profile-${Date.now()}`) {
  const launched = await launcher('/launch', {userDataDir});
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', {timeout: 60000});
  return {browser, ...launched, userDataDir};
}
async function closeBrowser(handle) {
  try { await handle.browser.close(); } catch {}
  await launcher('/kill');
}

const ENGINE = existsSync('/site/engine.js') ? readFileSync('/site/engine.js', 'utf8') : '';
async function openTemplate(handle, template, {dpr = 1, width = 1920, height = 1080} = {}) {
  const context = handle.browser.contexts()[0];
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: dpr, mobile: false});
  await page.addInitScript(`window.__omConfig=${JSON.stringify({paintWaits: 2})};\n${ENGINE}`);
  const started = now();
  await page.goto(`http://127.0.0.1:8090/${template}/index.html`, {waitUntil: 'load', timeout: 180000});
  await page.waitForFunction(() => window.__omReady || window.__omBootFailed, null, {timeout: 240000, polling: 200});
  const failed = await page.evaluate(() => window.__omBootFailed || null);
  if (failed) throw Error('boot failed: ' + failed);
  return {page, cdp, loadMs: Math.round(now() - started)};
}
const seek = (page, t) => page.evaluate(time => window.__omEngine.seek(time), t);
async function capture(cdp, format, quality) {
  const options = {format, optimizeForSpeed: true};
  if (format === 'jpeg') options.quality = quality;
  const {data} = await cdp.send('Page.captureScreenshot', options);
  return Buffer.from(data, 'base64');
}

function encoder(inputCodec, output) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', inputCodec, '-framerate', '30', '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-bf', '0',
    '-f', 'h264', '-y', output], {stdio: ['pipe', 'ignore', 'pipe']});
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  const done = new Promise(resolve => child.on('close', code => resolve({code, error: error.slice(-500)})));
  return {
    write: buffer => new Promise(resolve => { if (child.stdin.write(buffer)) resolve(); else child.stdin.once('drain', resolve); }),
    end: () => { child.stdin.end(); return done; }
  };
}

const rgba = buffer => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'],
  {input: buffer, maxBuffer: 64 << 20});
function compare(a, b) {
  const x = rgba(a), y = rgba(b);
  if (x.length !== y.length) return {sizeMismatch: [x.length, y.length]};
  let max = 0, pixels = 0;
  for (let i = 0; i < x.length; i += 4) {
    const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]), Math.abs(x[i + 3] - y[i + 3]));
    if (d > max) max = d;
    if (d) pixels++;
  }
  const share = pixels / (x.length / 4);
  return {identical: pixels === 0, maxChannelDiff: max, diffPixelPct: Number((share * 100).toFixed(4)), withinTolerance: max <= 2 && share <= 0.001};
}
// ffmpeg writes the SSIM summary to stderr.
function ffmpegStderr(args) {
  return new Promise(resolve => {
    const child = spawn('ffmpeg', args, {stdio: ['ignore', 'ignore', 'pipe']});
    let text = '';
    child.stderr.on('data', chunk => { text += chunk; });
    child.on('close', () => resolve(text));
  });
}
async function ssimAsync(reference, test) {
  const a = join(WORK, `ssim-a-${Math.random()}`), b = join(WORK, `ssim-b-${Math.random()}`);
  writeFileSync(a, reference); writeFileSync(b, test);
  const text = await ffmpegStderr(['-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-']);
  return Number(text.match(/All:([\d.]+)/)?.[1] ?? NaN);
}

// ---------- task kinds ----------
async function timed(fn, ms = 6000) {
  const started = now();
  try {
    const value = await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), ms))]);
    return {completed: true, ms: Math.round(now() - started), ...value};
  } catch (error) {
    return {completed: false, ms: Math.round(now() - started), error: String(error.cause?.code ?? error.cause?.message ?? error.message).slice(0, 200)};
  }
}
const httpTest = (url, init) => timed(async () => {
  const response = await fetch(url, init);
  return {status: response.status, body: (await response.text()).slice(0, 300)};
});

async function networkTask() {
  const auth = {authorization: `Bearer ${bodyToken}`};
  return {
    brokerRead: await httpTest('http://broker.internal/r/probe.txt', {headers: auth}),
    brokerNoToken: await httpTest('http://broker.internal/r/probe.txt'),
    brokerWrongKey: await httpTest('http://broker.internal/r/other.txt', {headers: auth}),
    brokerWrite: await httpTest('http://broker.internal/w/out/probe.json', {method: 'PUT', headers: auth, body: '{"ok":true}'}),
    brokerWriteOutsidePrefix: await httpTest('http://broker.internal/w/other/x.json', {method: 'PUT', headers: auth, body: '{}'}),
    httpPublic: await httpTest('http://example.com/'),
    httpsPublic: await httpTest('https://example.com/'),
    httpDirectIp: await httpTest('http://1.1.1.1/'),
    dnsPublic: await timed(async () => ({address: (await dns.promises.lookup('example.com')).address})),
    dnsBroker: await timed(async () => ({address: (await dns.promises.lookup('broker.internal')).address})),
    tcp443: await timed(() => new Promise((resolve, reject) => {
      const socket = net.connect(443, '1.1.1.1', () => { socket.destroy(); resolve({connected: true}); });
      socket.on('error', reject);
    })),
    tcpBroker8443: await timed(() => new Promise((resolve, reject) => {
      const socket = net.connect(8443, 'broker.internal', () => { socket.destroy(); resolve({connected: true}); });
      socket.on('error', reject);
    })),
    udpDns: await timed(() => new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const query = Buffer.from('abcd01000001000000000000076578616d706c6503636f6d0000010001', 'hex');
      socket.on('message', () => { socket.close(); resolve({answered: true}); });
      socket.on('error', reject);
      socket.send(query, 53, '1.1.1.1');
    }), 4000)
  };
}

async function isolationTask() {
  const handle = await openBrowser();
  try {
    const needles = {bodyToken, envToken};
    const sameUid = await new Promise(resolve => {
      const child = spawn('node', ['/app/spy.mjs', String(process.pid), JSON.stringify(needles)], {env: {PATH: process.env.PATH}});
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      child.on('close', () => { try { resolve(JSON.parse(out)); } catch { resolve({raw: out}); } });
    });
    const otherUid = await launcher('/spy', {pid: process.pid, needles});
    return {
      controllerUid: process.getuid(), controllerPid: process.pid,
      tokenSources: {bodyTokenReceived: Boolean(bodyToken), envTokenReceivedAndDeleted: Boolean(envToken) && !process.env.DUMMY_ENV_TOKEN},
      ptraceScope: read('/proc/sys/kernel/yama/ptrace_scope'),
      sameUidSpy: sameUid,
      chromiumUidSpy: otherUid
    };
  } finally { await closeBrowser(handle); }
}

function chromeProcesses() {
  const list = [];
  for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    // Chrome rewrites process titles, so arguments may be space-separated rather than NUL-separated.
    const cmd = read(`/proc/${pid}/cmdline`).split(/[\0 ]+/).filter(Boolean);
    if (!cmd[0]?.includes('chrome-headless-shell')) continue;
    const status = read(`/proc/${pid}/status`);
    list.push({pid: Number(pid), type: cmd.find(arg => arg.startsWith('--type='))?.slice(7) ?? 'browser',
      uid: field(status, 'Uid')?.split(/\s+/)[0], seccomp: field(status, 'Seccomp'), nspid: field(status, 'NSpid'),
      uidMap: read(`/proc/${pid}/uid_map`).replace(/\s+/g, ' '), noSandboxFlag: cmd.includes('--no-sandbox')});
  }
  return list;
}

async function sandboxTask() {
  const handle = await openBrowser();
  try {
    const page = await handle.browser.contexts()[0].newPage();
    await page.setContent('<canvas id=c width=64 height=64></canvas><div style="font:48px sans-serif">probe</div>');
    const webgl = await page.evaluate(() => {
      const gl = document.getElementById('c').getContext('webgl2');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {version: gl.getParameter(gl.VERSION), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)};
    });
    const processes = chromeProcesses();
    const browserProcess = processes.find(item => item.type === 'browser');
    const renderers = processes.filter(item => item.type === 'renderer');
    const checks = {
      renderers: renderers.length,
      seccompFilter: renderers.length > 0 && renderers.every(item => item.seccomp === '2'),
      nestedPidNamespace: renderers.length > 0 && renderers.every(item => item.nspid?.trim().split(/\s+/).length > 1),
      separateUserNamespace: renderers.length > 0 && renderers.every(item => item.uidMap !== browserProcess?.uidMap),
      chromiumUid: [...new Set(processes.map(item => item.uid))],
      noSandboxFlagPresent: processes.some(item => item.noSandboxFlag)
    };
    const full = checks.seccompFilter && checks.nestedPidNamespace && checks.separateUserNamespace && !checks.noSandboxFlagPresent
      && checks.chromiumUid.length === 1 && checks.chromiumUid[0] === '10002';
    return {verdict: full ? 'SANDBOX_FULL_SEPARATE_UID' : 'SANDBOX_NOT_FULL', launchMs: handle.launchMs, webgl, checks, processes};
  } finally { await closeBrowser(handle); }
}

async function captureTask({template = 'kinetic-type', frames = 90} = {}) {
  const formats = [
    {name: 'png', format: 'png', codec: 'png'},
    {name: 'jpeg90', format: 'jpeg', quality: 90, codec: 'mjpeg'},
    {name: 'jpeg92', format: 'jpeg', quality: 92, codec: 'mjpeg'},
    {name: 'jpeg95', format: 'jpeg', quality: 95, codec: 'mjpeg'}
  ];
  const samples = [0, Math.floor(frames / 2), frames - 1];
  const handle = await openBrowser();
  const results = {};
  const kept = {};
  try {
    for (const spec of formats) {
      const {page, cdp, loadMs} = await openTemplate(handle, template);
      const out = encoder(spec.codec, join(WORK, `${spec.name}.h264`));
      const seekMs = [], captureMs = [], writeMs = [], bytes = [];
      const started = now();
      for (let frame = 0; frame < frames; frame++) {
        const a = now(); await seek(page, frame / 30);
        const b = now(); const image = await capture(cdp, spec.format, spec.quality);
        const c = now(); await out.write(image);
        const d = now();
        seekMs.push(b - a); captureMs.push(c - b); writeMs.push(d - c); bytes.push(image.length);
        if (samples.includes(frame)) kept[`${spec.name}:${frame}`] = image;
      }
      const loopMs = now() - started;
      const encoded = await out.end();
      const totalMs = now() - started;
      results[spec.name] = {loadMs, frames, msPerFrameLoop: round(loopMs / frames), msPerFrameIncludingEncodeDrain: round(totalMs / frames),
        seekMs: stats(seekMs), captureMs: stats(captureMs), pipeWriteMs: stats(writeMs), meanBytes: Math.round(bytes.reduce((x, y) => x + y, 0) / frames),
        encoderExit: encoded.code, encoderError: encoded.error || undefined,
        h264Bytes: existsSync(join(WORK, `${spec.name}.h264`)) ? statSync(join(WORK, `${spec.name}.h264`)).size : null};
      await page.close();
    }
  } finally { await closeBrowser(handle); }
  const ssimVsPng = {};
  for (const name of ['jpeg90', 'jpeg92', 'jpeg95'])
    ssimVsPng[name] = await Promise.all(samples.map(frame => ssimAsync(kept[`png:${frame}`], kept[`${name}:${frame}`])));
  return {machine: machine(), template, results, ssimVsPng, sampleFrames: samples};
}

async function seamTask({template = 'kinetic-type', frame = 59} = {}) {
  const handle = await openBrowser();
  try {
    const sequential = await openTemplate(handle, template);
    let sequentialFrame;
    for (let f = 0; f <= frame; f++) {
      await seek(sequential.page, f / 30);
      if (f === frame) sequentialFrame = await capture(sequential.cdp, 'png');
    }
    await sequential.page.close();
    const cold = await openTemplate(handle, template);
    await seek(cold.page, frame / 30);
    const coldFrame = await capture(cold.cdp, 'png');
    await cold.page.close();
    const warmByOne = await openTemplate(handle, template);
    await seek(warmByOne.page, (frame - 1) / 30);
    await seek(warmByOne.page, frame / 30);
    const warmFrame = await capture(warmByOne.cdp, 'png');
    await warmByOne.page.close();
    return {template, frame, coldVsSequential: compare(sequentialFrame, coldFrame), oneFrameWarmVsSequential: compare(sequentialFrame, warmFrame)};
  } finally { await closeBrowser(handle); }
}

async function webglRun(userDataDir, {dpr, frames}) {
  const handle = await openBrowser(userDataDir);
  try {
    const opened = await openTemplate(handle, 'object-3d', {dpr});
    const renderer = await opened.page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    });
    const first = now();
    await seek(opened.page, 0);
    await capture(opened.cdp, 'jpeg', 92);
    const firstFrameMs = Math.round(now() - first);
    const perFrame = [];
    for (let f = 1; f <= frames; f++) {
      const t = now();
      await seek(opened.page, f / 30);
      await capture(opened.cdp, 'jpeg', 92);
      perFrame.push(now() - t);
    }
    return {launchMs: handle.launchMs, loadMs: opened.loadMs, firstFrameMs, perFrameMs: stats(perFrame), renderer};
  } finally { await closeBrowser(handle); }
}

async function webglTask({dpr = 1, frames = 6, userDataDir = '/chrome/webgl-cache'} = {}) {
  const fresh = await webglRun(userDataDir, {dpr, frames});
  const cacheAfterFirst = await launcher('/du', {path: userDataDir});
  const relaunchSameProfile = await webglRun(userDataDir, {dpr, frames: 2});
  return {machine: machine(), dpr, userDataDir, fresh, cacheAfterFirst, relaunchSameProfile};
}

async function webglFromSnapshotTask({dpr = 1, userDataDir = '/chrome/webgl-cache'} = {}) {
  const before = await launcher('/du', {path: userDataDir});
  const run = await webglRun(userDataDir, {dpr, frames: 2});
  return {machine: machine(), profileBeforeRun: before, run};
}

const TASKS = {
  info: async () => ({machine: machine(), uid: process.getuid(), pid: process.pid}),
  network: networkTask, isolation: isolationTask, sandbox: sandboxTask,
  capture: captureTask, seam: seamTask, webgl: webglTask, webglFromSnapshot: webglFromSnapshotTask,
  sleep: async ({ms = 120000} = {}) => { await new Promise(resolve => setTimeout(resolve, ms)); return {slept: ms}; }
};

http.createServer(async (request, response) => {
  // Readiness probes from the platform arrive here too; they must never end the process.
  if (request.url === '/ready') { response.writeHead(200).end(JSON.stringify({ok: true, pid: process.pid, uid: process.getuid()})); return; }
  if (request.url !== '/task' || request.method !== 'POST') { response.writeHead(404).end(); return; }
  let body = '';
  for await (const chunk of request) body += chunk;
  const started = now();
  try {
    const {token, kind, params} = JSON.parse(body);
    if (token) bodyToken = token;
    if (!TASKS[kind]) throw Error('unknown task ' + kind);
    const result = await TASKS[kind](params ?? {});
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({kind, ok: true, ms: Math.round(now() - started), result}));
  } catch (error) {
    response.writeHead(500, {'content-type': 'application/json'}).end(JSON.stringify({ok: false, ms: Math.round(now() - started), error: String(error.stack ?? error).slice(0, 2000)}));
  }
}).listen(8080, '0.0.0.0', () => console.log('controller: listening on 8080 as uid ' + process.getuid()));

process.on('SIGTERM', () => { console.log('controller: SIGTERM, exiting'); process.exit(143); });
