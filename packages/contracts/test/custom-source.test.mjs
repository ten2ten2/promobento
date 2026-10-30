import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '../src/canonical.mjs';
import {customScenePlan,customSourceErrors,assertCustomSources,applyCustomEdit,extractCustomSfx,filmCustomSfx} from '../src/custom-source.mjs';
import {filmSourceHash,filmSourceIdentity} from '../src/film-source.mjs';
import {filmBuildReceipt} from '../src/film-composition.mjs';
import {filmFixture} from '../../film-runtime/test/fixture.mjs';
import {customFixture} from '../../film-runtime/test/custom-fixture.mjs';
import {planShards} from '../src/render.mjs';
test('custom source is parsed as inert data; exact modules bind build and shard identity without changing old block hashes',()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0],source=sources[scene.module];
 assert.deepEqual(customSourceErrors(scene,source,film),[]);assertCustomSources(film,sources);
 const raw=canonical(film),hash=filmSourceHash(raw,sources),changed={...sources,[scene.module]:source+'\n// changed implementation'};
 assert.notEqual(hash,filmSourceHash(raw,changed));assert.equal(filmSourceIdentity(raw,sources).files.length,2);
 assert.notEqual(hash,filmSourceHash(raw,{...sources,[scene.module]:'\uFEFF'+source}));
 assert.equal(filmBuildReceipt(raw,sources).sourceArchiveHash,hash);
 assert.throws(()=>filmSourceHash(raw),/CUSTOM_SOURCE_MISSING/);assert.throws(()=>filmSourceHash(raw,{...sources,'scenes/other/index.js':source}),/CUSTOM_SOURCE_UNDECLARED/);
 const old=canonical(filmFixture());assert.deepEqual(filmSourceIdentity(old).files.map(file=>file.path),['film.json']);
 const job={schemaVersion:'3.0.0',kind:'render_job',renderId:'custom-render',operationId:'custom-operation',candidateId:'custom-candidate',sourceHash:hash,runtimeVersion:'film-runtime-v1',rendererRelease:'fixture-release',aspectId:'landscape',durationSeconds:15,totalFrames:450,quality:'final',renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources:[]};
 assert.notEqual(planShards(job,film,{seed:'seed'}).shards[0].shardKey,planShards({...job,sourceHash:filmSourceHash(raw,changed)},film,{seed:'seed'}).shards[0].shardKey);
});
test('Q0 rejects global evaluation, foreign scope, raw text, imports and unsupported contexts without running them',()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0],source=sources[scene.module];
 for(const bad of ['fetch("https://example.com")','new Function("return 1")()','document.cookie','document.createElement("iframe")','const x=document.createElement("canvas");x.getContext("webgl2")','heading.textContent="unbound"','import("https://example.com/x.js")','Object.getPrototypeOf(()=>{}).constructor("return 1")()'])
  assert.ok(customSourceErrors(scene,source.replace('const w=',bad+'; const w='),film).length,bad);
 assert.ok(customSourceErrors(scene,source.replace("PB.scene('product'","PB.scene('other'"),film).length);
 const local=source.replace('const w=',"const local=(parent)=>{const top=1;return parent+top;};const w=");
 assert.deepEqual(customSourceErrors(scene,local,film),[]);
 for(const bad of ['parent.location','top.location','const local=(top)=>top;top.location'])assert.ok(customSourceErrors(scene,source.replace('const w=',bad+';const w='),film).some(issue=>issue.code==='CUSTOM_FORBIDDEN_API'));
 assert.ok(customSourceErrors(scene,'throw Error("must never execute in Node");',film).length);
 assert.throws(()=>applyCustomEdit(source,{command:'str_replace',path:scene.module,oldStr:'a',newStr:'b'},scene.module),/AMBIGUOUS/);
 assert.throws(()=>applyCustomEdit(source,{command:'insert',path:'scenes/other/index.js',insertLine:0,newStr:'x'},scene.module),/SCOPE/);
 assert.throws(()=>applyCustomEdit(source,{command:'str_replace',path:scene.module,oldStr:'One absent string',newStr:''},scene.module),/AMBIGUOUS/);
 assert.match(applyCustomEdit(source,{command:'str_replace',path:scene.module,oldStr:'const timeline=',newStr:'const changedTimeline='},scene.module),/changedTimeline/);
});

test('reading holds may declare visible scene text without changing legacy plans',()=>{
 const {film}=customFixture(),scene=structuredClone(film.scenes[0]);
 assert.equal(customScenePlan(scene).readingHolds[0].visibleTextSlots,undefined);
 scene.params.readingHolds[0].visibleTextSlots=['headline'];assert.deepEqual(customScenePlan(scene,{validateVisibleTextSlots:true}).readingHolds[0].visibleTextSlots,['headline']);
 scene.params.readingHolds[1].visibleTextSlots=[];assert.doesNotThrow(()=>customScenePlan(scene,{validateVisibleTextSlots:true}));
 for(const bad of [['absent'],['headline','headline'],null,'headline']){scene.params.readingHolds[0].visibleTextSlots=bad;assert.doesNotThrow(()=>customScenePlan(scene));assert.throws(()=>customScenePlan(scene,{validateVisibleTextSlots:true}),/CUSTOM_HOLD_TEXT_INVALID/);}
});

test('optional asset checks validate their targets and frames without restricting legacy or Canvas scenes',()=>{
 const {film}=customFixture(),scene=structuredClone(film.scenes[0]);scene.params.assetKeys=['path','exercise'];
 assert.doesNotThrow(()=>customScenePlan(scene));
 assert.doesNotThrow(()=>customScenePlan(scene,{validateAssetChecks:true}));
 scene.params.assetChecks=[{frame:30,assetKeys:['path']},{frame:150,assetKeys:['exercise']}];
 assert.deepEqual(customScenePlan(scene,{validateAssetChecks:true}).assetChecks,scene.params.assetChecks);
 scene.params.assetChecks=[{frame:30,assetKeys:['path']}];assert.doesNotThrow(()=>customScenePlan(scene,{validateAssetChecks:true}));
 for(const bad of [
  [{frame:30,assetKeys:['path','unknown']}],
  [{frame:30,assetKeys:['path','path']}],
  [{frame:450,assetKeys:['path','exercise']}],
  [{frame:30,assetKeys:['path']},{frame:30,assetKeys:['exercise']}],
  [{frame:30,assetKeys:[]}]
 ]){
  scene.params.assetChecks=bad;
  assert.doesNotThrow(()=>customScenePlan(scene));
  assert.throws(()=>customScenePlan(scene,{validateAssetChecks:true}),/CUSTOM_ASSET_CHECK_INVALID/);
 }
});

test('source SFX are extracted without execution and use frozen BPM and sample-accurate times',()=>{
 const {film,sources}=customFixture(),scene=film.scenes[0];scene.params.sourceSfx=true;
 film.audio={music:{kind:'procedural',style:'mallet',bpm:120},sfx:[],captions:'off'};
 const source=sources[scene.module].replace('const timeline=',"ctx.OM.sfx('whoosh',ctx.OM.beat(1),{gain:.5});const timeline=");
 assert.deepEqual(customSourceErrors(scene,source,film),[]);
 const sounds=extractCustomSfx(scene,source,film);
 assert.deepEqual(sounds,[{id:'whoosh',frame:15,seconds:.5,gain:.5,gainDb:20*Math.log10(.5)}]);
 assert.deepEqual(filmCustomSfx(film,{[scene.module]:source}),[{...sounds[0],sceneId:scene.id}]);
 const emptyOptions=source.replace("ctx.OM.sfx('whoosh',ctx.OM.beat(1),{gain:.5})","ctx.OM.sfx('whoosh',.5,{})");
 assert.equal(extractCustomSfx(scene,emptyOptions,film)[0].gain,1);
 for(const [bad,code] of [
  ["ctx.OM.sfx('whoosh',ctx.random())",'CUSTOM_SFX_STATIC_TIME_REQUIRED'],
  ["ctx.OM.sfx('whoosh',-1)",'CUSTOM_SFX_TIME_INVALID'],
  ["ctx.OM.sfx('whoosh',.5,{pan:1})",'CUSTOM_SFX_OPTIONS_UNSUPPORTED'],
  ["ctx.OM.sfx('whoosh',.5,{gain:0})",'CUSTOM_SFX_GAIN_INVALID'],
  ["ctx.OM.sfx('whoosh',.5);ctx.OM.sfx('whoosh',.5)",'CUSTOM_SFX_DUPLICATE']
 ]){
  const broken=source.replace("ctx.OM.sfx('whoosh',ctx.OM.beat(1),{gain:.5})",bad);
  assert.throws(()=>extractCustomSfx(scene,broken,film),new RegExp(code));
  assert.ok(customSourceErrors(scene,broken,film).some(item=>item.code===code));
 }
 const offFrame=structuredClone(film);offFrame.audio.music.bpm=124;
 const offBeat=extractCustomSfx(offFrame.scenes[0],source,offFrame)[0];
 assert.equal(offBeat.seconds,60/124);assert.equal(offBeat.sample,23226);assert.equal(offBeat.frame,14);
 const noBpm=structuredClone(film);noBpm.audio.music={kind:'none'};
 assert.throws(()=>extractCustomSfx(scene,source,noBpm),/CUSTOM_SFX_STATIC_TIME_REQUIRED/);
 const legacy=structuredClone(scene);delete legacy.params.sourceSfx;
 assert.deepEqual(extractCustomSfx(legacy,source,film),[]);
});
