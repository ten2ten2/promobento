import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '../../packages/contracts/index.mjs';
const read=path=>parseCanonicalJson(readFileSync(new URL('../../'+path,import.meta.url)));

test('sourced real-product cards retain attribution and do not fabricate confirmation or captured material',()=>{
  const topics=read('research/evals/topics.json');
  for(const id of ['deepseek','minimax','duolingo']){
    const topic=topics.topics.find(item=>item.id===id),card=read(topic.factCard);
    assert.equal(card.topicId,id);assert.equal(card.fictional,false);assert.equal(topic.facts,card.status);
    assert.equal(topic.assets,'sources_identified_not_ingested');assert.equal(card.assets,topic.assets);
    assert.equal(card.rights.scope,'internal_eval_only');assert.equal(card.rights.publicUseCleared,false);
    const sources=new Map(card.sources.map(source=>[source.id,source]));
    assert.ok(card.facts.length>=3&&card.assetSources.length>=1);
    for(const fact of card.facts){assert.ok(sources.has(fact.sourceId));assert.equal(fact.confirmedBy,undefined);}
    for(const source of [...card.sources,...card.assetSources])assert.equal(new URL(source.url).protocol,'https:');
  }
});
