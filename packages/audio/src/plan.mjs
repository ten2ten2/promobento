import {validate} from '../../contracts/generated/audio-plan.mjs';
import {digest} from '../../contracts/src/digest.mjs';
import {SFX_IDS, AUDIO_STYLES} from './catalog.mjs';

export const AUDIO_VERSION = 'film-audio-v1';
export const GENERATED_LICENSE = 'LicenseRef-PromoBento-Generated-Audio';
const autoSound = {'title-land': 'thud', 'product-land': 'tick', 'cta-land': 'chime', 'module-land': 'tick', 'feature-land': 'pop'};

export function assertAudioPlan(plan) {
  if (!validate(plan)) throw Error('AUDIO_PLAN_INVALID');
  const sources = new Map(plan.sources.map(source => [source.sourceId, source]));
  const ids = new Set();
  for (const event of plan.events) {
    if (ids.has(event.eventId) || !sources.has(event.sourceId) || event.frameEndExclusive <= event.frameStart
      || event.frameEndExclusive > plan.totalFrames || (event.fadeInFrames ?? 0) + (event.fadeOutFrames ?? 0) > event.frameEndExclusive - event.frameStart)
      throw Error('AUDIO_EVENT_INVALID');
    ids.add(event.eventId);
  }
  if (sources.size !== plan.sources.length || (plan.music.kind !== 'none' && !sources.has(plan.music.sourceId))) throw Error('AUDIO_SOURCE_INVALID');
  if (plan.music.kind === 'procedural' && !AUDIO_STYLES.includes(plan.music.style)) throw Error('AUDIO_STYLE_UNKNOWN');
  if (plan.mute && (plan.events.length || plan.music.kind !== 'none')) throw Error('MUTED_AUDIO_NOT_EMPTY');
}

/** Block events are read from the trusted built scene, in local frames. Event ids survive array reordering. */
export function deriveAudioPlan(spec, blockEvents, {loudnessTarget = -14} = {}) {
  const plan = {schemaVersion: '3.0.0', kind: 'audio_plan', totalFrames: spec.totalFrames, sampleRate: 48000, channels: 2,
    loudnessTarget, truePeakMax: -1, mute: Boolean(spec.audio.mute), music: {kind: 'none'}, events: [], sources: []};
  if (spec.audio.mute) return plan;
  if (spec.audio.voice) throw Error('AUDIO_VOICE_PLAN_REQUIRED');
  if (!['procedural', 'none'].includes(spec.audio.music.kind)) throw Error('AUDIO_EXTERNAL_PLAN_REQUIRED');
  if (spec.audio.music.kind === 'procedural') {
    plan.music = {...spec.audio.music, sourceId: 'music'};
    plan.sources.push({sourceId: 'music', origin: 'procedural', licenseRef: GENERATED_LICENSE});
    plan.events.push({eventId: 'music:bed', kind: 'music', sourceId: 'music', frameStart: 0, frameEndExclusive: spec.totalFrames,
      gainDb: 0, fadeInFrames: 1, fadeOutFrames: 15});
  }
  const declared = new Map(blockEvents.map(event => [`${event.sceneId}:${event.name}`, event]));
  const requests = spec.audio.sfx === 'auto' ? blockEvents.filter(event => autoSound[event.name]).map(event => ({
    id: autoSound[event.name], at: {sceneId: event.sceneId, event: event.name}
  })) : spec.audio.sfx;
  const seen = new Set();
  for (const request of requests) {
    if (!SFX_IDS.includes(request.id)) throw Error('SFX_UNKNOWN');
    const reference = 'frame' in request.at ? 'frame:' + request.at.frame : request.at.sceneId + ':' + request.at.event;
    const eventId = request.id + ':' + reference;
    if (seen.has(eventId)) throw Error('AUDIO_EVENT_DUPLICATE'); seen.add(eventId);
    const event = 'frame' in request.at ? null : declared.get(reference);
    const scene = event && spec.scenes.find(scene => scene.id === event.sceneId);
    const frame = 'frame' in request.at ? request.at.frame : scene && scene.start + event.frame;
    if (!Number.isInteger(frame) || frame < 0 || frame >= spec.totalFrames) throw Error('AUDIO_EVENT_REFERENCE_INVALID');
    const sourceId = 'sfx_' + request.id;
    if (!plan.sources.some(source => source.sourceId === sourceId)) plan.sources.push({sourceId, origin: 'procedural', licenseRef: GENERATED_LICENSE});
    plan.events.push({eventId, kind: 'sfx', sourceId, frameStart: frame, frameEndExclusive: Math.min(spec.totalFrames, frame + 60),
      gainDb: request.gain === undefined ? -6 : 20 * Math.log10(Math.max(1e-3, request.gain)), fadeOutFrames: 3});
  }
  assertAudioPlan(plan);
  return plan;
}

export const audioPlanHash = (plan, {seed} = {}) => {
  assertAudioPlan(plan); if (typeof seed !== 'string' || !seed.length) throw Error('AUDIO_SEED_REQUIRED');
  return digest({algorithm: AUDIO_VERSION, seed, plan});
};
