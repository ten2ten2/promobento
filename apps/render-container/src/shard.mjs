import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical} from '@promobento/contracts/canonical';
import {digest, sha256Bytes as sha} from '@promobento/contracts/digest';
import {blockEvents} from '../../../packages/blocks/src/events.mjs';
import {filmSession} from './browser.mjs';
import {shardEncoder} from './media.mjs';
import {memoryPeak} from './memory.mjs';

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
  const session = await filmSession({raw, options, resource, videoFrame, font, browserVersion, signal, killBrowser, captureScale,expectedWebglRenderer});
  const rendered = performance.now();
  const encoder = shardEncoder(join(directory, 'shard.h264'), {width: options.target.width * captureScale, height: options.target.height * captureScale, encoding, threads}, signal);
  const frameDigests = [], seamFrames = [], observations = [];
  // Settled reading holds. Dynamic/transition coverage is the separate S2 temporal QA pass.
  const observeFrames = new Set(session.plan.spec.scenes.flatMap(scene => {
    const settled = scene.start + Math.max(45, ...blockEvents(scene.block.split('@')[0], {start: scene.start, end: scene.end}, scene.params).map(event => event.frame + 6));
    const hold = Math.min(scene.end - 1, settled), middle = Math.floor((scene.start + scene.end) / 2);
    return [hold, ...(middle >= settled ? [middle] : [])].map(frame => Math.floor(frame / stride) * stride);
  }));
  try {
    if (shard.start > 0) {
      const png = await session.frame(shard.start - 1, {format: 'png'});
      writeFileSync(join(directory, 'seam-frames', `${shard.start - 1}-cold.png`), png); seamFrames.push(sha(png));
    }
    for (let frame = shard.start; frame < shard.end; frame += stride) {
      const jpeg = await session.frame(frame);
      await encoder.frame(jpeg, options.frameTimeoutMs);
      frameDigests.push({frame, sha256: sha(jpeg)});
      if (observeFrames.has(frame)) {
        observations.push(await session.observe(job.renderId, frame));
        mkdirSync(join(directory, 'observation-frames'), {recursive: true});
        writeFileSync(join(directory, 'observation-frames', frame + '.png'), await session.capturePng(frame));
      }
    }
    const png = await session.frame(shard.end - 1, {format: 'png'});
    writeFileSync(join(directory, 'seam-frames', `${shard.end - 1}-last.png`), png); seamFrames.push(sha(png));
    const renderMs = Math.round(performance.now() - rendered), draining = performance.now();
    await encoder.finish((shard.end - shard.start) / stride, 30000);
    writeFileSync(join(directory, 'frame-digests.json'), canonical(frameDigests));
    writeFileSync(join(directory, 'observations.json'), canonical(observations));
    const cpuInfo = readFileSync('/proc/cpuinfo', 'utf8'), peak = memoryPeak();
    const receipt = {schemaVersion: '3.0.0', kind: 'shard_receipt', renderId: job.renderId, shardIndex: shard.index,
      start: shard.start, end: shard.end, imageDigest, chromiumVersion: browserVersion,
      cpuModel: cpuInfo.match(/^model name\s*:\s*(.*)$/m)?.[1] ?? 'unknown',
      cpuFlagsHash: digest((cpuInfo.match(/^flags\s*:\s*(.*)$/m)?.[1] ?? '').split(/\s+/).sort()), sandbox: session.sandbox,
      captureFormat: 'jpeg92',...(session.webgl.length?{webgl:session.webgl}:{}),timings: {...session.timings, renderMs, encodeDrainMs: Math.round(performance.now() - draining)},
      peakMemoryMiB: peak.mib, ...(peak.mib===null?{peakMemoryUnavailableReason:peak.unavailableReason}:{}), outputs: {
        shard: sha(readFileSync(join(directory, 'shard.h264'))), frameDigests: sha(readFileSync(join(directory, 'frame-digests.json'))),
        seamFrames, observations: sha(readFileSync(join(directory, 'observations.json')))}};
    writeFileSync(join(directory, 'receipt.json'), canonical(receipt));
    return receipt;
  } catch (error) { encoder.abort(); throw error; }
  finally { await session.close(); }
}
