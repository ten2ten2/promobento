import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,parseCanonicalJson,createSchemaValidator} from '@promobento/contracts';
import {generatedAudioCatalog,synthesizeGeneratedAudio,verifyAudioRights,generatedAudioRequestHash,duckingAutomation} from '../../src/creative-audio/index.mjs';
import {parseAbc} from '../../src/creative-audio/composer.mjs';
import {samplerStereo,sampledVoices,sampleEvidence,decodeSampleWav} from '../../src/creative-audio/samples.mjs';
import {rng,mtof} from '../../src/creative-audio/dsp.mjs';
import {analyze} from '../../src/creative-audio/beats.mjs';
import {prepareCaptions,analyzeAudioBytes} from '../../src/creative-audio/tools.mjs';
import {pcm16Wav,mixPcmEvents} from '../../src/audio.mjs';
import {sha256} from '../../src/environment.mjs';
import {creativeAudioFixture} from './fixture.mjs';

const score=()=>({id:'score',kind:'abc_score',algorithmVersion:'huashu-audio-v1',seed:17,scoreId:'launch',marks:[]});
const approval=(source,totalFrames=450)=>({schemaVersion:'2.7.0',kind:'admission_audio_rights',approvals:[{sourceId:source.id,
  requestHash:generatedAudioRequestHash(source,totalFrames),basis:'original_composition_reviewed',evidenceRef:'unit-original-study',reviewer:'engineering unit fixture',allowedUses:['process','mix','preview','export']}]});
test('catalog has finite explicit voices, sound effects and sample ranges, not external piano recordings',()=>{
  const c=generatedAudioCatalog();assert.doesNotThrow(()=>canonical(c));assert.equal(c.styles.length,13);assert.equal(c.effects.length,23);
  assert.equal(c.sampledInstruments.length,6);assert(c.instruments.includes('piano'));assert(c.instruments.includes('rhodes'));
  assert(c.sampledInstruments.every(s=>s.licenseRef==='vsco-2-ce-cc0-4403009'));assert(!canonical(c).includes('wurli'));
});
test('the resource schema accepts bounded sources and rejects arbitrary fields, licenses and dual score inputs',()=>{
  const schema=parseCanonicalJson(readFileSync(new URL('../../../../contracts/admission-resources.schema.json',import.meta.url)));
  const validate=createSchemaValidator(schema),request={schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:['score'],audioEvents:[],generatedAudio:[score()]};
  assert.equal(validate(request).length,0);
  for(const source of [{...score(),abc:'C'},{...score(),license:'CC0-1.0'},{...score(),seed:Infinity},{...score(),abc:'C'.repeat(20000)}])
    assert(validate({...request,generatedAudio:[source]}).length);
});
test('raw ABC rights bind exact request, seed, timeline and source before synthesis',()=>{
  const s={...score(),abc:'X:1\nQ:120\nK:C\nCDEF'};delete s.scoreId;
  assert.throws(()=>verifyAudioRights([s],450),/AUDIO_RIGHTS_REQUIRED/);
  const rights=approval(s);assert.equal(verifyAudioRights([s],450,rights)[0].basis,'original_composition_reviewed');
  for(const source of [{...s,seed:18},{...s,abc:s.abc+'G'},{...s,id:'changed'}])assert.throws(()=>verifyAudioRights([source],450,rights),/BINDING/);
  assert.throws(()=>verifyAudioRights([s],900,rights),/BINDING/);
  assert.throws(()=>verifyAudioRights([s,s],450,rights),/DUPLICATE/);
  assert.throws(()=>verifyAudioRights([s],450,{...rights,approvals:[rights.approvals[0],rights.approvals[0]]}),/DUPLICATE/);
  assert.equal(verifyAudioRights([score()],450)[0].license,'LicenseRef-PromoBento-Generated-Audio');
});
test('ABC parser bounds unterminated fields, repeats, huge time values, voice and numeric abuse',()=>{
  for(const abc of ['K:C\n[Q:100','K:C\nC/0','K:C\nZ999999999','K:C\nV:__proto__ inst=piano\nC','K:C\nV:a gain=NaN\nC',
    'K:C\n'+'C '.repeat(2000),'K:C\nZ :| :| :|','Q:99999\nK:C\nC'])assert.throws(()=>parseAbc(abc),/ABC_/);
});
test('all fixed CC0 samples verify before decode and deterministic nearest-pitch playback has no fallback',()=>{
  const ids=sampledVoices().map(s=>s.id),evidence=sampleEvidence(ids);assert.equal(evidence.resources.length,6);
  for(const s of sampledVoices()) {
    const voice=samplerStereo(s.id),a=voice(mtof(s.rootMidi),.25,.7,rng(1)),b=voice(mtof(s.rootMidi),.25,.7,rng(1));
    assert.deepEqual(a,b);assert(a.L.every(Number.isFinite));assert(a.L.some(x=>Math.abs(x)>1e-5));
    assert.throws(()=>voice(mtof(s.rootMidi+24),.25,.7),/SAMPLE_NOTE_RANGE/);
  }
  assert.throws(()=>samplerStereo('piano'),/SAMPLE_UNKNOWN/);assert.throws(()=>decodeSampleWav(Buffer.alloc(44)),/WAV_INVALID/);
});
test('ABC stereo source is bit-identical after unrelated renders and frozen through the existing mixer',()=>{
  const s=score(),a=synthesizeGeneratedAudio(s,{totalFrames:450});
  synthesizeGeneratedAudio({...s,seed:18},{totalFrames:450});const b=synthesizeGeneratedAudio(s,{totalFrames:450});
  assert.deepEqual(a.samples,b.samples);assert.equal(a.samples.length,450*1600*2);
  const bytes=pcm16Wav(a.samples),sourceHash=sha256(bytes),license={...a.rights,sourceHashes:[sourceHash]};
  const event={eventId:'m',kind:'music',sourceHash,licenseRef:license.licenseRef,frameStart:0,frameEndExclusive:450,sourceOffsetFrames:0,gainDb:0,fadeInFrames:0,fadeOutFrames:3};
  const mixed=mixPcmEvents({events:[event],sources:new Map([[sourceHash,bytes]]),licenses:{[license.licenseRef]:license},frameCount:450});
  assert(mixed.some(x=>Math.abs(x)>.01));
  assert.throws(()=>mixPcmEvents({events:[event],sources:new Map([[sourceHash,bytes]]),licenses:{[license.licenseRef]:{...license,license:'MIT'}},frameCount:450}),/LICENSE_REQUIRED/);
});
test('all 23 effect names render bounded finite non-silent stereo without environment choices',()=>{
  for(const {id} of generatedAudioCatalog().effects) {
    const r=synthesizeGeneratedAudio({id:'effect',kind:'sfx',algorithmVersion:'huashu-audio-v1',seed:9,effect:id,kit:'clean',durationFrames:15,pitch:1},{totalFrames:450});
    assert.equal(r.samples.length,1440000);assert(r.samples.every(Number.isFinite),id);assert(r.samples.some(v=>Math.abs(v)>.01),id);
  }
});
test('all procedural styles, variants and channel effects produce finite audio with deterministic explicit settings',()=>{
  for(const style of [...generatedAudioCatalog().styles,...generatedAudioCatalog().styleVariants]) {
    const r=synthesizeGeneratedAudio({id:'music',kind:'procedural_score',algorithmVersion:'huashu-audio-v1',seed:3,style,bpm:120,root:60,
      channelEffects:style==='pulse',sections:[{id:'open',frameIndex:0,energy:.55},{id:'peak',frameIndex:180,energy:1},{id:'close',frameIndex:390,energy:.3}],ending:'ring'},{totalFrames:450});
    assert(r.samples.every(Number.isFinite),style);assert(r.samples.some(v=>Math.abs(v)>.01),style);
  }
});
test('real-sample engineering fixture passes scoped rights and produces audible notes',()=>{
  const fixture=creativeAudioFixture();assert.equal(verifyAudioRights(fixture.generatedAudio,450,fixture.audioRights).length,2);
  const r=synthesizeGeneratedAudio(fixture.generatedAudio[0],{totalFrames:450,audioRights:fixture.audioRights});
  assert.equal(r.report.sampleIds.length,3);assert(r.samples.some(v=>Math.abs(v)>.05));
});
test('beat analysis resolves a 120 bpm pulse and reports weak evidence instead of certainty',()=>{
  const n=15*48000,L=new Float32Array(n);for(let beat=0;beat<30;beat++)for(let j=0;j<6000&&beat*24000+j<n;j++)L[beat*24000+j]=Math.sin(2*Math.PI*70*j/48000)*Math.exp(-j/900);
  const r=analyze({L,R:L,rate:48000});assert(Math.abs(r.bpm-120)<1);assert(r.confidence>=.3);assert.equal(r.meterAssumption,'4/4');
  const quiet=analyze({L:new Float32Array(48000),R:new Float32Array(48000),rate:48000});assert.equal(quiet.pulseReliable,false);assert.equal(quiet.end,0);
  assert.throws(()=>analyzeAudioBytes(pcm16Wav(new Float64Array(9600)),null),/RIGHTS_REQUIRED/);
});
test('confirmed captions preserve text, pause boundaries and interpolated timing labels',()=>{
  const request={operation:'captions',script:'Hello, world! 你好，世界。',scriptConfirmed:true,durationSeconds:5,speechSpans:[[0,2],[3,5]],spanBasis:'human_confirmed'};
  const r=prepareCaptions(request);assert.equal(r.wordTiming,'interpolated');assert(r.srt.includes('Hello, world!'));assert(r.srt.includes('你好，世界。'));
  assert(r.words.every(w=>w.end<=2||w.start>=3));assert.throws(()=>prepareCaptions({...request,scriptConfirmed:false}),/REQUEST_INVALID/);
  assert.throws(()=>prepareCaptions({...request,speechSpans:[[0,4],[3,5]]}),/SPANS_INVALID/);
  const aligned=prepareCaptions({...request,characterAnchors:[{ch:'H',start:0,end:.1}]});
  assert(aligned.alignment.characters.some(c=>c.timingBasis==='interpolated'));assert(aligned.alignment.characters.some(c=>c.timingBasis==='observed_anchor'));
});
test('ducking compiles to explicit frame keys in the frozen event contract',()=>{
  assert.deepEqual(duckingAutomation({eventLengthFrames:60,spans:[[20,30]],depthDb:-10,attackFrames:3,releaseFrames:6}),
    [{frameOffset:0,gainDb:0},{frameOffset:17,gainDb:0},{frameOffset:20,gainDb:-10},{frameOffset:30,gainDb:-10},{frameOffset:36,gainDb:0},{frameOffset:60,gainDb:0}]);
});
