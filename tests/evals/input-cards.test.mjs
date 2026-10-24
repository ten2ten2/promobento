import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '../../packages/contracts/index.mjs';
const read=path=>parseCanonicalJson(readFileSync(new URL('../../'+path,import.meta.url)));

test('the six real-topic cards retain sources and the owner confirmation is scoped to this internal evaluation',()=>{
  const topics=read('research/evals/topics.json');
  const materials=read('research/evals/materials.json');
  assert.equal(materials.scope,'internal_eval_only');assert.equal(materials.publicUseCleared,false);
  assert.equal(new Set(materials.assets.map(asset=>asset.id)).size,materials.assets.length);
  for(const id of ['deepseek','minimax','duolingo','ielts-ready','marugoto','hf-llm-course']){
    const topic=topics.topics.find(item=>item.id===id),card=read(topic.factCard);
    assert.equal(card.topicId,id);assert.equal(card.fictional,false);assert.equal(topic.facts,card.status);
    assert.ok(['sources_identified_not_ingested','ingested_internal_eval'].includes(topic.assets));assert.equal(card.assets,topic.assets);
    const assets=materials.assets.filter(asset=>asset.topicId===id);
    if(topic.assets==='ingested_internal_eval'){
      assert.ok(assets.length>0);assert.deepEqual(topic.materialIds,assets.map(asset=>asset.id));assert.deepEqual(card.materialIds,topic.materialIds);
      for(const asset of assets){
        assert.equal(asset.scope,'internal_eval_only');assert.equal(asset.publicUseCleared,false);assert.equal(asset.mediaType,'image/png');
        assert.match(asset.sha256,/^[a-f0-9]{64}$/);assert.match(asset.key,/^evals\/.+\.png$/);assert.match(asset.evidenceKey,/^evals\/.+\.json$/);
        assert.ok(asset.byteLength>0&&asset.width>0&&asset.height>0&&asset.licenseRef);
        assert.ok(card.assetSources.some(source=>source.url===asset.sourceUrl));
      }
    }else{assert.equal(assets.length,0);assert.ok(materials.pending.some(item=>item.topicId===id));}
    assert.equal(card.rights.scope,'internal_eval_only');assert.equal(card.rights.publicUseCleared,false);
    const sources=new Map(card.sources.map(source=>[source.id,source]));
    assert.equal(card.status,'confirmed_for_s1_eval');
    assert.equal(card.confirmation.confirmedBy,'owner');
    assert.equal(card.confirmation.scope,'s1-first-internal-evaluation');
    assert.deepEqual(card.confirmation.factIds,card.facts.map(fact=>fact.id));
    assert.ok(card.facts.length>=3&&card.assetSources.length>=1);
    for(const fact of card.facts){assert.ok(sources.has(fact.sourceId));assert.equal(fact.confirmedBy,undefined);}
    for(const source of [...card.sources,...card.assetSources])assert.equal(new URL(source.url).protocol,'https:');
  }
});
