import http from 'node:http';
import {readFileSync, readdirSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {generateFilmPage} from '../../../packages/film-runtime/dist/page.mjs';
import {deadline} from './process.mjs';
import {observe} from './observe.mjs';
import {appendCanvasTextObservations} from './canvas-text-proof.mjs';
import {pageIsolation} from './isolation.mjs';
import {inRenderPhase} from './failure.mjs';
import {waitForRuntimeReady} from './readiness.mjs';
import {pageCaller} from './page-call.mjs';
import {assertCanvasTextTrace,isCanvasTextScene} from '@promobento/contracts/canvas-text';

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
  expectedWebglRenderer,captureScale = 1, endpoint = 'http://127.0.0.1:9222', runtimeDirectory = new URL('../../../packages/film-runtime/dist/browser/', import.meta.url)}) {
  if (process.platform !== 'linux' || process.getuid() !== 10001) throw Error('RENDER_CONTAINER_REQUIRED');
  if (![1, .5].includes(captureScale)) throw Error('CAPTURE_SCALE_INVALID');
  const generated = generateFilmPage(raw, options), {plan} = generated;
  if(plan.spec.scenes.some(scene=>scene.kind==='block'&&scene.block==='canvas-number@1')){
    const face=plan.spec.style.type.display,font=plan.fonts.find(item=>item.fontId===face.fontId&&item.weight===face.weight&&item.style===(face.style??'normal'));
    if(!font?.codePoints||[...'0123456789'].some(character=>!font.codePoints.includes(character.codePointAt(0))))throw Error('CANVAS_NUMBER_DIGIT_COVERAGE_REQUIRED');
  }
  const scripts = new Map(['shim', 'engine', 'gsap', 'compat', 'blocks', 'boot',...(plan.usesWebgl?['blocks-3d']:[])].map(name => [`/runtime/${name}.js`, readFileSync(new URL(name + '.js', runtimeDirectory))]));
  for(const [path,source]of Object.entries(options.customSources??{}))scripts.set('/'+path,Buffer.from('"use strict";\n'+source));
  const assets = new Map(Object.values(plan.assets).map(asset => ['/r/' + asset.resourceId, asset]));
  const fonts = new Map(plan.fonts.map(face => [`/f/${face.fontId}/${face.weight}-${face.style}.woff2`, face]));
  let isolationEnabled=false,requestFailure;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      const path = new URL(request.url, 'http://film.internal').pathname;
      if (path === '/film.html') { response.writeHead(200, {'content-type': 'text/html; charset=utf-8',
        'content-security-policy': generated.csp}).end(generated.html); return; }
      if (scripts.has(path)) { response.writeHead(200, {'content-type': 'text/javascript'}).end(scripts.get(path)); return; }
      if(path==='/runtime/isolation-probe.js'&&isolationEnabled){
        response.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'}).end(readFileSync(new URL('./isolation-page.js',import.meta.url)));return;
      }
      if (assets.has(path)) { const asset = assets.get(path); const bytes = await inRenderPhase({phase:'broker_input_read'},()=>resource(asset.resourceId));
        response.writeHead(200, {'content-type': asset.kind === 'svg' ? 'image/svg+xml' : 'application/octet-stream'}).end(bytes); return; }
      const frame = /^\/frames\/(res_[A-Za-z0-9_-]{4,64})\/(\d+)\.webp$/.exec(path);
      if (frame && videoFrame && [...assets.values()].some(asset => asset.resourceId === frame[1] && asset.videoFrames?.some(item => item.index === Number(frame[2])))) {
        response.writeHead(200, {'content-type': 'image/webp'}).end(await videoFrame(frame[1], Number(frame[2]))); return;
      }
      if (fonts.has(path)) { const bytes = await font(fonts.get(path)); response.writeHead(200, {'content-type': 'font/woff2'}).end(bytes); return; }
      response.writeHead(404).end();
    } catch(error) { requestFailure??=error;response.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, context, page;
  const cancel = () => { void Promise.resolve(killBrowser?.()).catch(()=>{}); };
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    const connectStarted = performance.now();
    signal?.throwIfAborted();
    browser = await inRenderPhase({phase:'browser_connect'},()=>chromium.connectOverCDP(endpoint, {timeout: options.initTimeoutMs}));
    if (browser.version() !== browserVersion) throw Error('RENDER_ENVIRONMENT_MISMATCH');
    context = await inRenderPhase({phase:'browser_context'},()=>browser.newContext({viewport: {width: plan.target.width, height: plan.target.height}, deviceScaleFactor: 1}));
    page = await inRenderPhase({phase:'browser_context'},()=>context.newPage());
    const sandbox = sandboxState();
    const cdp = await context.newCDPSession(page);
    const evaluate=pageCaller(cdp);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {source: scripts.get('/runtime/shim.js').toString()});
    let pageError;
    page.on('crash', () => { pageError = 'RENDER_PAGE_CRASHED'; });
    page.on('pageerror', error => { pageError = error.message; });
    const url = `http://127.0.0.1:${server.address().port}/film.html`;
    const connectedAt = performance.now();
    await deadline((async () => {
      await inRenderPhase({phase:'page_load'},()=>page.goto(url, {waitUntil: 'load', timeout: options.initTimeoutMs}));
      await inRenderPhase({phase:'runtime_ready'},()=>waitForRuntimeReady({timeoutMs:options.initTimeoutMs,signal,pageError:()=>requestFailure??pageError,
        read:()=>evaluate(()=>({ready:window.__omReady===true,failure:window.__omBootFailed??null}))}));
    })(), options.initTimeoutMs, 'INIT_TIMEOUT', cancel);
    const scope = {protocolVersion: '3.0.0', sessionId: crypto.randomUUID(), revisionId: crypto.randomUUID(), aspectId: plan.target.aspect};
    let sequence = 0, closed = false, currentFrame = -1, currentCanvasTextTrace;
    const hasCanvasText=plan.spec.scenes.some(scene=>isCanvasTextScene(scene));
    const envelope = command => ({...scope, command, sequence: ++sequence, requestId: crypto.randomUUID()});
    await inRenderPhase({phase:'runtime_init'},()=>evaluate(input => window.__omEngine.init(input), {...envelope('init'), mode: 'trusted_render', pixelScale: 1,
      manifestHash: plan.manifestHash, frameCount: plan.spec.totalFrames, width: plan.target.width, height: plan.target.height,
      fps: 30, seed: plan.seed, renderProfile: {sampleCount: 1, shutterAngle: 0, sampling: 'centered-box-v1', edgePolicy: 'clamp-v1'}}));
    const webgl=await evaluate(()=>window.__omEngine.webglInfo());
    if(plan.usesWebgl&&!webgl.length)throw Error('WEBGL_CONTEXT_UNAVAILABLE');
    if(plan.usesWebgl&&(!expectedWebglRenderer||webgl.some(value=>value.renderer!==expectedWebglRenderer||!/^WebGL 2/.test(value.version))))throw Error('RENDER_ENVIRONMENT_MISMATCH');
    return {
      plan, sandbox, webgl, timings: {readyMs: Math.round(connectedAt - connectStarted), handshakeMs: Math.round(performance.now() - connectedAt)},
      async frame(frameIndex, {format = 'jpeg',quality = 92} = {}) {
        if(!['png','jpeg'].includes(format)||format==='jpeg'&&![90,92,95].includes(quality))throw Error('CAPTURE_FORMAT_INVALID');
        if (closed || pageError) throw Error(pageError ?? 'INVALID_SESSION');
        signal?.throwIfAborted();
        const input = {...envelope('seek'), frameIndex};
        return deadline((async () => {
          const ready = await inRenderPhase({phase:'frame_seek',frame:frameIndex},()=>evaluate(input => window.__omEngine.seekFrame(input), input));
          for (const key of ['protocolVersion', 'sessionId', 'revisionId', 'aspectId', 'requestId', 'sequence', 'frameIndex'])
            if (ready[key] !== input[key]) throw Error('FRAME_ACK_MISMATCH');
          if (ready.event !== 'frame-ready' || ready.manifestHash !== plan.manifestHash) throw Error('FRAME_ACK_MISMATCH');
          const canvasTrace=hasCanvasText?assertCanvasTextTrace(plan.spec,frameIndex,ready.canvasTextTrace):undefined;
          if (pageError) throw Error(pageError);
          const screenshot = await inRenderPhase({phase:'frame_capture',frame:frameIndex},()=>cdp.send('Page.captureScreenshot', {format, ...(format === 'jpeg' ? {quality} : {}),
            optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false,
            clip: {x: 0, y: 0, width: plan.target.width, height: plan.target.height, scale: captureScale}}));
          currentFrame = frameIndex;currentCanvasTextTrace=canvasTrace;
          return Buffer.from(screenshot.data, 'base64');
        })(), options.frameTimeoutMs, 'FRAME_TIMEOUT', cancel);
      },
      canvasTextTrace(frame){if(closed||currentFrame!==frame||!hasCanvasText||!currentCanvasTextTrace)throw Error('FRAME_NOT_READY');return currentCanvasTextTrace;},
      async observe(renderId, frame) {
        if (closed || currentFrame !== frame) throw Error('FRAME_NOT_READY');
        const observation=await observe(cdp,plan,renderId,frame);
        if(!plan.spec.scenes.some(scene=>isCanvasTextScene(scene)&&scene.start<=frame&&frame<scene.end))return observation;
        const proofs=await evaluate(()=>window.__omEngine.canvasTextProof());
        const {root}=await cdp.send('DOM.getDocument'),fontsByScene=new Map();
        for(const scene of plan.spec.scenes.filter(item=>isCanvasTextScene(item)&&item.start<=frame&&frame<item.end)){
          const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:`[data-scene="${scene.id}"] [data-pb-canvas-font="1"]`});
          const fonts=nodeId?(await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts:[];fontsByScene.set(scene.id,fonts);
        }
        const screenshot=await cdp.send('Page.captureScreenshot',{format:'png',optimizeForSpeed:true,fromSurface:true,captureBeyondViewport:false,
          clip:{x:0,y:0,width:plan.target.width,height:plan.target.height,scale:1}});
        return appendCanvasTextObservations({plan,frame,observation,proofs,traces:currentCanvasTextTrace,fontsByScene,actual:Buffer.from(screenshot.data,'base64')});
      },
      async isolation() { if(closed||currentFrame<0)throw Error('FRAME_NOT_READY');isolationEnabled=true;
        try{return await pageIsolation(page,evaluate);}finally{isolationEnabled=false;}
      },
      async capturePng(frame) {
        if (closed || currentFrame !== frame) throw Error('FRAME_NOT_READY');
        return Buffer.from((await cdp.send('Page.captureScreenshot', {format: 'png', optimizeForSpeed: true, captureBeyondViewport: false, clip: {x: 0, y: 0, width: plan.target.width, height: plan.target.height, scale: captureScale}})).data, 'base64');
      },
      async close() {
        if (closed) return; closed = true;
        try { await deadline(evaluate(input => window.__omEngine.dispose(input), envelope('dispose')), plan.usesWebgl ? 10000 : 1000, 'DISPOSE_TIMEOUT', cancel); }
        finally { signal?.removeEventListener('abort', cancel); await Promise.allSettled([context.close(),browser.close()]);server.closeAllConnections();await new Promise(resolve => server.close(resolve)); }
      }
    };
  } catch (error) {
    signal?.removeEventListener('abort', cancel);
    await context?.close().catch(() => {}); await browser?.close().catch(() => {});server.closeAllConnections();await new Promise(resolve => server.close(resolve));
    throw error;
  }
}
