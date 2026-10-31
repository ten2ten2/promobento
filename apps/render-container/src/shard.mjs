import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical} from '@promobento/contracts/canonical';
import {digest, sha256Bytes as sha} from '@promobento/contracts/digest';
import {filmObservationFrames,filmMotionFrames} from '../../../packages/blocks/src/events.mjs';
import {filmSession} from './browser.mjs';
import {shardEncoder} from './media.mjs';
import {memoryPeak} from './memory.mjs';
import {reviewPng} from './review-pixels.mjs';
import {inRenderPhase} from './failure.mjs';

export async function renderShard({job, shard, options, raw, resource, videoFrame, font, directory, browserVersion, imageDigest,
  encoding, threads, signal, killBrowser,expectedWebglRenderer}) {
  if (job.renderProfile.sampleCount !== 1 || job.renderProfile.shutterAngle !== 0)
    throw Error('RENDER_PROFILE_NOT_IMPLEMENTED');
  if (!Number.isInteger(shard.start) || !Number.isInteger(shard.end) || shard.start < 0 || shard.end > job.totalFrames
    || shard.end <= shard.start || shard.start % 15 || shard.end % 15 || options.target.totalFrames !== job.totalFrames
    || options.target.aspect !== job.aspectId || !/^sha256:[0-9a-f]{64}$/.test(imageDigest)) throw Error('SHARD_SCOPE_INVALID');
  const stride = job.quality === 'review' ? 2 : 1, captureScale = 1 / stride;
  if (shard.start % stride || shard.end % stride) throw Error('SHARD_SCOPE_INVALID');
  mkdirSync(join(directory, 'seam-frames'), {recursive: true});
  // Capture the logical full-size source for both qualities. Review JPEGs are reduced by
  // the existing FFmpeg scale filter; QA PNGs use deterministic CPU pixel reduction.
  const session = await inRenderPhase({phase:'browser_session'},()=>filmSession({raw, options, resource, videoFrame, font, browserVersion, signal, killBrowser,expectedWebglRenderer}));
  const outputPng=bytes=>stride===2?reviewPng(bytes):bytes;
  const rendered = performance.now();
  const encoder = shardEncoder(join(directory, 'shard.h264'), {width: options.target.width * captureScale, height: options.target.height * captureScale, encoding, threads}, signal);
  const frameDigests = [], frameCaptureMs = [], seamFrames = [], observations = [];
  const hasCanvasText=session.plan.spec.scenes.some(scene=>scene.kind==='block'&&scene.block==='canvas-title@1');
  // Settled reading holds. Dynamic/transition coverage is the separate S2 temporal QA pass.
  const observeFrames = new Set(filmObservationFrames(session.plan.spec,job.quality));
  const motionFrames = new Set(filmMotionFrames(session.plan.spec,job.quality));
  try {
    if (shard.start > 0) {
      const png = await inRenderPhase({phase:'cold_seam',frame:shard.start-1},async()=>outputPng(await session.frame(shard.start - 1, {format: 'png'})));
      writeFileSync(join(directory, 'seam-frames', `${shard.start - 1}-cold.png`), png); seamFrames.push(sha(png));
    }
    for (let frame = shard.start; frame < shard.end; frame += stride) {
      const captureStarted = performance.now();
      const jpeg = await session.frame(frame);
      frameCaptureMs.push(Math.round((performance.now() - captureStarted) * 1000) / 1000);
      await inRenderPhase({phase:'encoder_write',frame},()=>encoder.frame(jpeg, options.frameTimeoutMs));
      frameDigests.push({frame, sha256: sha(jpeg),...(hasCanvasText?{canvasText:session.canvasTextTrace(frame)}:{})});
      if (observeFrames.has(frame)) {
        observations.push(await inRenderPhase({phase:'frame_observation',frame},()=>session.observe(job.renderId, frame)));
        mkdirSync(join(directory, 'observation-frames'), {recursive: true});
        const png=await inRenderPhase({phase:'observation_capture',frame},async()=>outputPng(await session.capturePng(frame)));
        writeFileSync(join(directory, 'observation-frames', frame + '.png'), png);
      }
      if (motionFrames.has(frame)) {
        mkdirSync(join(directory, 'motion-frames'), {recursive: true});
        const png=await inRenderPhase({phase:'observation_capture',frame},async()=>outputPng(await session.capturePng(frame)));
        writeFileSync(join(directory, 'motion-frames', frame + '.png'), png);
      }
    }
    const png = await inRenderPhase({phase:'last_seam',frame:shard.end-1},async()=>outputPng(await session.frame(shard.end - 1, {format: 'png'})));
    writeFileSync(join(directory, 'seam-frames', `${shard.end - 1}-last.png`), png); seamFrames.push(sha(png));
    const renderMs = Math.round(performance.now() - rendered), draining = performance.now();
    await inRenderPhase({phase:'encoder_drain'},()=>encoder.finish((shard.end - shard.start) / stride, 30000));
    writeFileSync(join(directory, 'frame-digests.json'), canonical(frameDigests));
    writeFileSync(join(directory, 'observations.json'), canonical(observations));
    const cpuInfo = readFileSync('/proc/cpuinfo', 'utf8'), peak = memoryPeak();
    const receipt = {schemaVersion: '3.0.0', kind: 'shard_receipt', renderId: job.renderId, shardIndex: shard.index,
      start: shard.start, end: shard.end, imageDigest, chromiumVersion: browserVersion,
      cpuModel: cpuInfo.match(/^model name\s*:\s*(.*)$/m)?.[1] ?? 'unknown',
      cpuFlagsHash: digest((cpuInfo.match(/^flags\s*:\s*(.*)$/m)?.[1] ?? '').split(/\s+/).sort()), sandbox: session.sandbox,
      captureFormat: 'jpeg92',...(session.webgl.length?{webgl:session.webgl}:{}),timings: {...session.timings, renderMs, encodeDrainMs: Math.round(performance.now() - draining), frameCaptureMs},
      peakMemoryMiB: peak.mib, ...(peak.mib===null?{peakMemoryUnavailableReason:peak.unavailableReason}:{}), outputs: {
        shard: sha(readFileSync(join(directory, 'shard.h264'))), frameDigests: sha(readFileSync(join(directory, 'frame-digests.json'))),
        seamFrames, observations: sha(readFileSync(join(directory, 'observations.json')))}};
    writeFileSync(join(directory, 'receipt.json'), canonical(receipt));
    return receipt;
  } catch (error) { encoder.abort(); throw error; }
  finally { await session.close(); }
}
