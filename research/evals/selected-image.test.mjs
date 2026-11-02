import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pngRgba} from '@promobento/contracts/png';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {downscaleSelectedPng,stageSelectedFile,commitSelectedMaterials} from './selected-image.mjs';
import {prepareMaterialSelection} from './prepare-material-selection.mjs';

test('oversized official PNG is reduced without cropping while retaining its exact source identity',async()=>{
 const original=pngRgba(2,5064,new Uint8Array(2*5064*4));
 const output=pngRgba(2,4096,new Uint8Array(2*4096*4));
 let called=0;
 const normalized=await downscaleSelectedPng(original,{browser:'Chromium test',rasterize:async(bytes,width,height)=>{
  assert.deepEqual(bytes,original);assert.equal(width,2);assert.equal(height,4096);called++;return output;
 }});
 assert.equal(called,1);
 assert.equal(normalized.height,4096);
 assert.equal(normalized.derivation.original.height,5064);
 assert.equal(normalized.derivation.method,'inert_PNG_full_image_downscale_no_crop');
 const unchanged=await downscaleSelectedPng(output,{rasterize(){throw Error('unexpected rasterizer');}});
 assert.equal(unchanged.bytes,output);
 const oversized=pngRgba(2,8193,new Uint8Array(2*8193*4));
 await assert.rejects(downscaleSelectedPng(oversized,{}),/SELECTED_IMAGE_INVALID/);
});

test('reselection is committed once and the source is checked again before ingestion',async()=>{
 mkdirSync('artifacts',{recursive:true});
 const directory=mkdtempSync(join(resolve('artifacts'),'selected-transaction-'));
 try{
  const prior={scope:'internal_eval_only',publicUseCleared:false,assets:[
   {id:'previous-duolingo',topicId:'duolingo',file:'previous-duolingo.png'},
   {id:'prior-minimax',topicId:'minimax',file:'prior-minimax.png'},
  ]};
  writeFileSync(join(directory,'selected.json'),canonical(prior));
  const before=readFileSync(join(directory,'selected.json'),'utf8');
  const original=pngRgba(2,5064,new Uint8Array(2*5064*4));
  const output=pngRgba(2,4096,new Uint8Array(2*4096*4));
  const normalized=await downscaleSelectedPng(original,{browser:'Chromium test',rasterize:()=>output});
  const staged=new Map(),file=stageSelectedFile(staged,'duolingo-path',output,'png');
  const originalFile=stageSelectedFile(staged,'duolingo-path-source',original,'png');
  assert.match(stageSelectedFile(staged,'hf-license',Buffer.from('Apache License'),'txt'),/^[a-z0-9.-]{8,80}\.txt$/);
  const sourceUrl='https://example.com/official',asset={id:'duolingo-path',topicId:'duolingo',file,
   width:2,height:4096,sourceUrl,derivation:{...normalized.derivation,originalFile},
   review:'approved_for_internal_eval_by_codex',reviewedAt:'2026-10-31'};
  // Staging or a mid-selection failure must not erase the previously approved topic.
  assert.equal(readFileSync(join(directory,'selected.json'),'utf8'),before);
  commitSelectedMaterials(directory,prior,'duolingo',[asset],staged);
  const selected=parseCanonicalJson(readFileSync(join(directory,'selected.json')));
  assert.deepEqual(selected.assets.map(item=>item.id),['prior-minimax','duolingo-path']);
  const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'duolingo',factCard:'fixture'}]};
  const card={status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},
   rights:{scope:'internal_eval_only'},assetSources:[{url:sourceUrl,kind:'product_page_screenshot'}]};
  const verify=()=>prepareMaterialSelection(directory,{...selected,assets:[asset]},topics,{readCard:()=>card});
  assert.deepEqual(verify()[0].normalizedSource,original);
  writeFileSync(join(directory,originalFile),pngRgba(2,5064,new Uint8Array(2*5064*4).fill(1)));
  assert.throws(verify,/MATERIAL_DOWNSCALE_INVALID/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
