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

function assertTimings(report) {
  const {totalMs,...phases}=report.timings;
  assert(Object.values(phases).every(value=>Number.isSafeInteger(value)&&value>=0));
  assert(report.timings.prepareMs>0 && report.timings.captureEncodeMs>0 && report.timings.determinismChecksMs>0);
  assert(report.timings.outputChecksMs>0 && report.timings.cleanupMs>0);
  assert(Math.abs(Object.values(phases).reduce((sum,value)=>sum+value,0)-totalMs)<=Object.keys(phases).length,
    'Phases are non-overlapping wall time; capture and encoding share one phase');
  assert.equal(report.capture.encodingOverlapsCapture,true);
  assert.equal(Object.hasOwn(report.capture,'elapsedMs'),false);
}

test('15-second output and full regression use identical capture/encoding and real output checks',{timeout:600000},async()=>{
  const {report}=await renderSample();
  assert.equal(report.frameCount,450);
  assert.equal(new Set(report.pixelHashes).size>100,true,'The fixture must contain actual animation');
  assert.equal(report.mode,'regression');
  assert.equal(report.checks.reverseFrames,450);
  assertTimings(report);
  const {report:output}=await renderSample({fixture:'square',mode:'output'});
  assert.equal(output.mode,'output');
  assert.deepEqual(output.pixelHashes,report.pixelHashes,'Output mode cannot change what is captured');
  assert.equal(output.checks.forwardFrames,450);
  assert.equal(output.checks.reverseFrames,0);
  assert.equal(output.checks.invalidFrames,0);
  assert.equal(output.checks.nativeAnimationsRejected,null,'An omitted error-path probe cannot claim a pass');
  assert.equal(output.timings.regressionChecksMs,0);
  assert.equal(output.checks.colorSwatches.length,4);
  assert.equal(output.verification.version,report.verification.version);
  assert(output.checks.repeatedFrames>0 && output.checks.unorderedFrames>0 && output.checks.coldFrames>0);
  assertTimings(output);
});

test('30-second portrait keeps DOM/SVG/Canvas nodes and remains deterministic',{timeout:600000},async()=>{
  const {report}=await renderSample({fixture:'inplace'});
  assert.equal(report.frameCount,900);
  assert.equal(report.width,1080);assert.equal(report.height,1920);
  assert.equal(report.checks.retainedNodes,true);
  assert.equal(report.checks.nativeAnimationsRejected,true);
  assert.equal(report.capture.sourceFrameStorage,'temporary_disk');
  assert(new Set(report.pixelHashes).size>800,'The 30-second fixture must actually redraw');
  assertTimings(report);
});

test('30-second media fixture freezes actual fonts, VFR frames, soundtrack and edited values',{timeout:900000},async()=>{
  const {report}=await renderSample({fixture:'media'});
  assert.equal(report.frameCount,900);assert.equal(report.checks.reverseFrames,900);
  assert.equal(report.media.status,'passed');assert.equal(report.media.fixtureInputHash,report.fixtureInputHash);
  assert.equal(report.media.resources.sourceFrameCount,61);assert.equal(report.media.resources.variableFrameRate,true);
  const {cache,fonts}=report.media.browser;
  assert(cache.peakDecodedFrames<=cache.maxDecodedFrames && cache.peakDecodedBytes<=cache.maxDecodedBytes);
  assert(cache.cacheHits>0 && cache.fetches>61,'Reverse/cold selection must really exercise the bounded cache');
  assert(fonts.length===2 && fonts.every(font=>font.status==='loaded'));
  const {audio,editing,clip,screenshot,layout}=report.media;
  assert.equal(audio.preparation.sampleFrames,1440000);
  assert.equal(audio.previewDecode.sha256,audio.encoded.mixedAudioHash);
  assert(audio.encoded.cueChecks.every(check=>Math.abs(check.differenceFrames)<=1));
  assert.equal(editing.status,'passed');assert.equal(editing.trustedHashes.length,3);
  assert(editing.missingGlyphRejected && editing.textOverflowDetected && editing.staleEpochRejected);
  assert.equal(layout.checkedFrames,31);assert.equal(screenshot.sourceFrame,300);
  assert.equal(clip.frameStart,270);assert.equal(clip.frameEndExclusive,330);assert.equal(clip.sourcePixelHashes.length,60);
  assert.equal(clip.audio.interval.effectiveSampleFrames,96000);
  assertTimings(report);
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
