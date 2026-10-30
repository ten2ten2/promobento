import test from 'node:test';
import assert from 'node:assert/strict';
import {filmCustomSfx} from '../../contracts/src/custom-source.mjs';
import {customFixture} from '../../film-runtime/test/custom-fixture.mjs';
import {filmBlockEvents} from '../../blocks/src/events.mjs';
import {deriveAudioPlan,audioPlanHash} from '../src/plan.mjs';
import {synthesizePlan} from '../src/index.mjs';

test('source-declared sound is frozen into the actual plan with upstream linear gain and lead-in',()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0];scene.params.sourceSfx=true;
 film.audio={music:{kind:'none'},sfx:[],captions:'off'};
 sources[scene.module]=sources[scene.module].replace('const timeline=',"ctx.OM.sfx('whoosh',.5,{gain:.5});const timeline=");
 const effects=filmCustomSfx(film,sources),events=filmBlockEvents(film),plan=deriveAudioPlan(film,events,{sourceSfx:effects});
 assert.equal(plan.events.length,1);const sound=plan.events[0];
 assert.equal(sound.eventId,'whoosh:frame:15');assert.equal(sound.gainDb,20*Math.log10(.5));
 assert.deepEqual(sound.sfxTiming,{anchorFrame:15,synthesisSamples:24000,durationSamples:24000,leadSamples:14400});
 assert.equal(sound.frameStart,6);assert.equal(sound.frameEndExclusive,21);
 const clearedSources=new Map(plan.sources.map(item=>[item.sourceId,{...item,rightsCleared:true}]));
 const out=synthesizePlan(plan,{seed:'source-sfx-test',clearedSources});
 const audible=(start,end)=>out.wav.subarray(44+start*4,44+end*4).some(byte=>byte!==0);
 assert.equal(out.silent,false);assert.equal(audible(0,9600),false);
 assert.equal(audible(9600,24000),true,'lead-in is audible before the 0.5 s motion anchor');
 assert.equal(audible(33600,450*1600),false);
 assert.notEqual(audioPlanHash(plan,{seed:'source-sfx-test'}),audioPlanHash(deriveAudioPlan(film,events),{seed:'source-sfx-test'}));
 const duplicate=structuredClone(film);duplicate.audio.sfx=[{id:'whoosh',at:{frame:15}}];
 assert.throws(()=>deriveAudioPlan(duplicate,events,{sourceSfx:effects}),/AUDIO_EVENT_DUPLICATE/);
 const muted=structuredClone(film);muted.audio.mute=true;
 assert.deepEqual(deriveAudioPlan(muted,events,{sourceSfx:effects}).events,[]);
});


test('source BPM hits keep their nearest audio sample, including lead-in and ordinary effects',()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0];scene.params.sourceSfx=true;
 film.audio={music:{kind:'procedural',style:'mallet',bpm:124},sfx:[],captions:'off'};
 sources[scene.module]=sources[scene.module].replace('const timeline=',"ctx.OM.sfx('whoosh',ctx.OM.beat(1));ctx.OM.sfx('pop',ctx.OM.beat(1));const timeline=");
 const effects=filmCustomSfx(film,sources),plan=deriveAudioPlan(film,filmBlockEvents(film),{sourceSfx:effects});
 const whoosh=plan.events.find(e=>e.sourceId==='sfx_whoosh'),pop=plan.events.find(e=>e.sourceId==='sfx_pop');
 assert.equal(whoosh.eventId,'whoosh:sample:23226');assert.equal(whoosh.sourceSample,23226);assert.equal(whoosh.sfxTiming.anchorFrame,14);
 assert.equal(whoosh.frameStart,5);assert.equal(whoosh.frameEndExclusive,21);
 assert.equal(pop.sourceSample,23226);assert.equal(pop.frameStart,14);assert.equal(pop.frameEndExclusive,75);
 const broken=structuredClone(plan);broken.events.find(e=>e.sourceId==='sfx_whoosh').sfxTiming.anchorFrame=15;
 assert.throws(()=>audioPlanHash(broken,{seed:'source-sfx-test'}),/SFX_TIMING_INVALID/);
 const noMusic=structuredClone(plan);noMusic.music={kind:'none'};noMusic.events=noMusic.events.filter(e=>e.kind!=='music');noMusic.sources=noMusic.sources.filter(e=>e.sourceId!=='music');
 const clearedSources=new Map(noMusic.sources.map(item=>[item.sourceId,{...item,rightsCleared:true}]));
 const out=synthesizePlan(noMusic,{seed:'source-sfx-test',clearedSources});
 const audible=(start,end)=>out.wav.subarray(44+start*4,44+end*4).some(byte=>byte!==0);
 assert.equal(audible(0,8826),false);assert.equal(audible(8826,23226),true);
 const onlyPop=structuredClone(noMusic);onlyPop.events=onlyPop.events.filter(e=>e.sourceId==='sfx_pop');onlyPop.sources=onlyPop.sources.filter(e=>e.sourceId==='sfx_pop');
 const popWav=synthesizePlan(onlyPop,{seed:'source-sfx-test',clearedSources}).wav;
 assert.equal(popWav.subarray(44,44+23226*4).some(byte=>byte!==0),false);
 assert.equal(popWav.subarray(44+23226*4,44+24000*4).some(byte=>byte!==0),true);
});
