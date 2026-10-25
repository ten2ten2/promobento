import http from 'node:http';
import {spawn} from 'node:child_process';
import {deadline} from './process.mjs';
import {uidIsolation} from './isolation.mjs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
if (process.getuid() !== 10002) throw Error('CHROMIUM_UID_REQUIRED');
let chrome;
export const FLAGS = ['--no-first-run', '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--disable-extensions', '--disable-default-apps', '--mute-audio', '--hide-scrollbars', '--force-color-profile=srgb',
  '--font-render-hinting=none', '--disable-lcd-text', '--disable-skia-runtime-opts', '--disable-partial-raster',
  // Tall-image preparation crashes Chromium with a 64 MiB /dev/shm. Use private /tmp, not a weaker sandbox.
  '--disable-dev-shm-usage',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=2048'];
async function kill() {
  if (!chrome || chrome.exitCode !== null || chrome.signalCode !== null) return;
  const closed = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill('SIGTERM');
  await deadline(closed, 2000, 'CHROMIUM_STOP_TIMEOUT', () => chrome.kill('SIGKILL')).catch(() => {});
}
async function start() {
  if (chrome && chrome.exitCode === null && chrome.signalCode === null) return;
  chrome = spawn('/opt/chrome-headless-shell-linux64/chrome-headless-shell', [...FLAGS,
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9222', '--user-data-dir=/chrome/profile', 'about:blank'],
  {env: {PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/chrome', LANG: 'C.UTF-8', FONTCONFIG_FILE: process.env.FONTCONFIG_FILE}, stdio: ['ignore', 'ignore', 'pipe']});
  await deadline(new Promise((resolve, reject) => {
    chrome.on('error', reject); chrome.once('exit', () => reject(Error('CHROMIUM_STARTUP_FAILED')));
    let log = '';
    chrome.stderr.on('data', chunk => { log = (log + chunk).slice(-2000); if (log.includes('DevTools listening on')) resolve(); });
  }), 30000, 'CHROMIUM_STARTUP_TIMEOUT', () => chrome.kill('SIGKILL'));
}
const server = http.createServer(async (request, response) => {
  try {
    if(request.method==='POST'&&request.url==='/isolation'){
      let report;
      try{
        const chunks=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>1024)throw Error('ISOLATION_SCOPE_INVALID');chunks.push(chunk);}
        report=uidIsolation(parseCanonicalJson(Buffer.concat(chunks)));
      }
      catch(error){report={passed:false,error:{name:String(error.name??'Error'),code:String(error.code??'UNKNOWN'),message:String(error.message??error).slice(0,300)}};}
      response.writeHead(200,{'content-type':'application/json'}).end(canonical(report));return;
    }
    if (request.method !== 'POST' || !['/start', '/kill'].includes(request.url)) { response.writeHead(404).end(); return; }
    if (request.url === '/start') await start(); else await kill();
    response.writeHead(200, {'content-type': 'application/json'}).end('{"ok":true}');
  } catch { response.writeHead(500).end('CHROMIUM_UNAVAILABLE'); }
});
server.listen(9300, '127.0.0.1');
const stop = async () => { await kill(); server.close(); process.stdin.pause(); };
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, stop);
process.stdin.on('data', data => { if (String(data).includes('terminate\n')) void stop(); });
