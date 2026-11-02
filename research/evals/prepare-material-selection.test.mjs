import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {pngRgba} from '@promobento/contracts/png';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {prepareMaterialSelection,readReviewedMaterial} from './prepare-material-selection.mjs';

test('reviewed ordinary images cannot be substituted with a symlink before ingestion',()=>{
 const root=mkdtempSync(join(tmpdir(),'promobento-material-boundary-')),directory=join(root,'selected');
 mkdirSync(directory);
 try{
  const image=pngRgba(1,1,Uint8Array.from([255,255,255,255]));
  const outside=join(root,'unreviewed.png'),file='fixture-image.png';
  writeFileSync(outside,image);
  const sourceUrl='https://example.com/official';
  const card={status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},
   rights:{scope:'internal_eval_only'},assetSources:[{url:sourceUrl,kind:'product_page_screenshot'}]};
  const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:'fixture-card'}]};
  const selected={scope:'internal_eval_only',publicUseCleared:false,assets:[{
   id:'fixture-image',topicId:'fixture',file,width:1,height:1,sourceUrl,
   review:'approved_for_internal_eval_by_codex',reviewedAt:'2026-10-31',
  }]};
  const run=()=>prepareMaterialSelection(directory,selected,topics,{readCard:()=>card});
  writeFileSync(join(directory,file),image);
  assert.equal(run()[0].bytes.length,image.length);
  rmSync(join(directory,file));
  symlinkSync(outside,join(directory,file));
  assert.throws(run,/MATERIAL_SOURCE_INVALID/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('approved original SVG sources cannot be substituted with symlinks before ingestion',()=>{
 const root=mkdtempSync(join(tmpdir(),'promobento-original-boundary-')),directory=join(root,'selected');
 mkdirSync(directory);
 try{
  const sourceUrl='https://example.com/product',id='fixture-diagram',file=id+'.png';
  const image=pngRgba(1,1,Uint8Array.from([255,255,255,255]));
  writeFileSync(join(directory,file),image);
  const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const outside=join(root,'unreviewed.svg');writeFileSync(outside,svg);
  symlinkSync(outside,join(directory,id+'.svg'));
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation',factIds:['fact-one']},
   rights:{scope:'internal_eval_only'},assetSources:[{url:sourceUrl,kind:'original_factual_diagram'}],
   originalMaterialApproval:{status:'approved',approvedBy:'owner',scope:'internal_eval_only',publicUseCleared:false,assetId:id,factIds:['fact-one']}};
  const selected={scope:'internal_eval_only',publicUseCleared:false,assets:[{
   id,topicId:'fixture',file,width:1,height:1,sourceUrl,origin:'original_factual_diagram',
   approvalRef:'research/evals/fact-cards/fixture.json#/originalMaterialApproval',originalSourceFile:id+'.svg',factIds:['fact-one'],
   review:'approved_for_internal_eval_by_codex',reviewedAt:'2026-10-31',
  }]};
  const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:'fixture-card'}]};
  assert.throws(()=>prepareMaterialSelection(directory,selected,topics,{readCard:()=>card}),/MATERIAL_SOURCE_INVALID/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('ingestion rejects a private-looking directory symlink that resolves outside artifacts',()=>{
 const outside=mkdtempSync(join(tmpdir(),'promobento-ingest-outside-'));
 mkdirSync('artifacts',{recursive:true});
 const inside=mkdtempSync(join(resolve('artifacts'),'ingest-link-'));
 try{
  writeFileSync(join(outside,'selected.json'),'{}');
  const alias=join(inside,'outside');symlinkSync(outside,alias);
  const result=spawnSync(process.execPath,['research/evals/ingest-materials.mjs',alias],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);
  assert.match(result.stderr,/PRIVATE_ARTIFACT_DIRECTORY_REQUIRED/);
 }finally{rmSync(inside,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('a license notice cannot be read through a symlink',()=>{
 const root=mkdtempSync(join(tmpdir(),'promobento-license-boundary-'));
 try{
  writeFileSync(join(root,'notice-source.txt'),'owner-review-only');
  symlinkSync(join(root,'notice-source.txt'),join(root,'notice-link.txt'));
  assert.throws(()=>readReviewedMaterial(root,'notice-link.txt',32000),/MATERIAL_SOURCE_INVALID/);
  assert.equal(readReviewedMaterial(root,'notice-source.txt',32000).toString(),'owner-review-only');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('ingestion rejects a symlinked prior receipt before invoking staging',()=>{
 mkdirSync('artifacts',{recursive:true});
 const directory=mkdtempSync(join(resolve('artifacts'),'ingest-receipt-'));
 const outside=mkdtempSync(join(tmpdir(),'promobento-receipt-outside-'));
 try{
  const card=parseCanonicalJson(readFileSync('research/evals/fact-cards/deepseek.json'));
  const asset={id:'fixture-image',topicId:'deepseek',sourceUrl:card.assetSources[0].url,file:'fixture-image.png',
   width:1,height:1,review:'approved_for_internal_eval_by_codex',reviewedAt:'2026-10-31'};
  writeFileSync(join(directory,asset.file),pngRgba(1,1,Uint8Array.from([255,255,255,255])));
  writeFileSync(join(directory,'selected.json'),canonical({scope:'internal_eval_only',publicUseCleared:false,assets:[asset]}));
  writeFileSync(join(outside,'sensitive.txt'),'do not overwrite');
  symlinkSync(join(outside,'sensitive.txt'),join(directory,'ingestion.json'));
  const result=spawnSync(process.execPath,['research/evals/ingest-materials.mjs',directory],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,1);
  assert.match(result.stderr,/PRIVATE_RECEIPT_PATH_INVALID/);
  assert.equal(readFileSync(join(outside,'sensitive.txt'),'utf8'),'do not overwrite');
 }finally{rmSync(directory,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
