import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareFixtureMedia,fontDeclarations,videoUses} from '../src/media-assets.mjs';
import {prepareBrowserBundle} from '../src/browser-bundle.mjs';
import {environmentLock,inspectEnvironment} from '../src/environment.mjs';
import {launchFixtureBrowser} from '../src/frame-capture.mjs';

test('real VFR frames, licensed font fallback and bounded decode cache are ready before drawing',{timeout:120000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-media-')),bundle=prepareBrowserBundle(environmentLock.browser);
  let handle,server;
  try {
    inspectEnvironment(bundle);
    const media=prepareFixtureMedia({outputDirectory:directory}),second=prepareFixtureMedia({outputDirectory:join(directory,'repeated')});
    assert.equal(media.report.manifestHash,second.report.manifestHash,'The frozen source, PTS table and decoded bytes reproduce exactly');
    assert.equal(media.manifest.videos[0].frames.length,61);
    const routes=new Map(media.routes),module=readFileSync(new URL('../../../packages/composition-runtime/src/media.mjs',import.meta.url));
    server=createServer((request,response)=>{
      let entry=routes.get(request.url);
      if(request.url==='/'||request.url==='/native-video-disabled') entry={bytes:'<!doctype html><script type="module">import {createMediaController} from "/media.mjs";window.createMediaController=createMediaController;</script>',contentType:'text/html'};
      if(request.url==='/media.mjs') entry={bytes:module,contentType:'text/javascript'};
      if(!entry) {response.writeHead(404);response.end();return;}
      response.writeHead(200,{'Content-Type':entry.contentType,'Cache-Control':'no-store',
        'Content-Security-Policy':"default-src 'none'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self'; media-src "+(request.url==='/native-video-disabled'?"'none'":'blob:')+"; style-src 'unsafe-inline'"});
      response.end(entry.bytes);
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const origin='http://127.0.0.1:'+server.address().port;
    handle=await launchFixtureBrowser(bundle);
    const page=await handle.browser.newPage();
    await page.goto(origin);await page.waitForFunction(()=>window.createMediaController);
    const parameters={definition:{fonts:fontDeclarations,videoUses},manifest:media.manifest};
    await page.evaluate(async parameters=>{window.media=await window.createMediaController(parameters);},parameters);
    const admitted=await page.evaluate(()=>({
      paths:window.media.drawableResourcePaths,
      frozen:Object.isFrozen(window.media.resources)&&Object.isFrozen(window.media.drawableResourcePaths)
        &&Object.values(window.media.resources).every(Object.isFrozen),
      resources:window.media.resources,assets:window.media.assets
    }));
    assert.deepEqual(admitted.paths,['media/screen-demo.mp4']);assert.equal(admitted.frozen,true);
    assert.equal(admitted.resources['fonts/geist-sans-latin-600-normal.woff'].mediaType,'font/woff');
    assert.equal(admitted.resources['media/screen-demo.mp4'].mediaType,'video/mp4');
    assert.equal(Object.hasOwn(admitted.assets['media/screen-demo.mp4'],'mediaType'),false,
      'Only the trusted controller exposes admission metadata; the public runtime asset remains path/hash/url');
    assert.equal(await page.evaluate(()=>window.media.fonts.assertText('geist-sans-fixture','Café\n◼ ready')),true);
    await assert.rejects(page.evaluate(()=>window.media.fonts.assertText('geist-sans-fixture','中文')),/FONT_GLYPH_MISSING/);
    const capture=async numerator=>page.evaluate(async numerator=>{
      const frame=await window.media.videoFrames.get('screen-demo',{numerator,denominator:30});
      const canvas=document.createElement('canvas');canvas.width=frame.image.width;canvas.height=frame.image.height;
      const context=canvas.getContext('2d');context.drawImage(frame.image,0,0);
      const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      return {hash,pts:frame.sourcePts,sourceSha256:frame.sourceSha256,representation:frame.representation};
    },numerator);
    const first=await capture(0),beforeBoundary=await capture(9),boundary=await capture(10);
    assert.deepEqual(first,beforeBoundary);assert.notEqual(first.hash,boundary.hash);
    assert.equal(first.sourceSha256,media.report.sourceSha256);assert.equal(first.representation,'source_frame');
    assert.equal(first.hash,media.manifest.videos[0].frames[0].pixelSha256);
    for(let numerator=0;numerator<900;numerator+=30) await capture(numerator);
    assert.deepEqual(await capture(0),first,'Evicted frames re-decode to the same pixels');
    const report=await page.evaluate(()=>window.media.report());
    assert(report.fonts.every(face=>face.status==='loaded'));assert.equal(report.fonts.length,2);
    assert(report.cache.peakDecodedFrames<=8);assert(report.cache.peakDecodedBytes<=media.manifest.limits.maxDecodedBytes);
    assert(report.cache.fetches>8);assert(report.cache.cacheHits>0);
    assert.equal(typeof report.decodeProbes[0].decoded,'boolean');assert.equal(report.decodeProbes[0].method,'html-video-loadeddata');
    assert.equal(report.decodeProbes[0].selectedPath,'trusted-ffmpeg-png');
    console.log('M0a actual browser decoder probe: '+JSON.stringify(report.decodeProbes));
    await assert.rejects(page.evaluate(()=>window.media.videoFrames.get('screen-demo',{numerator:900,denominator:30})),/VIDEO_TIME_OUT_OF_RANGE/);
    await assert.rejects(page.evaluate(()=>window.media.videoFrames.get('undeclared',{numerator:0,denominator:30})),/VIDEO_USE_UNDECLARED/);
    // Fetches must fail before drawing when a cold frame is missing or changed.
    const missing=media.manifest.videos[0].frames[57],original=routes.get(missing.url);routes.delete(missing.url);
    await assert.rejects(capture(850),/MEDIA_RESOURCE_UNAVAILABLE/);
    const changed=Buffer.from(original.bytes);changed[changed.length-1]^=1;routes.set(missing.url,{...original,bytes:changed});
    await assert.rejects(capture(850),/MEDIA_RESOURCE_HASH_MISMATCH/);routes.set(missing.url,original);
    assert.equal((await capture(850)).hash,missing.pixelSha256);
    await page.evaluate(()=>window.media.dispose());
    await assert.rejects(capture(0),/MEDIA_DISPOSED/);
    assert.equal(await page.evaluate(()=>document.fonts.size),0);
    // A missing fallback blocks initialization and removes any already-loaded primary.
    const fallback=media.manifest.resources.find(item=>item.path.includes('geist-mono')),fallbackBytes=routes.get(fallback.url);routes.delete(fallback.url);
    await assert.rejects(page.evaluate(parameters=>window.createMediaController(parameters),parameters),/MEDIA_RESOURCE_UNAVAILABLE/);
    assert.equal(await page.evaluate(()=>document.fonts.size),0);routes.set(fallback.url,fallbackBytes);
    // A real browser with native media blocked still draws verified extracted
    // frames. This is a policy fault injection, not a claim about another codec.
    const fallbackPage=await handle.browser.newPage();await fallbackPage.goto(origin+'/native-video-disabled');
    await fallbackPage.waitForFunction(()=>window.createMediaController);
    const fallbackReport=await fallbackPage.evaluate(async parameters=>{
      const media=await window.createMediaController(parameters);
      const frame=await media.videoFrames.get('screen-demo',{numerator:10,denominator:30});
      const result={report:media.report(),width:frame.image.width,pts:frame.sourcePts};media.dispose();return result;
    },parameters);
    assert.equal(fallbackReport.report.decodeProbes[0].decoded,false);
    assert.equal(fallbackReport.report.decodeProbes[0].selectedPath,'trusted-ffmpeg-png');
    assert.equal(fallbackReport.width,320);assert.deepEqual(fallbackReport.pts,media.manifest.videos[0].frames[1].pts);
    await fallbackPage.close();
    await handle.stop();handle=await launchFixtureBrowser(bundle);
    const cold=await handle.browser.newPage();await cold.goto(origin);await cold.waitForFunction(()=>window.createMediaController);
    const coldHash=await cold.evaluate(async parameters=>{
      const media=await window.createMediaController(parameters),frame=await media.videoFrames.get('screen-demo',{numerator:0,denominator:30});
      const canvas=document.createElement('canvas');canvas.width=frame.image.width;canvas.height=frame.image.height;
      const context=canvas.getContext('2d');context.drawImage(frame.image,0,0);
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',context.getImageData(0,0,canvas.width,canvas.height).data))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      media.dispose();return hash;
    },parameters);
    assert.equal(coldHash,first.hash);
  } finally {
    await handle?.stop();if(server?.listening) {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    bundle.cleanup();rmSync(directory,{recursive:true,force:true});
  }
});
