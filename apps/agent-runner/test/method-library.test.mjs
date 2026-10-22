import test from 'node:test';
import assert from 'node:assert/strict';
import {METHOD_LIBRARY_IDENTITY,selectMethods,listMethods,methodTopics} from '../src/method-library.mjs';
import {methodCatalog} from '../methods/catalog.mjs';
import {compositionMethod} from '../src/prompts.mjs';

test('reviewed methods retain 18 forms, 20 languages and traceable adapted experience',()=>{
  for(const [category,count]of [['format',18],['language',20],['experience',32]])assert.equal(methodCatalog.filter(card=>card.category===category).length,count);
  assert.equal(new Set(methodCatalog.map(card=>card.id)).size,methodCatalog.length);
  assert.match(METHOD_LIBRARY_IDENTITY.contentHash,/^[0-9a-f]{64}$/);assert.equal(METHOD_LIBRARY_IDENTITY.commit,'5f2608c2e12abcf518f74dde86093b19f7f88603');
  assert.ok(methodCatalog.every(card=>card.source.startsWith('skills/huashu-motion/references/')&&card.body.length>20));
});
test('selection includes real relevant content and hard-gates unsupported capabilities',()=>{
  const software=selectMethods({audience:'software',task:'软件操作演示，改稿拉近按钮',stage:'patch'}),course=selectMethods({audience:'course',task:'解释机制与数据'});
  assert.ok(software.selected.some(card=>card.id==='product-demo-continuity'));assert.ok(course.selected.some(card=>card.id==='language:mechanism'));
  assert.notDeepEqual(software.selected.map(card=>card.id),course.selected.map(card=>card.id));
  assert.ok(!software.selected.some(card=>card.requires.length));
  assert.equal(software.index.find(card=>card.id==='language:3d-object').available,false);
  assert.throws(()=>selectMethods({methodIds:['language:3d-object']}),/UNAVAILABLE/);
  assert.throws(()=>selectMethods({methodIds:['made-up']}),/UNAVAILABLE/);
  assert.ok(selectMethods({methodIds:['language:retro-digital']}).selected.some(card=>card.id==='language:retro-digital'));
  assert.ok(methodTopics('配色和音乐').includes('colour'));assert.equal(listMethods({ids:['format:loop']}).cards.length,1);
});
test('compositionMethod consumes selected public methods without rewriting fixed delivery rules',async()=>{
  const method=await compositionMethod({durationSeconds:15,targetIds:['tiktok:portrait'],audience:'course',task:'教学数据对比',methodIds:['format:before-after']});
  assert.ok(method.methods.selected.some(card=>card.id==='format:before-after'));assert.ok(method.resourceSchema.properties.generatedAudio);
  assert.match(method.motionApi,/components.chart/);assert.match(method.motionApi,/word-cjk/);assert.equal(method.generatedAudio.version,'huashu-audio-v1');assert.equal(method.targets[0].height,1920);
});
