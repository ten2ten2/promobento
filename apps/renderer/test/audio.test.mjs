import test from 'node:test';
import assert from 'node:assert/strict';
import {pcm16Wav,readPcm16Wav,mixPcmEvents,effectiveAudioInterval,observeFixtureCue,measureAudioLoudness} from '../src/audio.mjs';
import {sha256} from '../src/environment.mjs';
import {fixtureAudioMarkers} from '../../../tests/fixtures/render/audio-fixture.mjs';

const fixture=(sampleFrames=6400)=>{
  const bytes=pcm16Wav(new Float64Array(sampleFrames*2).fill(0.25)),sourceHash=sha256(bytes),licenseRef='fixture_cc0';
  return {sourceHash,licenseRef,sources:new Map([[sourceHash,bytes]]),licenses:{[licenseRef]:{
    license:'CC0-1.0',sourceHashes:[sourceHash],allowedUses:['process','mix','preview','export']}},
    event:{eventId:'cue',kind:'sfx',sourceHash,licenseRef,frameStart:0,frameEndExclusive:4,
      sourceOffsetFrames:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0}};
};
const render=(input,event=input.event,frameCount=4)=>mixPcmEvents({...input,events:[event],frameCount});

test('audio measurement accepts only existing local files before launching a decoder',()=>{
  for (const path of ['https://example.test/audio.wav','file:///etc/passwd','pipe:0','',null,'/tmp',
    '/tmp/promobento-file-that-does-not-exist.wav'])
    assert.throws(()=>measureAudioLoudness(path),/AUDIO_LOCAL_FILE_REQUIRED/);
});

test('canonical PCM16 WAV roundtrips actual sample count and rejects truncation, trailing bytes and unsupported format',()=>{
  const bytes=pcm16Wav(Float64Array.from([0,0,0.5,-0.5,0.25,-0.25]));
  const decoded=readPcm16Wav(bytes);
  assert.equal(decoded.sampleRate,48000);assert.equal(decoded.channels,2);assert.equal(decoded.sampleFrames,3);
  assert.equal(decoded.samples[2],0.5);
  assert(Math.abs(decoded.samples[3]+0.5)<=1/32768);
  for (const bad of [bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from([0])])])
    assert.throws(()=>readPcm16Wav(bad),/AUDIO_WAV_INVALID/);
  const mono=Buffer.from(bytes);mono.writeUInt16LE(1,22);
  assert.throws(()=>readPcm16Wav(mono),/AUDIO_WAV_UNSUPPORTED/);
  assert.throws(()=>pcm16Wav(Float64Array.from([1.01,0])),/AUDIO_CLIPPING/);
  assert.throws(()=>pcm16Wav(Float64Array.from([NaN,0])),/AUDIO_CLIPPING/);
});

test('mix uses actual source offsets, exact half-open timeline intervals and silence padding',()=>{
  const input=fixture();
  const samples=new Float64Array(6400*2);
  for (let sample=0;sample<6400;sample++) {samples[sample*2]=Math.floor(sample/1600)/8;samples[sample*2+1]=-samples[sample*2];}
  const bytes=pcm16Wav(samples),hash=sha256(bytes);
  input.sources=new Map([[hash,bytes]]);input.licenses[input.licenseRef].sourceHashes=[hash];
  const output=render(input,{...input.event,sourceHash:hash,frameStart:1,frameEndExclusive:3,sourceOffsetFrames:2});
  assert.equal(output.length,4*1600*2);
  assert(output.subarray(0,1600*2).every(value=>value===0));
  assert(output.subarray(3*1600*2).every(value=>value===0));
  assert.equal(output[1600*2],0.25);assert.equal(output[2*1600*2],0.375);
  assert(output[1600*2+1]<0);
  assert.throws(()=>render(input,{...input.event,sourceHash:hash,sourceOffsetFrames:1}),/AUDIO_SOURCE_RANGE_INVALID/);
});

test('linear-dB automation and amplitude fades multiply at exact sample positions',()=>{
  const input=fixture(),output=render(input,{...input.event,gainDb:-6,fadeInFrames:1,fadeOutFrames:1,
    gainAutomation:[{frameOffset:0,gainDb:0},{frameOffset:4,gainDb:-8}]});
  const expected=(sample,fade)=>0.25*10**((-6-8*(sample/1600)/4)/20)*fade;
  assert.equal(output[0],0);assert.equal(output.at(-1),0);
  assert(Math.abs(output[800*2]-expected(800,0.5))<1e-12);
  assert(Math.abs(output[3200*2]-expected(3200,1))<1e-12);
  assert(Math.abs(output[5600*2]-expected(5600,799/1600))<1e-12);
});

test('all sources require applicable trusted rights before decoding, even a muted source',()=>{
  const input=fixture();
  for (const update of [()=>({}),()=>({[input.licenseRef]:{...input.licenses[input.licenseRef],allowedUses:['preview']}}),
    ()=>({[input.licenseRef]:{...input.licenses[input.licenseRef],sourceHashes:[]}})])
    assert.throws(()=>render({...input,licenses:update()},{...input.event,gainDb:-96}),/AUDIO_LICENSE_REQUIRED/);
  const invalid=Buffer.from('not a WAV'),sourceHash=sha256(invalid);
  assert.throws(()=>render({...input,sources:new Map([[sourceHash,invalid]]),licenses:{}},{...input.event,sourceHash}),/AUDIO_LICENSE_REQUIRED/);
  assert.throws(()=>render({...input,sources:new Map([[input.sourceHash,invalid]])}),/AUDIO_SOURCE_HASH_MISMATCH/);
});

test('invalid event bounds, undeclared defaults, duplicate IDs and malformed curves fail closed',()=>{
  const input=fixture();
  const invalid=[{sourceOffsetFrames:undefined},{frameStart:-1},{frameEndExclusive:5},{frameEndExclusive:0},
    {sourceOffsetFrames:0.5},{gainDb:Infinity},{fadeInFrames:3,fadeOutFrames:2},
    {gainAutomation:[{frameOffset:1,gainDb:0},{frameOffset:4,gainDb:0}]},
    {gainAutomation:[{frameOffset:0,gainDb:0},{frameOffset:3,gainDb:0}]},
    {gainAutomation:[{frameOffset:0,gainDb:0},{frameOffset:0,gainDb:0},{frameOffset:4,gainDb:0}]}];
  for (const update of invalid) assert.throws(()=>render(input,{...input.event,...update}),/AUDIO_(EVENT|AUTOMATION)_INVALID/);
  assert.throws(()=>mixPcmEvents({...input,events:[input.event,input.event],frameCount:4}),/AUDIO_EVENT_ID_INVALID/);
});

test('markers keep stable event IDs when unrelated events are inserted or reordered',()=>{
  const events=[{eventId:'music'},...fixtureAudioMarkers.map(marker=>({eventId:marker.audioEventId,frameStart:marker.frame}))];
  events.unshift({eventId:'unrelated'});events.reverse();
  for (const marker of fixtureAudioMarkers)
    assert.equal(events.find(event=>event.eventId===marker.audioEventId).frameStart,marker.frame);
});

test('effective AAC interval discounts priming and tail padding without inventing content',()=>{
  const probe={streams:[{index:1,codec_type:'audio',codec_name:'aac',sample_rate:'48000',channels:2,time_base:'1/48000'}],
    packets:[{stream_index:1,pts:-1024,duration:1024,side_data_list:[{side_data_type:'Skip Samples',skip_samples:1024,discard_padding:0}]},
      {stream_index:1,pts:0,duration:1024},{stream_index:1,pts:1024,duration:1024,
        side_data_list:[{side_data_type:'Skip Samples',skip_samples:0,discard_padding:448}]}]};
  assert.deepEqual(effectiveAudioInterval(probe),{startSample:0,endSample:1600,effectiveSampleFrames:1600,
    primingSamples:1024,discardPaddingSamples:448,startSeconds:0,endSeconds:1/30});
  const broken=structuredClone(probe);broken.packets[2].pts++;
  assert.throws(()=>effectiveAudioInterval(broken),/AUDIO_PACKET_GAP/);
});

test('cue detector measures waveform onset and rejects missing cues independently from declared time',()=>{
  const samples=new Float64Array(48000*3*2),onset=48000+3200;
  for (let sample=0;sample<9600;sample++) {
    const amplitude=0.2*Math.sin(2*Math.PI*3600*sample/48000)*Math.exp(-sample/48000*18);
    samples[(onset+sample)*2]=amplitude;samples[(onset+sample)*2+1]=amplitude;
  }
  const observed=observeFixtureCue(samples,{frame:30});
  assert(Math.abs(observed.sample-onset)<96);
  assert(observed.frame>31,'The detector must not echo the declared frame30');
  assert.throws(()=>observeFixtureCue(new Float64Array(samples.length),{frame:30}),/AUDIO_CUE_MISSING/);
});
