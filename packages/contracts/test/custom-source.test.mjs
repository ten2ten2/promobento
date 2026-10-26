import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '../src/canonical.mjs';
import {customSourceErrors,assertCustomSources,applyCustomEdit} from '../src/custom-source.mjs';
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
 assert.ok(customSourceErrors(scene,'throw Error("must never execute in Node");',film).length);
 assert.throws(()=>applyCustomEdit(source,{command:'str_replace',path:scene.module,oldStr:'a',newStr:'b'},scene.module),/AMBIGUOUS/);
 assert.throws(()=>applyCustomEdit(source,{command:'insert',path:'scenes/other/index.js',insertLine:0,newStr:'x'},scene.module),/SCOPE/);
 assert.throws(()=>applyCustomEdit(source,{command:'str_replace',path:scene.module,oldStr:'One absent string',newStr:''},scene.module),/AMBIGUOUS/);
 assert.match(applyCustomEdit(source,{command:'str_replace',path:scene.module,oldStr:'const timeline=',newStr:'const changedTimeline='},scene.module),/changedTimeline/);
});
