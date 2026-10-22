import {readFileSync} from 'node:fs';
import {canonical,parseCanonicalJson,createSchemaValidator,digest} from '@promobento/contracts';
import {sha256} from '../environment.mjs';
import {parseAbc,perform,GM_DRUMS} from './composer.mjs';
import {INSTRUMENTS,STYLES} from './score.mjs';
import {mixdown,SFX,KITS} from './sound.mjs';
import {rng,mtof} from './dsp.mjs';
import {sampledVoices,sampleEvidence} from './samples.mjs';

export const AUDIO_ALGORITHM_VERSION='huashu-audio-v1';
const resourcesSchema=parseCanonicalJson(readFileSync(new URL('../../../../contracts/admission-resources.schema.json',import.meta.url)));
const validateGenerated=createSchemaValidator({$schema:resourcesSchema.$schema,$id:'https://promobento.com/contracts/generated-audio.schema.json',...resourcesSchema.properties.generatedAudio});
const validateRights=createSchemaValidator(parseCanonicalJson(readFileSync(new URL('../../../../contracts/admission-audio-rights.schema.json',import.meta.url))));
const uses=['process','mix','preview','export'];
// Original, deliberately short engineering scores; not excerpts of existing songs.
export const EXAMPLE_SCORES=Object.freeze({
  launch:'X:1\nT:PromoBento launch study\nM:4/4\nL:1/8\nQ:1/4=112\nK:C\nV:lead inst=marimba role=melody\n!mark:open! C2 G2 E2 D2 | C2 E2 G4 | A2 G2 E2 D2 | !mark:reveal! C4 G4 | E2 G2 c4 | G2 E2 D4 | !mark:close! C8 |\nV:bass inst=bass gain=0.6\nC,,8 | F,,8 | A,,8 | G,,8 | C,,8 | G,,8 | C,,8 |',
  lesson:'X:1\nT:PromoBento lesson study\nM:4/4\nL:1/8\nQ:1/4=104\nK:D\nV:lead inst=harp role=melody\n!mark:open! D2 A2 F2 E2 | D2 F2 A4 | B2 A2 F2 E2 | !mark:reveal! D4 A4 | F2 A2 d4 | A2 F2 E4 | !mark:close! D8 |\nV:pad inst=pad gain=0.6\n[DFA]8 | [GBd]8 | [BDF]8 | [ACE]8 | [DFA]8 | [ACE]8 | [DFA]8 |'
});

export function generatedAudioCatalog() {
  return {version:AUDIO_ALGORITHM_VERSION,sampleRate:48000,channels:2,
    sourceLength:'full_timeline',rights:'Raw ABC requires a separate trusted approval; fixed scoreId, styles and effects have reviewed source records.',
    scoreIds:Object.keys(EXAMPLE_SCORES),styles:Object.keys(STYLES),
    styleVariants:Object.entries(STYLES).flatMap(([style,value])=>Object.keys(value.variants??{}).map(name=>style+':'+name)),
    channelEffects:'procedural_score.channelEffects opts into fixed per-family EQ/chorus/delay/saturation/room chains; false by default',instruments:Object.keys(INSTRUMENTS),
    sampledInstruments:sampledVoices().map(({id,family,pitchRangeMidi,licenseRef})=>({id,family,pitchRangeMidi,licenseRef})),
    effects:Object.entries(SFX).map(([id,{about}])=>({id,description:about})),kits:Object.keys(KITS),
    effectTiming:'Source begins at sample zero; report.hitOffsetFrames locates the intended whoosh/riser landing (not a measured waveform peak). Place the source event before the visual hit by that offset.',
    limits:{sources:8,abcCharacters:16384,voices:16,notes:1024,performedNoteSeconds:180}};
}

export function generatedAudioRequestHash(source,totalFrames) {
  return digest({kind:'generated_audio_request',algorithmVersion:AUDIO_ALGORITHM_VERSION,totalFrames,source});
}

/** Caller's records are outside the creative source package, never candidate assertions. */
export function verifyAudioRights(sources,totalFrames,audioRights=null) {
  if(![450,900].includes(totalFrames)||validateGenerated(sources).length)throw Error('GENERATED_AUDIO_INVALID');
  if(new Set(sources.map(source=>source.id)).size!==sources.length)throw Error('GENERATED_AUDIO_DUPLICATE');
  if(audioRights!==null&&validateRights(audioRights).length)throw Error('AUDIO_RIGHTS_INVALID');
  const approvals=audioRights?.approvals??[],seen=new Set();
  for(const approval of approvals) {
    if(seen.has(approval.sourceId))throw Error('AUDIO_RIGHTS_DUPLICATE');seen.add(approval.sourceId);
    const source=sources.find(s=>s.id===approval.sourceId);
    if(!source||source.kind!=='abc_score'||source.abc===undefined||approval.requestHash!==generatedAudioRequestHash(source,totalFrames))
      throw Error('AUDIO_RIGHTS_BINDING_MISMATCH');
  }
  return sources.map(source=>{
    const requestHash=generatedAudioRequestHash(source,totalFrames);
    const approval=approvals.find(a=>a.sourceId===source.id);
    if(source.kind==='abc_score'&&source.abc!==undefined&&!approval)throw Error('AUDIO_RIGHTS_REQUIRED: '+source.id);
    return {licenseRef:'generated-audio-'+requestHash.slice(0,24),license:'LicenseRef-PromoBento-Generated-Audio',
      basis:approval?.basis??(source.kind==='abc_score'?'reviewed_original_engineering_score':'reviewed_mit_procedural_material'),
      sourceId:source.id,requestHash,algorithmVersion:AUDIO_ALGORITHM_VERSION,allowedUses:[...uses],
      compositionEvidence:approval?structuredClone(approval):{source:'apps/renderer/src/creative-audio/'+(source.kind==='abc_score'?'index.mjs':source.kind==='sfx'?'sound.mjs':'score.mjs')},
      algorithmLicense:'MIT',algorithmEvidence:{path:'apps/renderer/src/creative-audio/LICENSE.huashu',sha256:sha256(readFileSync(new URL('./LICENSE.huashu',import.meta.url)))},
      outputRights:'Generated recording with the composition and any samples governed by the listed evidence; not a CC0 dedication.'};
  });
}

function preparedScore(source,totalFrames) {
  const text=source.abc??EXAMPLE_SCORES[source.scoreId],score=parseAbc(text),marks=Object.create(null);
  const samples=sampledVoices();
  for(const mark of source.marks) {
    if(Object.hasOwn(marks,mark.name)||mark.frameIndex>=totalFrames||!score.cues.some(c=>c.type==='mark'&&c.name===mark.name))throw Error('ABC_MARK_INVALID');
    marks[mark.name]=mark.frameIndex/30;
  }
  for(const v of Object.values(score.voices)) {
    if(v.inst==='drums') {if(!['pop','acoustic','808','cinematic'].includes(v.kit))throw Error('ABC_DRUM_KIT_INVALID');}
    else if(!Object.hasOwn(INSTRUMENTS,v.inst)&&!samples.some(s=>s.id===v.inst))throw Error('AUDIO_INSTRUMENT_UNSUPPORTED: '+v.inst);
  }
  for(const note of score.events) {
    const inst=score.voices[note.voice].inst,sample=samples.find(s=>s.id===inst);
    if(sample&&(note.midi<sample.pitchRangeMidi[0]||note.midi>sample.pitchRangeMidi[1]))throw Error('SAMPLE_NOTE_RANGE');
    if(inst==='drums'&&!Object.hasOwn(GM_DRUMS,note.midi))throw Error('ABC_DRUM_NOTE_UNSUPPORTED');
  }
  const performance=perform(score,{start:.05,seed:source.seed,align:Object.keys(marks).length?marks:null});
  if(performance.notes.length===0||performance.notes.some(n=>!Number.isFinite(n.t)||!Number.isFinite(n.off)||n.t<-.1||n.t>=totalFrames/30||n.off-n.t>30)
    ||performance.notes.reduce((n,v)=>n+Math.max(.12,v.off-v.t)+.6,0)>180)throw Error('ABC_PERFORMANCE_LIMIT');
  return {text,marks,sampleIds:[...new Set(Object.values(score.voices).map(v=>v.inst).filter(id=>id.startsWith('vsco_')))]};
}

/** Bounded trusted computation. The caller handles WAV freezing and actual FFmpeg measurements. */
export function synthesizeGeneratedAudio(source,{totalFrames,audioRights=null}={}) {
  const rights=verifyAudioRights([source],totalFrames,audioRights)[0],duration=totalFrames/30,n=totalFrames*1600;
  let L,R,detail,sampleIds=[];
  if(source.kind==='sfx') {
    const effect=SFX[source.effect],kit=KITS[source.kit],options={dur:source.durationFrames/30,pitch:source.pitch};
    const key=(degree,octave)=>mtof(60+[0,2,4,5,7,9,11][((degree-1)%7+7)%7]+12*(octave-4+Math.floor((degree-1)/7)));
    let out=Object.hasOwn(kit,source.effect)?kit[source.effect](options,rng(source.seed),key):effect.fn(options,rng(source.seed),key);
    if(out instanceof Float32Array)out={sig:out,lead:0};
    let sig=out.sig;if(kit.post)sig=Array.isArray(sig)?sig.map(c=>kit.post(c)):kit.post(sig);
    L=new Float32Array(n);R=new Float32Array(n);
    const [l,r]=Array.isArray(sig)?sig:[sig,sig];L.set(l.subarray(0,n));R.set(r.subarray(0,n));
    detail={effect:source.effect,hitOffsetFrames:Math.round(out.lead*30),audibleSourceFrames:Math.ceil(Math.min(n,l.length)/1600)};
  } else {
    let score=null,marks={},sections=[],music;
    if(source.kind==='abc_score') {const prepared=preparedScore(source,totalFrames);score=prepared.text;marks=prepared.marks;sampleIds=prepared.sampleIds;music={style:'piano',bpm:112,key:60,seed:source.seed,marks};}
    else {
      if(source.sections[0].frameIndex!==0||new Set(source.sections.map(s=>s.id)).size!==source.sections.length
        ||source.sections.some((s,i)=>s.frameIndex>=totalFrames||(i&&s.frameIndex<=source.sections[i-1].frameIndex)))throw Error('AUDIO_SECTIONS_INVALID');
      sections=source.sections;music={style:source.style,bpm:source.bpm,key:source.root,seed:source.seed,ending:source.ending,mixChain:source.channelEffects??false,
        energy:Object.fromEntries(sections.map(s=>[s.id,s.energy]))};
    }
    // All sample rights are checked before parsing/decoding the first source WAV.
    if(sampleIds.length)rights.sampleEvidence=sampleEvidence(sampleIds);
    const result=mixdown({id:source.id,duration,labels:Object.fromEntries(sections.map(s=>['scene:'+s.id,s.frameIndex/30])),music,hits:[]},{score});
    ({L,R}=result.out2);detail={composed:result.composed,style:result.p.style,bpm:result.p.bpm,channelEffects:music.mixChain??false};
  }
  let peak=0;for(let i=0;i<n;i++){if(!Number.isFinite(L[i])||!Number.isFinite(R[i]))throw Error('AUDIO_SYNTH_NONFINITE');peak=Math.max(peak,Math.abs(L[i]),Math.abs(R[i]));}
  if(peak===0)throw Error('AUDIO_SYNTH_SILENT');
  const safetyGain=Math.min(1,.89/peak),samples=new Float64Array(n*2);
  for(let i=0;i<n;i++){samples[2*i]=L[i]*safetyGain;samples[2*i+1]=R[i]*safetyGain;}
  return {samples,rights,report:{algorithmVersion:AUDIO_ALGORITHM_VERSION,seed:source.seed,requestHash:rights.requestHash,
    sourcePeakDbfs:20*Math.log10(peak),sourceSafetyGain:safetyGain,sampleIds,...detail}};
}

/** Ducking is represented in the existing frozen event contract, not hidden post-freeze DSP. */
export function duckingAutomation({eventLengthFrames,spans,depthDb=-10,attackFrames=3,releaseFrames=6}) {
  if(!Number.isInteger(eventLengthFrames)||eventLengthFrames<1||eventLengthFrames>900||!Array.isArray(spans)||spans.length>64
    ||!Number.isFinite(depthDb)||depthDb>0||depthDb< -48||![attackFrames,releaseFrames].every(n=>Number.isInteger(n)&&n>=0&&n<=90))throw Error('DUCKING_INVALID');
  const keys=new Set([0,eventLengthFrames]);
  for(const span of spans) {if(!Array.isArray(span)||span.length!==2||!span.every(Number.isInteger)||span[0]<0||span[1]<=span[0]||span[1]>eventLengthFrames)throw Error('DUCKING_INVALID');
    for(const at of [Math.max(0,span[0]-attackFrames),span[0],span[1],Math.min(eventLengthFrames,span[1]+releaseFrames)])keys.add(at);}
  return [...keys].sort((a,b)=>a-b).map(frameOffset=>({frameOffset,gainDb:spans.reduce((gain,[start,end])=>{
    const factor=frameOffset>=start&&frameOffset<=end?1:frameOffset<start&&attackFrames?Math.max(0,1-(start-frameOffset)/attackFrames):frameOffset>end&&releaseFrames?Math.max(0,1-(frameOffset-end)/releaseFrames):0;
    return Math.min(gain,depthDb*factor)||0;
  },0)}));
}
