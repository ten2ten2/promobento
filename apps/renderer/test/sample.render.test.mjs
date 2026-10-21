import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {renderSample} from '../src/render-sample.mjs';
import {prepareBrowserBundle} from '../src/browser-bundle.mjs';
import {environmentLock,inspectEnvironment} from '../src/environment.mjs';
import {captureFrame,launchFixtureBrowser} from '../src/frame-capture.mjs';

test('fontconfig exposes only the private font directory and never writes cwd caches',{timeout:60000},async()=>{
  const bundle=prepareBrowserBundle(environmentLock.browser),cwd=mkdtempSync(join(tmpdir(),'promobento-font-cwd-'));
  let handle;
  try {
    const options={cwd,env:{...process.env,...bundle.fontEnvironment},encoding:'utf8',timeout:15000};
    const cacheOutput=execFileSync('fc-cache',['-f','-v'],options);
    assert(cacheOutput.includes(bundle.fontDirectory));
    assert(!cacheOutput.includes('/usr/share/fonts') && !cacheOutput.includes('/usr/local/share/fonts'));
    assert.equal(execFileSync('fc-list',['--format=%{file}\n'],options).trim(),'');
    assert(readdirSync(bundle.fontCacheDirectory).length>0,'Font caches must be written inside the private bundle');
    assert.deepEqual(readdirSync(cwd),[],'No cache may be written relative to the working directory');
    inspectEnvironment(bundle);
    handle=await launchFixtureBrowser(bundle);
    const page=await handle.browser.newPage();
    assert.equal(await page.evaluate(async()=>{
      try { await new FontFace('host-font-probe','local("DejaVu Sans")').load();return true; }
      catch { return false; }
    }),false,'Chromium must not resolve a host-installed face via local()');
  } finally { await handle?.stop();bundle.cleanup();rmSync(cwd,{recursive:true,force:true}); }
});

test('15-second fixed-target MP4 has deterministic pixels and verified media metadata',{timeout:600000},async()=>{
  const {report}=await renderSample();
  assert.equal(report.frameCount,450);
  assert.equal(new Set(report.pixelHashes).size>100,true,'The fixture must contain actual animation');
});

test('30-second portrait keeps DOM/SVG/Canvas nodes and remains deterministic',{timeout:600000},async()=>{
  const {report}=await renderSample({fixture:'inplace'});
  assert.equal(report.frameCount,900);
  assert.equal(report.width,1080);assert.equal(report.height,1920);
  assert.equal(report.checks.retainedNodes,true);
  assert.equal(report.checks.nativeAnimationsRejected,true);
  assert.equal(report.capture.sourceFrameStorage,'temporary_disk');
  assert(new Set(report.pixelHashes).size>800,'The 30-second fixture must actually redraw');
});

test('a host deadline kills both an unresolved draw and a synchronous renderer loop',{timeout:60000},async()=>{
  const bundle=prepareBrowserBundle(environmentLock.browser);
  let handle;
  try {
    inspectEnvironment(bundle);
    for (const behavior of ['pending','busy']) {
      handle=await launchFixtureBrowser(bundle);
      const page=await handle.browser.newPage();
      await page.evaluate(behavior=>{
        window.fixtureHost={seek:()=>{
          if (behavior==='busy') { while(true) {} }
          return new Promise(()=>{});
        },dispose:()=>new Promise(()=>{})};
      },behavior);
      const process=handle.process;
      await assert.rejects(captureFrame(page,4,{timeoutMs:250,terminate:()=>handle.stop()}),/FRAME_TIMEOUT: 4/);
      assert(process.exitCode!==null || process.signalCode!==null,'Timed-out browser must have exited');
      await handle.stop();
    }
    handle=await launchFixtureBrowser(bundle);
    assert.equal(await (await handle.browser.newPage()).evaluate(()=>2+2),4,'A later job must still be able to run');
  } finally { await handle?.stop();bundle.cleanup(); }
});
