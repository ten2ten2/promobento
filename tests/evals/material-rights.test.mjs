import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {materialApproval} from '../../research/evals/material-approval.mjs';

test('known IELTS permission gap blocks before reading image bytes, invoking Wrangler or admitting a rights row',()=>{
 const directory=mkdtempSync(resolve('artifacts/ielts-rights-fixture-'));
 try{
  writeFileSync(join(directory,'selected.json'),JSON.stringify({scope:'internal_eval_only',publicUseCleared:false,assets:[{
   id:'ielts-no-permission',topicId:'ielts-ready',file:'missing.png',sourceUrl:'https://takeielts.britishcouncil.org/prepare/ielts-ready',
   review:'approved_for_internal_eval_by_codex',reviewedAt:'2026-10-24T00:00:00Z'
  }]}));
  const result=spawnSync(process.execPath,['research/evals/ingest-materials.mjs',directory],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);assert.match(result.stderr,/MATERIAL_SOURCE_PERMISSION_REQUIRED/);
  assert.doesNotMatch(result.stderr,/ENOENT|wrangler|MATERIAL_IDENTITY_INVALID/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('owner approval admits only the original factual diagram and does not clear British Council images',()=>{
 const card=parseCanonicalJson(readFileSync('research/evals/fact-cards/ielts-ready.json'));
 const asset={id:'ielts-ready-facts',origin:'original_factual_diagram',sourceUrl:card.sources[0].url,
  approvalRef:'research/evals/fact-cards/ielts-ready.json#/originalMaterialApproval',originalSourceFile:'ielts-ready-facts.svg',factIds:['practice','courses','webinars']};
 assert.equal(materialApproval(card,asset).original.status,'approved');
 for(const change of [{imageUrl:'https://example.com/copied.png'},{factIds:['practice','scores','webinars']},{id:'another-image'},{originalSourceFile:'../copied.svg'}])
  assert.throws(()=>materialApproval(card,{...asset,...change}),/ORIGINAL_MATERIAL_APPROVAL_REQUIRED/);
 assert.throws(()=>materialApproval(card,{...asset,origin:undefined}),/MATERIAL_SOURCE_PERMISSION_REQUIRED/);
 assert.equal(card.materialLicenseReview.status,'permission_required');
});
