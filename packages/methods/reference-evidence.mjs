import {parseVideoFrameManifest, openVideoFramePack} from '@promobento/contracts/video-frames';

/** Only sampled, SHA-verified frames are presented as visual observations. Audio is not decoded here. */
export async function referenceFrameEvidence({resourceId, manifestBytes, manifestSha256, source, framePacks, readPack, maxSamples = 12}) {
  const manifest = parseVideoFrameManifest(manifestBytes, manifestSha256);
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2 || maxSamples > 24
    || !source || manifest.source.sha256 !== source.sha256 || manifest.source.byteLength !== source.byteLength
    || manifest.source.mediaType !== source.mediaType || !Array.isArray(framePacks)
    || framePacks.length !== manifest.packs.length || manifest.frames.length < 2) throw Error('REFERENCE_SOURCE_IDENTITY_INVALID');
  const count = Math.min(maxSamples, manifest.frames.length);
  const sampledFrames = [...new Set(Array.from({length: count}, (_, i) => Math.round(i * (manifest.frames.length - 1) / (count - 1))))];
  const needed = [...new Set(sampledFrames.map(index => manifest.frames[index].pack))];
  const frames = [];
  let totalBytes = 0;
  for (const index of needed) {
    const expected = manifest.packs[index], blob = framePacks[index];
    if (!blob || blob.sha256 !== expected.sha256 || blob.byteLength !== expected.byteLength
      || typeof blob.key !== 'string' || !blob.key) throw Error('REFERENCE_PACK_IDENTITY_INVALID');
    const pack = openVideoFramePack(manifest, index, await readPack(blob));
    for (const frameIndex of sampledFrames.filter(frame => manifest.frames[frame].pack === index)) {
      const bytes = pack.frame(frameIndex);
      totalBytes += bytes.length;
      if (totalBytes > 16 << 20 || bytes.length < 16 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF'
        || String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') throw Error('REFERENCE_FRAME_FORMAT_INVALID');
      frames.push({index: frameIndex, timeSeconds: frameIndex / 30, bytes, mediaType: 'image/webp'});
    }
  }
  frames.sort((a, b) => a.index - b.index);
  return {resourceId, sourceSha256: source.sha256, sourceFrameCount: manifest.frames.length, sampledFrames, frames, audioStatus: 'not_analyzed'};
}
