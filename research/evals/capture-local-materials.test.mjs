import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pngRgba} from '@promobento/contracts/seams';
import {sha256Bytes} from '@promobento/contracts/digest';
import {captureApprovedLocal} from './capture-local-materials.mjs';
import {assertLocalMaterialIdentity,materialApproval} from './material-approval.mjs';
import {prepareMaterialSelection} from './prepare-material-selection.mjs';

test('local intake requires per-file approval before copying, confines paths and produces pending selections',()=>{
 const local=mkdtempSync(join(tmpdir(),'pb-local-input-')),outputs=mkdtempSync(resolve('artifacts/.local-capture-test-'));
 try{
  const source=join(local,'product');mkdirSync(source);const png=pngRgba(2,2,Uint8Array.from([0,180,0,255,0,180,0,255,0,180,0,255,0,180,0,255]));
  writeFileSync(join(source,'screen.png'),png);writeFileSync(join(local,'outside.png'),png);symlinkSync(join(local,'outside.png'),join(source,'escape.png'));
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},
   assetSources:[{kind:'local_project_media',url:'local://fixture'}],materialApprovals:{'fixture-screen':{status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-30',basis:'Owner-provided original fixture.',sourceFile:'screen.png',sourceUrl:'local://fixture',sha256:sha256Bytes(png)}}};
  const entry={id:'fixture-screen',sourceFile:'screen.png',sourceUrl:'local://fixture',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-screen',description:'Original fixture screenshot.'};
  const denied=join(outputs,'denied');assert.throws(()=>captureApprovedLocal({sourceDir:source,outputDir:denied,card:{...card,materialApprovals:{}},entries:[{...entry,sourceFile:'missing.png',approvalRef:undefined}]}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);assert.equal(existsSync(denied),false);
  const escape=join(outputs,'escape'),escapeCard={...card,materialApprovals:{'fixture-screen':{...card.materialApprovals['fixture-screen'],sourceFile:'escape.png'}}};
  assert.throws(()=>captureApprovedLocal({sourceDir:source,outputDir:escape,card:escapeCard,entries:[{...entry,sourceFile:'escape.png'}]}),/LOCAL_MATERIAL_PATH_INVALID/);assert.equal(existsSync(escape),false);
  const changed=join(outputs,'changed'),changedCard={...card,materialApprovals:{'fixture-screen':{...card.materialApprovals['fixture-screen'],sha256:'0'.repeat(64)}}};
  assert.throws(()=>captureApprovedLocal({sourceDir:source,outputDir:changed,card:changedCard,entries:[entry]}),/LOCAL_MATERIAL_IDENTITY_MISMATCH/);assert.equal(existsSync(changed),false);
  const output=join(outputs,'approved'),result=captureApprovedLocal({sourceDir:source,outputDir:output,card,entries:[entry]});
  assert.deepEqual(readFileSync(join(output,'fixture-screen.png')),png);assert.equal(result.assets[0].review,'pending_visual_selection');assert.equal(result.assets[0].approvalRef,entry.approvalRef);
  const asset=result.assets[0],approval=materialApproval(card,asset);assert.doesNotThrow(()=>assertLocalMaterialIdentity(approval,asset,sha256Bytes(png)));
  assert.throws(()=>assertLocalMaterialIdentity(approval,asset,'0'.repeat(64)),/LOCAL_MATERIAL_IDENTITY_MISMATCH/);
  assert.throws(()=>assertLocalMaterialIdentity(approval,{...asset,derivation:undefined},sha256Bytes(png)),/LOCAL_MATERIAL_IDENTITY_MISMATCH/);
  const legacy={...asset,review:'approved_for_internal_eval_by_codex',reviewedAt:'2026-10-30'};delete legacy.mediaType;
  const selection={scope:'internal_eval_only',publicUseCleared:false,assets:[legacy]},topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:'fixture.json'}]};
  assert.equal(prepareMaterialSelection(output,selection,topics,{readCard:()=>card})[0].mediaType,'image/png');
  assert.equal(JSON.parse(readFileSync(join(output,'selected.json'))).assets[0].width,2);assert.throws(()=>captureApprovedLocal({sourceDir:source,outputDir:output,card,entries:[entry]}),/NEW_PRIVATE_OUTPUT_REQUIRED/);
 }finally{rmSync(local,{recursive:true,force:true});rmSync(outputs,{recursive:true,force:true});}
});


test('approved JPEG and WebP keep their original bytes, identity, type and dimensions in the selection',()=>{
 const local=mkdtempSync(join(tmpdir(),'pb-local-images-')),outputs=mkdtempSync(resolve('artifacts/.local-images-test-'));
 try{
  const source=join(local,'project');mkdirSync(source);
  const images=[['approved-jpeg','screen.jpg','image/jpeg',Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAL/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAA5IH/9k=','base64')],
   ['approved-webp','screen.webp','image/webp',Buffer.from('UklGRjoAAABXRUJQVlA4IC4AAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+rhf/NgVzXPv9/+8+fufP3Pn/CAAA','base64')]];
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}],materialApprovals:{}};
  const entries=images.map(([id,file,mediaType,bytes])=>{writeFileSync(join(source,file),bytes);card.materialApprovals[id]={status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-30',basis:'Owner-provided synthetic fixture.',sourceFile:file,sourceUrl:'local://fixture',sha256:sha256Bytes(bytes)};
   return{id,sourceFile:file,sourceUrl:'local://fixture',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/'+id,description:'Approved image.'};});
  const out=join(outputs,'approved'),result=captureApprovedLocal({sourceDir:source,outputDir:out,card,entries});
  for(const [index,[id,file,type,bytes]]of images.entries()){const item=result.assets[index];assert.equal(item.mediaType,type);assert.deepEqual([item.width,item.height],[2,3]);
   assert.deepEqual(readFileSync(join(out,item.file)),bytes);assert.doesNotThrow(()=>assertLocalMaterialIdentity(materialApproval(card,item),item,sha256Bytes(bytes)));}
  const selected={...result,assets:result.assets.map(item=>({...item,review:'approved_for_internal_eval_by_codex',reviewedAt:'2026-10-30'}))};
  const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:'fixture.json'}]};
  const prepared=prepareMaterialSelection(out,selected,topics,{readCard:()=>card});assert.deepEqual(prepared.map(item=>item.mediaType),['image/jpeg','image/webp']);
  const bad=structuredClone(selected);bad.assets[0].width=3;assert.throws(()=>prepareMaterialSelection(out,bad,topics,{readCard:()=>card}),/MATERIAL_IDENTITY_INVALID/);
  bad.assets[0]=structuredClone(selected.assets[0]);bad.assets[0].mediaType='image/png';assert.throws(()=>prepareMaterialSelection(out,bad,topics,{readCard:()=>card}),/MATERIAL_IDENTITY_INVALID/);
  bad.assets[0]=structuredClone(selected.assets[0]);bad.assets[0].review='pending_visual_selection';assert.throws(()=>prepareMaterialSelection(out,bad,topics,{readCard:()=>card}),/MATERIAL_REVIEW_REQUIRED/);
 }finally{rmSync(local,{recursive:true,force:true});rmSync(outputs,{recursive:true,force:true});}
});
