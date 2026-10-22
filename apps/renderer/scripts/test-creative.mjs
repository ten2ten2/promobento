import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {canonical} from '@promobento/contracts';
import {renderAdmission} from '../src/admission-run.mjs';
import {repository} from '../src/admission-image.mjs';
import {visualCandidate,fontGalleryCandidate,writeCandidate} from '../test/admission-visual.cases.mjs';
import {creativeAudioFixture} from '../test/creative-audio/fixture.mjs';

const out=join(repository,'artifacts/creative',String(Date.now())),temporary=mkdtempSync(join(tmpdir(),'promobento-creative-'));
mkdirSync(out,{recursive:true});
const controller=new AbortController(),cancel=()=>controller.abort();
process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
try {
  const candidate=visualCandidate(),audio=creativeAudioFixture(450),sourceDirectory=join(temporary,'source');
  candidate.resources={...candidate.resources,resourceIds:[...candidate.resources.resourceIds,...audio.resourceIds],
    generatedAudio:audio.generatedAudio,audioEvents:audio.audioEvents};
  writeCandidate(sourceDirectory,candidate);
  const options={sourceDirectory,audioRights:audio.audioRights,signal:controller.signal};
  const serial=await renderAdmission({...options,captureWorkers:1,outputDirectory:join(out,'serial')});
  const parallel=await renderAdmission({...options,captureWorkers:2,outputDirectory:join(out,'parallel')});
  assert.deepEqual(parallel.report.commandHashes,serial.report.commandHashes);
  assert.deepEqual(parallel.report.capture.pixelHashes,serial.report.capture.pixelHashes,'Every parallel frame must equal the single-context capture');
  assert.equal(parallel.report.capture.media.frozenAudio.sha256,serial.report.capture.media.frozenAudio.sha256);
  assert.notEqual(parallel.report.qaInputHash,serial.report.qaInputHash,'Capture policy is part of the evidence identity');
  assert.equal(parallel.report.capture.capture.workers,2);
  for(const result of [serial,parallel]) {
    assert.equal(result.report.commandChecks.coldReverseFrames,450);
    assert.equal(result.report.capture.editorialQa.frameCount,450);
    assert.equal(result.report.capture.media.observations.length,450);
    assert(result.report.capture.media.encodedAudio.mixedAudioComparison.correlation>=.97);
    assert(result.report.capture.media.observations.some(frame=>frame.texts.some(text=>text.text==='从想法到画面')));
    for(const marker of candidate.declarations.markers)assert(result.report.capture.keyframes.some(frame=>frame.frameIndex===marker.frame));
  }
  const gallerySource=join(temporary,'fonts');writeCandidate(gallerySource,fontGalleryCandidate());
  const gallery=await renderAdmission({sourceDirectory:gallerySource,outputDirectory:join(out,'fonts'),signal:controller.signal});
  const faces=gallery.report.capture.media.observations[0].texts;
  assert.equal(faces.length,42,'Every imported font file must be loaded and painted in the actual browser');
  assert.equal(gallery.report.commandChecks.coldReverseFrames,450);
  const report={kind:'creative_toolkit_verification',status:'passed',image:serial.report.image,
    checks:{grammars:7,cjk:true,licensedSampledAudio:true,deterministicFrozenAudio:true,
      parallelPixelFrames:450,parallelWorkers:2,importedFontFilesPainted:faces.length,editorialMotionQa:true},
    serial:{qaInputHash:serial.report.qaInputHash,timings:serial.report.timings,capture:serial.report.capture.timings},
    parallel:{qaInputHash:parallel.report.qaInputHash,timings:parallel.report.timings,capture:parallel.report.capture.timings},
    fonts:{qaInputHash:gallery.report.qaInputHash},
    limitations:['engineering fixtures, not paid model comparison or human audiovisual acceptance']};
  writeFileSync(join(out,'verification.json'),canonical(report)+'\n');
  console.log(canonical({status:'passed',out,checks:report.checks,timings:{serial:report.serial.capture,parallel:report.parallel.capture}}));
} finally {
  process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
  rmSync(temporary,{recursive:true,force:true});
}
