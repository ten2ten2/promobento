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
