import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {customFixture} from '../../../packages/film-runtime/test/custom-fixture.mjs';
import {filmFixture} from '../../../packages/film-runtime/test/fixture.mjs';
import {verifyRenderSource,verifySourceSfxPlan} from '../src/render-source.ts';
import {directorAudio} from '../src/director-audio.ts';
import {audioPlanHash} from '../../../packages/audio/src/plan.mjs';

test('render admission binds custom source bytes without changing trusted-block admission',async()=>{
 const {film,sources}=customFixture(),path='scenes/product/index.js',bytes=new TextEncoder().encode(sources[path]);
 const blob={name:path,key:'evals/fixture/source.js',sha256:sha256Bytes(bytes),byteLength:bytes.length};
 const env={MEDIA:{async get(key){return key===blob.key?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}}};
 const hash=filmSourceHash(canonical(film),sources);
 assert.deepEqual(await verifyRenderSource(env,film,[blob],hash),sources);
 await assert.rejects(verifyRenderSource(env,film,[],hash),/CUSTOM_SOURCE_MISSING/);
 await assert.rejects(verifyRenderSource(env,film,[{...blob,sha256:'0'.repeat(64)}],hash),/RENDER_OUTPUT_IDENTITY_MISMATCH/);
 await assert.rejects(verifyRenderSource(env,film,[blob],'0'.repeat(64)),/SOURCE_IDENTITY_MISMATCH/);
 await assert.rejects(verifyRenderSource(env,film,[{...blob,byteLength:65537}],hash),/CUSTOM_SOURCE_SIZE/);
 const trusted=filmFixture();assert.deepEqual(await verifyRenderSource(env,trusted,[],filmSourceHash(canonical(trusted))),{});
});

test('source SFX is in the frozen plan and an altered or missing plan cannot enter rendering',async()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0],seed='source-sfx-admission';
 scene.params.sourceSfx=true;film.audio={music:{kind:'none'},sfx:[],captions:'off'};
 sources[scene.module]=sources[scene.module].replace('const timeline=',"ctx.OM.sfx('whoosh',.5,{gain:.5});const timeline=");
 const sound=directorAudio(film,[],seed,sources);assert.equal(sound.plan.events[0].eventId,'whoosh:frame:15');
 let bytes;
 const env={MEDIA:{async get(){return{size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}}};
 const inputFor=plan=>{
  bytes=new TextEncoder().encode(canonical(plan));
  return{job:{audioPlanHash:audioPlanHash(plan,{seed})},audioInputs:{seed},
   audioInputsBlobs:[{name:'audio-plan',key:'fixture',sha256:sha256Bytes(bytes),byteLength:bytes.length}]};
 };
 await verifySourceSfxPlan(env,film,sources,inputFor(sound.plan));
 const absent=directorAudio(film,[],seed).plan;
 await assert.rejects(verifySourceSfxPlan(env,film,sources,inputFor(absent)),/CUSTOM_SFX_AUDIO_PLAN_MISMATCH/);
 const altered=structuredClone(sound.plan);altered.events[0].gainDb=0;
 await assert.rejects(verifySourceSfxPlan(env,film,sources,inputFor(altered)),/CUSTOM_SFX_AUDIO_PLAN_MISMATCH/);
 const edited={...sources,[scene.module]:sources[scene.module].replace("ctx.OM.sfx('whoosh',.5,{gain:.5})","ctx.OM.sfx('whoosh',1,{gain:.5})")};
 await assert.rejects(verifySourceSfxPlan(env,film,edited,inputFor(sound.plan)),/CUSTOM_SFX_AUDIO_PLAN_MISMATCH/);
 const wrongSeed=inputFor(sound.plan);wrongSeed.audioInputs.seed='other-seed';
 await assert.rejects(verifySourceSfxPlan(env,film,sources,wrongSeed),/AUDIO_PLAN_SCOPE_MISMATCH/);
 await assert.rejects(verifySourceSfxPlan(env,film,sources,{audioInputsBlobs:[]}),/CUSTOM_SFX_AUDIO_PLAN_MISSING/);
 const silent=structuredClone(film);silent.audio.mute=true;
 await verifySourceSfxPlan(env,silent,sources,inputFor(directorAudio(silent,[],seed,sources).plan));
});
