import {validate} from '../../contracts/generated/audio-plan.mjs';
import {digest} from '../../contracts/src/digest.mjs';
import {SFX_IDS,AUDIO_STYLES,SFX_LEAD_TIMING} from './catalog.mjs';

export const AUDIO_VERSION = 'film-audio-v1';
export const GENERATED_LICENSE = 'LicenseRef-PromoBento-Generated-Audio';
const autoSound = {'title-land': 'thud', 'product-land': 'tick', 'step-land':'tick', 'cta-land': 'chime', 'module-land': 'tick', 'feature-land': 'pop',
 'component-land':'pop',
 'feature-step-1':'pop','feature-step-2':'pop','feature-step-3':'pop',
 'product-step-1':'tick','product-step-2':'tick','product-step-3':'tick'};

export function assertAudioPlan(plan) {
  if (!validate(plan)) throw Error('AUDIO_PLAN_INVALID');
  const sources = new Map(plan.sources.map(source => [source.sourceId, source]));
  const ids = new Set();
  for (const event of plan.events) {
    if (ids.has(event.eventId) || !sources.has(event.sourceId) || event.frameEndExclusive <= event.frameStart
      || event.frameEndExclusive > plan.totalFrames || (event.fadeInFrames ?? 0) + (event.fadeOutFrames ?? 0) > event.frameEndExclusive - event.frameStart)
      throw Error('AUDIO_EVENT_INVALID');
    ids.add(event.eventId);
    if(event.sourceSample!==undefined&&(event.kind!=='sfx'||sources.get(event.sourceId).origin!=='procedural'||!event.sourceId.startsWith('sfx_')||event.sourceSample>=plan.totalFrames*1600||event.sourceSample%1600===0||event.sourceOffsetFrames!==undefined))throw Error('SFX_TIMING_INVALID');
    if(event.sfxTiming){
      const timing=event.sfxTiming,declared=SFX_LEAD_TIMING[event.sourceId.slice(4)],source=sources.get(event.sourceId);
      const anchor=event.sourceSample??timing.anchorFrame*1600,start=anchor-timing.leadSamples,end=start+timing.durationSamples;
      if(event.kind!=='sfx'||source.origin!=='procedural'||!event.sourceId.startsWith('sfx_')||!declared||timing.anchorFrame>=plan.totalFrames
        ||timing.anchorFrame!==Math.floor(anchor/1600)||timing.synthesisSamples!==declared.synthesisSamples||timing.durationSamples!==declared.durationSamples||timing.leadSamples!==declared.leadSamples||event.sourceOffsetFrames!==undefined
        ||event.frameStart!==Math.floor(Math.max(0,start)/1600)||event.frameEndExclusive!==Math.ceil(Math.min(plan.totalFrames*1600,end)/1600))throw Error('SFX_TIMING_INVALID');
    }else if(event.kind==='sfx'&&SFX_LEAD_TIMING[event.sourceId.slice(4)])throw Error('SFX_LEAD_PLAN_REQUIRED');
    else if(event.sourceSample!==undefined&&(event.frameStart!==Math.floor(event.sourceSample/1600)||event.frameEndExclusive!==Math.ceil(Math.min(plan.totalFrames*1600,event.sourceSample+96000)/1600)))throw Error('SFX_TIMING_INVALID');
  }
  if (sources.size !== plan.sources.length || (plan.music.kind !== 'none' && !sources.has(plan.music.sourceId))) throw Error('AUDIO_SOURCE_INVALID');
  if (plan.music.kind === 'procedural' && !AUDIO_STYLES.includes(plan.music.style)) throw Error('AUDIO_STYLE_UNKNOWN');
  if (plan.mute && (plan.events.length || plan.music.kind !== 'none')) throw Error('MUTED_AUDIO_NOT_EMPTY');
}

/** Block events are read from the trusted built scene, in local frames. Event ids survive array reordering. */
export function deriveAudioPlan(spec, blockEvents, {loudnessTarget = -14, externalMusic, sourceSfx = []} = {}) {
  const plan = {schemaVersion: '3.0.0', kind: 'audio_plan', totalFrames: spec.totalFrames, sampleRate: 48000, channels: 2,
    loudnessTarget, truePeakMax: -1, mute: Boolean(spec.audio.mute), music: {kind: 'none'}, events: [], sources: []};
  if (spec.audio.mute) return plan;
  if (spec.audio.voice) throw Error('AUDIO_VOICE_PLAN_REQUIRED');
  if (!['procedural', 'none'].includes(spec.audio.music.kind)) {
    const requested=spec.audio.music;
    if(!externalMusic||externalMusic.kind!==requested.kind
      ||(requested.kind==='score'?externalMusic.scoreRef!==requested.scoreRef:externalMusic.resourceId!==requested.resourceId)
      ||!['score','upload'].includes(requested.kind)||!externalMusic.licenseRef||!/^[a-f0-9]{64}$/.test(externalMusic.sha256))throw Error('AUDIO_EXTERNAL_PLAN_REQUIRED');
    plan.music={kind:requested.kind,sourceId:'music'};
    plan.sources.push({sourceId:'music',origin:requested.kind==='score'?'score':'customer_upload',licenseRef:externalMusic.licenseRef,sha256:externalMusic.sha256});
  }
  if (spec.audio.music.kind === 'procedural') {
    plan.music = {...spec.audio.music, sourceId: 'music'};
    plan.sources.push({sourceId: 'music', origin: 'procedural', licenseRef: GENERATED_LICENSE});
  }
  if(plan.music.kind!=='none')plan.events.push({eventId:'music:bed',kind:'music',sourceId:'music',frameStart:0,frameEndExclusive:spec.totalFrames,
    gainDb:0,fadeInFrames:1,fadeOutFrames:15});
  const declared = new Map(blockEvents.map(event => [`${event.sceneId}:${event.name}`, event]));
  const requests = spec.audio.sfx === 'auto' ? blockEvents.filter(event => autoSound[event.name]).map(event => ({
    id: autoSound[event.name], at: {sceneId: event.sceneId, event: event.name}
  })) : [...spec.audio.sfx];
  if(!Array.isArray(sourceSfx)||sourceSfx.length>200)throw Error('CUSTOM_SFX_LIMIT');
  for(const item of sourceSfx){
    const scene=spec.scenes.find(scene=>scene.kind==='custom'&&scene.id===item.sceneId&&scene.params?.sourceSfx===true);
    if(!scene||!Number.isInteger(item.frame)||item.frame<0||item.frame>=scene.end-scene.start
      ||item.sample!==undefined&&(!Number.isInteger(item.sample)||item.sample<0||item.sample>=1600*(scene.end-scene.start)||Math.floor(item.sample/1600)!==item.frame||item.sample%1600===0)
      ||!Number.isFinite(item.gainDb)||item.gainDb< -60||item.gainDb>12)throw Error('CUSTOM_SFX_INVALID');
    requests.push({id:item.id,at:{frame:scene.start+item.frame},gain:item.gainDb,fromSource:true,...(item.sample!==undefined?{sourceSample:scene.start*1600+item.sample}:{})});
  }
  const seen = new Set(),seenSoundFrame = new Set();
  for (const request of requests) {
    if (!SFX_IDS.includes(request.id)) throw Error('SFX_UNKNOWN');
    const reference = request.sourceSample!==undefined?'sample:'+request.sourceSample:'frame' in request.at ? 'frame:' + request.at.frame : request.at.sceneId + ':' + request.at.event;
    const eventId = request.id + ':' + reference;
    if (seen.has(eventId)) throw Error('AUDIO_EVENT_DUPLICATE'); seen.add(eventId);
    const event = 'frame' in request.at ? null : declared.get(reference);
    const scene = event && spec.scenes.find(scene => scene.id === event.sceneId);
    const frame = 'frame' in request.at ? request.at.frame : scene && scene.start + event.frame;
    if (!Number.isInteger(frame) || frame < 0 || frame >= spec.totalFrames) throw Error('AUDIO_EVENT_REFERENCE_INVALID');
    const soundFrame=request.id+':'+(request.sourceSample??frame*1600);
    if(request.fromSource&&seenSoundFrame.has(soundFrame))throw Error('AUDIO_EVENT_DUPLICATE');
    seenSoundFrame.add(soundFrame);
    const sourceId = 'sfx_' + request.id;
    if (!plan.sources.some(source => source.sourceId === sourceId)) plan.sources.push({sourceId, origin: 'procedural', licenseRef: GENERATED_LICENSE});
    const timing=SFX_LEAD_TIMING[request.id],anchor=request.sourceSample??frame*1600,start=timing?anchor-timing.leadSamples:anchor;
    const frameStart=Math.floor(Math.max(0,start)/1600),frameEndExclusive=timing?Math.ceil(Math.min(spec.totalFrames*1600,start+timing.durationSamples)/1600):Math.ceil(Math.min(spec.totalFrames*1600,anchor+96000)/1600);
    if(frameEndExclusive<=frameStart||timing&&start+timing.synthesisSamples<=0)throw Error('SFX_OUTSIDE_FILM');
    plan.events.push({eventId,kind:'sfx',sourceId,frameStart,frameEndExclusive,
      ...(timing?{sfxTiming:{anchorFrame:frame,...timing}}:{}),...(request.sourceSample!==undefined?{sourceSample:request.sourceSample}:{}),
      gainDb:request.gain??-6,fadeOutFrames:Math.min(3,frameEndExclusive-frameStart)});
  }
  assertAudioPlan(plan);
  return plan;
}

export const audioPlanHash = (plan, {seed} = {}) => {
  assertAudioPlan(plan); if (typeof seed !== 'string' || !seed.length) throw Error('AUDIO_SEED_REQUIRED');
  return digest({algorithm: AUDIO_VERSION, seed, plan});
};
