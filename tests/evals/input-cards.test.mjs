import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '../../packages/contracts/index.mjs';
const read=path=>parseCanonicalJson(readFileSync(new URL('../../'+path,import.meta.url)));

test('the six real-topic cards retain sources and the owner confirmation is scoped to this internal evaluation',()=>{
  const topics=read('research/evals/topics.json');
  for(const id of ['deepseek','minimax','duolingo','ielts-ready','marugoto','hf-llm-course']){
    const topic=topics.topics.find(item=>item.id===id),card=read(topic.factCard);
    assert.equal(card.topicId,id);assert.equal(card.fictional,false);assert.equal(topic.facts,card.status);
    assert.equal(topic.assets,'sources_identified_not_ingested');assert.equal(card.assets,topic.assets);
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
