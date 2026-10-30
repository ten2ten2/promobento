import {digest, sha256Bytes} from '../../contracts/src/digest.mjs';
import {assertAudioPlan, AUDIO_VERSION} from './plan.mjs';
import {SFX, mixdown, loudness} from './sound.mjs';
import {decodeSampleWav} from './samples.mjs';
import {mtof, rng, undb} from './dsp.mjs';
export {deriveAudioPlan, audioPlanHash, AUDIO_VERSION, GENERATED_LICENSE} from './plan.mjs';

/** Explicit approvals come from the trusted store, separate from the model's plan. */
export function synthesizePlan(plan, {seed, labels = {}, clearedSources, bytesBySource = new Map(), scores = new Map()} = {}) {
  assertAudioPlan(plan);
  const n = plan.totalFrames * 1600, L = new Float32Array(n), R = new Float32Array(n);
  for (const source of plan.sources) {
    const approval = clearedSources?.get(source.sourceId);
    if (!approval || approval.licenseRef !== source.licenseRef || approval.rightsCleared !== true) throw Error('AUDIO_RIGHTS_PENDING');
    if (source.sha256) {
      const bytes = bytesBySource.get(source.sourceId);
      if (!bytes || sha256Bytes(bytes) !== source.sha256 || approval.sha256 !== source.sha256) throw Error('AUDIO_SOURCE_IDENTITY_MISMATCH');
    }
  }
  const sources = new Map(plan.sources.map(source => [source.sourceId, source]));
  let music;
  if (plan.music.kind === 'procedural' || plan.music.kind === 'score') {
    let score = null;
    if (plan.music.kind === 'score') {
      const input = scores.get(plan.music.sourceId), approval = clearedSources.get(plan.music.sourceId);
      if (!input || approval.requestHash !== digest({text: input, totalFrames: plan.totalFrames})) throw Error('SCORE_APPROVAL_REQUIRED');
      // New admitted scores carry the actual approved UTF-8 source, not an unrelated bytes/text pair.
      // Existing standalone plans without a byte identity retain their request-hash approval contract.
      const source=sources.get(plan.music.sourceId);
      if(source.sha256&&new TextDecoder('utf-8',{fatal:true}).decode(bytesBySource.get(source.sourceId))!==input)throw Error('SCORE_SOURCE_MISMATCH');
      score = input;
    }
    music = mixdown({duration: plan.totalFrames / 30, id: seed, labels, hits: [],
      music: {style: plan.music.style ?? 'mallet', seed, ...(plan.music.bpm ? {bpm: plan.music.bpm} : {})}}, {score}).out2;
  }
  for (const event of plan.events) {
    const source = sources.get(event.sourceId);
    let pcm;
    if (event.kind === 'music' && music && event.sourceId === plan.music.sourceId) pcm = music;
    else if (source.origin === 'procedural' && event.kind === 'sfx' && event.sourceId.startsWith('sfx_')) {
      const sound = SFX[event.sourceId.slice(4)]; if (!sound) throw Error('SFX_UNKNOWN');
      const {sig, lead} = sound.fn({dur:event.sfxTiming?event.sfxTiming.synthesisSamples/48000:event.sourceSample!==undefined?Math.min(n-event.sourceSample,96000)/48000:(event.frameEndExclusive-event.frameStart)/30},rng(seed+':'+event.eventId),
        (degree, octave) => mtof(12 * (octave + 1) + [0, 2, 4, 5, 7, 9, 11][((degree - 1) % 7 + 7) % 7]));
      if(Math.round(lead*48000)!==(event.sfxTiming?.leadSamples??0))throw Error('SFX_TIMING_MISMATCH');
      pcm = Array.isArray(sig) ? {L: sig[0], R: sig[1]} : {L: sig, R: sig};
      if(event.sfxTiming&&(pcm.L.length!==event.sfxTiming.durationSamples||pcm.R.length!==event.sfxTiming.durationSamples))throw Error('SFX_TIMING_MISMATCH');
    } else if (['customer_upload', 'cc0_sample'].includes(source.origin)) {
      const bytes = bytesBySource.get(event.sourceId); if (!bytes || !source.sha256) throw Error('AUDIO_SOURCE_MISSING');
      pcm = decodeSampleWav(bytes);
    } else throw Error('AUDIO_SOURCE_UNSUPPORTED');
    const placement=event.sfxTiming?(event.sourceSample??event.sfxTiming.anchorFrame*1600)-event.sfxTiming.leadSamples:(event.sourceSample??event.frameStart*1600);
    const start=event.sfxTiming?Math.max(0,placement):placement,offset=event.sfxTiming?Math.max(0,-placement):(event.sourceOffsetFrames??0)*1600;
    const length=event.sfxTiming?Math.min(n-start,event.sfxTiming.durationSamples-offset):event.sourceSample!==undefined?Math.min(n-start,96000):(event.frameEndExclusive-event.frameStart)*1600;
    // Short synthesized hits naturally decay; uploaded sources must cover the declared interval.
    if (source.origin !== 'procedural' && offset + length > pcm.L.length) throw Error('AUDIO_SOURCE_OUT_OF_RANGE');
    const pan = (event.pan ?? 0) * Math.PI / 4, left = Math.cos(Math.PI / 4 + pan) * Math.SQRT2, right = Math.sin(Math.PI / 4 + pan) * Math.SQRT2;
    for (let i = 0; i < length && offset + i < pcm.L.length; i++) {
      const fade = Math.min(1, event.fadeInFrames ? i / (event.fadeInFrames * 1600) : 1,
        event.fadeOutFrames ? (length - 1 - i) / (event.fadeOutFrames * 1600) : 1);
      let duck = 1;
      if (event.kind === 'music') for (const voice of plan.events.filter(item => item.kind === 'voice')) {
        const position = start + i, a = voice.frameStart * 1600, b = voice.frameEndExclusive * 1600;
        const envelope = Math.max(0, Math.min(1, (position - a + 4800) / 4800, (b + 9600 - position) / 9600));
        duck = Math.min(duck, undb((voice.duckDb ?? -12) * envelope));
      }
      const gain = undb(event.gainDb) * Math.max(0, fade) * duck;
      L[start + i] += pcm.L[offset + i] * gain * left; R[start + i] += pcm.R[offset + i] * gain * right;
    }
  }
  const wav = Buffer.alloc(44 + n * 4);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(192000, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const scale = peak > .95 ? .95 / peak : 1;
  for (let i = 0; i < n; i++) {
    wav.writeInt16LE(Math.round(L[i] * scale * 32767), 44 + i * 4); wav.writeInt16LE(Math.round(R[i] * scale * 32767), 46 + i * 4);
  }
  return {wav, algorithm: AUDIO_VERSION, sampleFrames: n, silent: peak === 0,
    preMasterLufs: peak ? loudness(L, R) + 20 * Math.log10(scale) : null};
}
