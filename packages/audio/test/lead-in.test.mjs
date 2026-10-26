import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveAudioPlan,assertAudioPlan,audioPlanHash} from '../src/plan.mjs';
import {synthesizePlan} from '../src/index.mjs';
import {SFX} from '../src/sound.mjs';
import {SFX_LEAD_TIMING} from '../src/catalog.mjs';
import {rng} from '../src/dsp.mjs';
import {filmFixture} from '../../film-runtime/test/fixture.mjs';

test('explicit FilmSpec SFX gain is decibels in the actual PCM, including zero and the default',()=>{
 for(const gain of[-30,-6,0,6,undefined]){
  const film=filmFixture();film.audio={music:{kind:'none'},sfx:[{id:'tick',at:{frame:30},...(gain===undefined?{}:{gain})}],captions:'off'};
  const plan=deriveAudioPlan(film,[]),rendered=synthesizePlan(plan,{seed:'sfx-gain-units',
   clearedSources:new Map(plan.sources.map(source=>[source.sourceId,{...source,rightsCleared:true}]))});
  let peak=0;for(let i=48000;i<49600;i++)peak=Math.max(peak,Math.abs(rendered.wav.readInt16LE(44+i*4))/32767);
  assert.ok(Math.abs(peak-.35*10**((gain??-6)/20))<=1/32767,'gain '+gain+' dB');
 }
});

test('frozen lead-ins align to the hit at sample precision, including fractional frames and clipped beginnings',()=>{
 const seed='lead-in-fixture';
 for(const[id,anchorFrame]of[['whoosh',30],['whip',0],['riser',30],['reverse',60]]){
  const film=filmFixture();film.audio={music:{kind:'none'},sfx:[{id,at:{frame:anchorFrame}}],captions:'off'};
  const plan=deriveAudioPlan(film,[]),event=plan.events[0],timing=SFX_LEAD_TIMING[id];
  assert.deepEqual(event.sfxTiming,{anchorFrame,...timing});
  assert.equal(event.frameStart,Math.floor(Math.max(0,anchorFrame*1600-timing.leadSamples)/1600));
  const approvals=new Map(plan.sources.map(source=>[source.sourceId,{...source,rightsCleared:true}]));
  const rendered=synthesizePlan(plan,{seed,clearedSources:approvals});
  assert.equal(rendered.sampleFrames,720000);assert.equal(rendered.silent,false);
  const{sig,lead}=SFX[id].fn({dur:timing.synthesisSamples/48000},rng(seed+':'+event.eventId));
  assert.equal(Math.round(lead*48000),timing.leadSamples);
  const left=Array.isArray(sig)?sig[0]:sig,right=Array.isArray(sig)?sig[1]:sig;
  const placement=anchorFrame*1600-timing.leadSamples,start=Math.max(0,placement),offset=Math.max(0,-placement);
  const length=Math.min(plan.totalFrames*1600-start,timing.durationSamples-offset);
  // Compare the actual PCM placement, not a second hash of the same metadata.
  for(const index of[0,64,Math.floor(length/3),Math.floor(length/2),length-1]){
   const fade=Math.max(0,Math.min(1,(length-1-index)/(event.fadeOutFrames*1600))),gain=10**(event.gainDb/20)*fade;
   assert.ok(Math.abs(rendered.wav.readInt16LE(44+(start+index)*4)-Math.round(left[offset+index]*gain*32767))<=1,id+' left');
   assert.ok(Math.abs(rendered.wav.readInt16LE(46+(start+index)*4)-Math.round(right[offset+index]*gain*32767))<=1,id+' right');
  }
  if(start)assert.equal(rendered.wav.readInt16LE(44+(start-1)*4),0);
  const invalid=structuredClone(plan);invalid.events[0].sfxTiming.anchorFrame++;
  assert.throws(()=>assertAudioPlan(invalid),/SFX_TIMING_INVALID/);
  const later=structuredClone(film);later.audio.sfx[0].at.frame=anchorFrame+1;
  assert.notEqual(audioPlanHash(plan,{seed}),audioPlanHash(deriveAudioPlan(later,[]),{seed}));
 }
 const film=filmFixture();film.audio={music:{kind:'none'},sfx:[{id:'riser',at:{frame:0}}],captions:'off'};
 assert.throws(()=>deriveAudioPlan(film,[]),/SFX_OUTSIDE_FILM/);
 film.audio.sfx=[{id:'tick',at:{frame:449}}];const last=deriveAudioPlan(film,[]);
 assert.equal(last.events[0].fadeOutFrames,1);assert.equal(last.events[0].sfxTiming,undefined);
});
