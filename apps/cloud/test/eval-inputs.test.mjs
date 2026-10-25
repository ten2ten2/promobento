import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';

test('eval input preparation rejects an oversized source before writing any case and preserves all six topics',t=>{
 const root=resolve('.'),temp=mkdtempSync(join(tmpdir(),'promobento-eval-inputs-'));t.after(()=>rmSync(temp,{recursive:true,force:true}));
 const read=file=>parseCanonicalJson(readFileSync(resolve(root,file))),write=(file,value)=>writeFileSync(join(temp,file),canonical(value)+'\n');
 mkdirSync(join(temp,'research/evals'),{recursive:true});mkdirSync(join(temp,'artifacts'));
 const topics=read('research/evals/topics.json'),materials=read('research/evals/materials.json');
 for(const topic of topics.topics.filter(topic=>topic.countsTowardGate!==false))topic.factCard=resolve(root,topic.factCard);
 write('research/evals/topics.json',topics);
 const path=materials.assets.find(asset=>asset.id==='duolingo-path');path.height=5064;
 write('research/evals/materials.json',materials);
 const run=()=>spawnSync(process.execPath,[resolve(root,'research/evals/prepare-inputs.mjs'),'artifacts/prepared','renderer-fbf1a740f146'],{cwd:temp,encoding:'utf8'});
 const rejected=run();assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/EVAL_MATERIAL_NORMALIZATION_REQUIRED/);assert.equal(existsSync(join(temp,'artifacts/prepared')),false);
 // Metadata-only fixture of the admitted bound; no media or licensing decision is synthesized.
 path.width=1893;path.height=4096;write('research/evals/materials.json',materials);
 const accepted=run();assert.equal(accepted.status,0,accepted.stderr);
 const manifest=parseCanonicalJson(readFileSync(join(temp,'artifacts/prepared/manifest.json')));
 assert.equal(manifest.creativeCases,12);assert.equal(manifest.expectedFinalFilms,24);
 for(const item of manifest.cases){
  const context=parseCanonicalJson(readFileSync(join(temp,'artifacts/prepared',item.contextFile)));
  assert.ok(context.resources.every(asset=>asset.topicId===item.topicId));
  assert.equal(context.rendererRelease,'renderer-fbf1a740f146');assert.equal(context.publicUseCleared,false);
 }
 assert.equal(manifest.cases.filter(item=>item.topicId==='ielts-ready').length,2);
});
