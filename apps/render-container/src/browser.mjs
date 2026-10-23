import http from 'node:http';
import {readFileSync, readdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {generateFilmPage} from '../../../packages/film-runtime/dist/page.mjs';
import {deadline} from './process.mjs';
import {observe} from './observe.mjs';

/** Checked before loading any film. Failing this is a platform error, never a no-sandbox fallback. */
export function sandboxState() {
  const processes = readdirSync('/proc').filter(pid => /^\d+$/.test(pid)).flatMap(pid => {
    try {
      const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (!command.includes('--type=renderer')) return [];
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      return [{pid: Number(pid), chromiumUid: Number(status.match(/^Uid:\s+(\d+)/m)?.[1]),
        seccomp: Number(status.match(/^Seccomp:\s+(\d+)/m)?.[1]) === 2,
        nestedPidNamespace: (status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).length ?? 0) > 1,
        uidMap: readFileSync(`/proc/${pid}/uid_map`, 'utf8').trim()}];
    } catch { return []; }
  });
  if (!processes.length || processes.some(process => process.chromiumUid !== 10002 || !process.seccomp
    || !process.nestedPidNamespace || !/^\s*10002\s+10002\s+1\s*$/.test(process.uidMap))) throw Error('RENDER_SANDBOX_UNAVAILABLE');
  return {seccomp: true, nestedPidNamespace: true, separateUserNamespace: true, chromiumUid: 10002};
}

/** The caller supplies authorized immutable bytes, not filesystem paths or arbitrary URLs from the film. */
export async function filmSession({raw, options, browserVersion, resource, videoFrame, font, signal, killBrowser,
  captureScale = 1, endpoint = 'http://127.0.0.1:9222', runtimeDirectory = new URL('../../../packages/film-runtime/dist/browser/', import.meta.url)}) {
  if (process.platform !== 'linux' || process.getuid() !== 10001) throw Error('RENDER_CONTAINER_REQUIRED');
  if (![1, .5].includes(captureScale)) throw Error('CAPTURE_SCALE_INVALID');
  const generated = generateFilmPage(raw, options), {plan} = generated;
  const scripts = new Map(['shim', 'engine', 'gsap', 'compat', 'blocks', 'boot'].map(name => [`/runtime/${name}.js`, readFileSync(new URL(name + '.js', runtimeDirectory))]));
  const assets = new Map(Object.values(plan.assets).map(asset => ['/r/' + asset.resourceId, asset]));
  const fonts = new Map(plan.fonts.map(face => [`/f/${face.fontId}/${face.weight}-${face.style}.woff2`, face]));
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      const path = new URL(request.url, 'http://film.internal').pathname;
      if (path === '/film.html') { response.writeHead(200, {'content-type': 'text/html; charset=utf-8',
        'content-security-policy': generated.csp}).end(generated.html); return; }
      if (scripts.has(path)) { response.writeHead(200, {'content-type': 'text/javascript'}).end(scripts.get(path)); return; }
      if (assets.has(path)) { const asset = assets.get(path); const bytes = await resource(asset.resourceId);
        response.writeHead(200, {'content-type': asset.kind === 'svg' ? 'image/svg+xml' : 'application/octet-stream'}).end(bytes); return; }
      const frame = /^\/frames\/(res_[A-Za-z0-9_-]{4,64})\/(\d+)\.webp$/.exec(path);
      if (frame && videoFrame && [...assets.values()].some(asset => asset.resourceId === frame[1] && asset.videoFrames?.some(item => item.index === Number(frame[2])))) {
        response.writeHead(200, {'content-type': 'image/webp'}).end(await videoFrame(frame[1], Number(frame[2]))); return;
      }
      if (fonts.has(path)) { const bytes = await font(fonts.get(path)); response.writeHead(200, {'content-type': 'font/woff2'}).end(bytes); return; }
      response.writeHead(404).end();
    } catch { response.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, context, page;
  const cancel = () => { void killBrowser?.(); };
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    const connectStarted = performance.now();
    signal?.throwIfAborted();
    browser = await chromium.connectOverCDP(endpoint, {timeout: options.initTimeoutMs});
    if (browser.version() !== browserVersion) throw Error('RENDER_ENVIRONMENT_MISMATCH');
    context = await browser.newContext({viewport: {width: plan.target.width, height: plan.target.height}, deviceScaleFactor: 1});
    page = await context.newPage();
    const sandbox = sandboxState();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: scripts.get('/runtime/shim.js').toString()});
    let pageError;
    page.on('crash', () => { pageError = 'RENDER_PAGE_CRASHED'; });
    page.on('pageerror', error => { pageError = error.message; });
    const url = `http://127.0.0.1:${server.address().port}/film.html`;
    const connectedAt = performance.now();
    await deadline((async () => {
      await page.goto(url, {waitUntil: 'load', timeout: options.initTimeoutMs});
      await page.waitForFunction(() => window.__omReady || window.__omBootFailed, null, {timeout: options.initTimeoutMs});
      const failure = await page.evaluate(() => window.__omBootFailed);
      if (failure || pageError) throw Error(failure ?? pageError);
    })(), options.initTimeoutMs, 'INIT_TIMEOUT', cancel);
    const scope = {protocolVersion: '3.0.0', sessionId: crypto.randomUUID(), revisionId: crypto.randomUUID(), aspectId: plan.target.aspect};
    let sequence = 0, closed = false, currentFrame = -1;
    const envelope = command => ({...scope, command, sequence: ++sequence, requestId: crypto.randomUUID()});
    await page.evaluate(input => window.__omEngine.init(input), {...envelope('init'), mode: 'trusted_render', pixelScale: 1,
      manifestHash: plan.manifestHash, frameCount: plan.spec.totalFrames, width: plan.target.width, height: plan.target.height,
      fps: 30, seed: plan.seed, renderProfile: {sampleCount: 1, shutterAngle: 0, sampling: 'centered-box-v1', edgePolicy: 'clamp-v1'}});
    return {
      plan, sandbox, timings: {readyMs: Math.round(connectedAt - connectStarted), handshakeMs: Math.round(performance.now() - connectedAt)},
      async frame(frameIndex, {format = 'jpeg'} = {}) {
        if (closed || pageError) throw Error(pageError ?? 'INVALID_SESSION');
        signal?.throwIfAborted();
        const input = {...envelope('seek'), frameIndex};
        return deadline((async () => {
          const ready = await page.evaluate(input => window.__omEngine.seekFrame(input), input);
          for (const key of ['protocolVersion', 'sessionId', 'revisionId', 'aspectId', 'requestId', 'sequence', 'frameIndex'])
            if (ready[key] !== input[key]) throw Error('FRAME_ACK_MISMATCH');
          if (ready.event !== 'frame-ready' || ready.manifestHash !== plan.manifestHash) throw Error('FRAME_ACK_MISMATCH');
          if (pageError) throw Error(pageError);
          const screenshot = await cdp.send('Page.captureScreenshot', {format, ...(format === 'jpeg' ? {quality: 92} : {}),
            optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false,
            clip: {x: 0, y: 0, width: plan.target.width, height: plan.target.height, scale: captureScale}});
          currentFrame = frameIndex;
          return Buffer.from(screenshot.data, 'base64');
        })(), options.frameTimeoutMs, 'FRAME_TIMEOUT', cancel);
      },
      async observe(renderId, frame) { if (closed || currentFrame !== frame) throw Error('FRAME_NOT_READY'); return observe(cdp, plan, renderId, frame); },
      async capturePng(frame) {
        if (closed || currentFrame !== frame) throw Error('FRAME_NOT_READY');
        return Buffer.from((await cdp.send('Page.captureScreenshot', {format: 'png', optimizeForSpeed: true, captureBeyondViewport: false, clip: {x: 0, y: 0, width: plan.target.width, height: plan.target.height, scale: captureScale}})).data, 'base64');
      },
      async close() {
        if (closed) return; closed = true;
        try { await deadline(page.evaluate(input => window.__omEngine.dispose(input), envelope('dispose')), 1000, 'DISPOSE_TIMEOUT', cancel); }
        finally { signal?.removeEventListener('abort', cancel); await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
      }
    };
  } catch (error) {
    signal?.removeEventListener('abort', cancel);
    await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await new Promise(resolve => server.close(resolve));
    throw error;
  }
}
