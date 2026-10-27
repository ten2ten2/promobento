import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateFilmPage} from '../src/page.ts';
import {filmFixture,pageOptions} from './fixture.mjs';
import {webglFixture} from './webgl-fixture.mjs';
import {planShards,WEBGL_BLOCKS,renderPageTiming,renderDeadlineMs} from '../../contracts/src/render.mjs';
import {blockCatalog} from '../../blocks/src/catalog.ts';
import {parseCanonicalJson} from '../../contracts/src/canonical.mjs';
import {filmSourceHash} from '../../contracts/src/film-source.mjs';
import {blockEvents} from '../../blocks/src/events.mjs';
const rules=parseCanonicalJson(readFileSync('config/platform-presets.json'));
const policy=parseCanonicalJson(readFileSync('config/agent-policy.json')).render;

test('WebGL block loads only when used, preserves facts/assets and uses shared cost/timeout planning',()=>{
 const film=webglFixture();
 assert.deepEqual(WEBGL_BLOCKS,blockCatalog.filter(block=>block.usesWebgl).map(block=>block.id+'@1'));
 for(const[aspect,layout]of Object.entries(rules.aspectLayouts)){
  const page=generateFilmPage(JSON.stringify(film),pageOptions(aspect,layout));
  assert.equal(page.plan.usesWebgl,true);assert.match(page.html,/blocks-3d\.js/);
  assert.equal(page.plan.assets.dashboard.resourceId,'res_fixture_dashboard');assert.equal(page.plan.spec.texts.product.text,film.texts.product.text);
  assert.ok(page.html.indexOf('blocks-3d.js')<page.html.indexOf('boot.js'));
 }
 const old=generateFilmPage(JSON.stringify(filmFixture()),pageOptions('landscape',rules.aspectLayouts.landscape));
 assert.equal(old.plan.usesWebgl,false);assert.ok(!old.html.includes('blocks-3d.js'));
 const video=pageOptions('landscape',rules.aspectLayouts.landscape);video.resources[0].kind='video';
 assert.throws(()=>generateFilmPage(JSON.stringify(film),video),/DEVICE_TEXTURE_IMAGE_REQUIRED/);
 assert.deepEqual(blockEvents('device-3d',{start:0,end:450},{}),[{name:'product-land',frame:24}]);
 assert.deepEqual(renderPageTiming(film,policy),{initTimeoutMs:60000,frameTimeoutMs:10000});
 assert.deepEqual(renderPageTiming(filmFixture(),policy),{initTimeoutMs:30000,frameTimeoutMs:5000});
 const job={schemaVersion:'3.0.0',kind:'render_job',renderId:'test-render',operationId:'test-operation',candidateId:'test-candidate',sourceHash:filmSourceHash(JSON.stringify(film)),runtimeVersion:'film-runtime-v1',rendererRelease:'test-release',aspectId:'landscape',durationSeconds:15,totalFrames:450,quality:'final',renderProfile:{sampleCount:1,shutterAngle:0,sampling:'centered-box-v1',edgePolicy:'clamp-v1'},resources:[]};
 const full=planShards(job,film,{seed:'seed'});assert.equal(full.shards.length,24);assert.ok(full.shards.every(shard=>shard.instance==='standard-4'));
 assert.equal(renderDeadlineMs(job,full,policy),330000);
 const mixed=filmFixture();mixed.scenes[1].block='device-3d@1';mixed.scenes[1].params={assetKey:'dashboard',textSlot:'product'};
 const partition=planShards(job,mixed,{seed:'seed'});
 assert.equal(partition.shards[0].start,0);assert.equal(partition.shards.at(-1).end,450);
 for(const[index,shard]of partition.shards.entries()){
  assert.equal(shard.start%15,0);assert.equal(shard.end%15,0);assert.ok(shard.end>shard.start);
  if(index)assert.equal(partition.shards[index-1].end,shard.start);
  const touches=mixed.scenes[1].start<shard.end&&mixed.scenes[1].end>Math.max(0,shard.start-1);
  assert.equal(shard.instance,touches?'standard-4':'standard-3');
 }
 const review=planShards({...job,quality:'review'},mixed,{seed:'seed'});assert.equal(review.shards.length,12);
 assert.ok(review.shards.every(shard=>shard.start%30===0&&shard.end%30===0));
 assert.deepEqual(planShards(job,filmFixture(),{seed:'seed'}).shards.map(shard=>[shard.start,shard.end]),[[0,75],[75,150],[150,225],[225,300],[300,375],[375,450]]);
});
