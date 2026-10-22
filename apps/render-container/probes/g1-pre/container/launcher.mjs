// Runs as uid 10002. Starts and stops Chromium for the controller and acts as the
// "escaped renderer" spy: everything it can read, a sandbox escape could read too.
import http from 'node:http';
import {spawn, execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, openSync, readSync, closeSync} from 'node:fs';

const CHROME = '/opt/chrome-headless-shell-linux64/chrome-headless-shell';
const FLAGS = [
  '--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-extensions', '--disable-default-apps', '--mute-audio', '--hide-scrollbars',
  '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text',
  '--disable-skia-runtime-opts', '--disable-partial-raster',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=2048'
];
let chrome = null;

function launch({userDataDir, args = []}) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    chrome = spawn(CHROME, [...FLAGS, ...args, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222',
      `--user-data-dir=${userDataDir}`, 'about:blank'], {env: {PATH: '/usr/bin:/bin', HOME: '/chrome'}, stdio: ['ignore', 'ignore', 'pipe']});
    let log = '';
    const timer = setTimeout(() => reject(Error('chrome did not report DevTools within 60s: ' + log.slice(-800))), 60000);
    chrome.stderr.on('data', chunk => {
      log = (log + chunk).slice(-8000);
      if (/DevTools listening on ws:\/\//.test(log)) {
        clearTimeout(timer);
        resolve({pid: chrome.pid, launchMs: Math.round(performance.now() - started)});
      }
    });
    chrome.on('exit', code => { clearTimeout(timer); reject(Error(`chrome exited early code=${code}: ${log.slice(-800)}`)); });
  });
}

function kill() {
  return new Promise(resolve => {
    if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return resolve({killed: false});
    chrome.once('exit', () => resolve({killed: true}));
    chrome.kill('SIGKILL');
  });
}

const read = path => { try { return readFileSync(path, 'utf8'); } catch (error) { return {error: error.code}; } };

function spy({pid, needles}) {
  const found = text => typeof text === 'string' ? Object.entries(needles).filter(([, v]) => v && text.includes(v)).map(([k]) => k) : text;
  let mem;
  try {
    const maps = readFileSync(`/proc/${pid}/maps`, 'utf8').split('\n').find(line => / rw-p /.test(line));
    const start = parseInt(maps.split('-')[0], 16);
    const fd = openSync(`/proc/${pid}/mem`, 'r');
    const buffer = Buffer.alloc(16);
    readSync(fd, buffer, 0, 16, start);
    closeSync(fd);
    mem = 'readable';
  } catch (error) { mem = {error: error.code ?? String(error.message)}; }
  const scan = [];
  for (const p of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
    const env = read(`/proc/${p}/environ`);
    if (typeof env === 'string') {
      const hits = found(env);
      if (hits.length) scan.push({pid: Number(p), hits});
    }
  }
  return {
    spyUid: process.getuid(),
    targetEnviron: found(read(`/proc/${pid}/environ`)),
    targetMem: mem,
    environScanHits: scan
  };
}

function du(path) {
  try { return execFileSync('du', ['-sk', path]).toString().trim(); } catch (error) { return {error: String(error.message).slice(0, 200)}; }
}

http.createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const input = body ? JSON.parse(body) : {};
  try {
    let result;
    if (request.url === '/launch') { await kill(); result = await launch(input); }
    else if (request.url === '/kill') result = await kill();
    else if (request.url === '/spy') result = spy(input);
    else if (request.url === '/du') result = {path: input.path, du: du(input.path)};
    else { response.writeHead(404).end(); return; }
    response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(500, {'content-type': 'application/json'}).end(JSON.stringify({error: String(error.message)}));
  }
}).listen(9300, '127.0.0.1', () => console.log('launcher: listening on 127.0.0.1:9300 as uid ' + process.getuid()));

process.on('SIGTERM', async () => { await kill(); process.exit(143); });
