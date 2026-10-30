import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pngRgba} from '@promobento/contracts/seams';
import {sha256Bytes} from '@promobento/contracts/digest';
import {captureApprovedLocal} from './capture-local-materials.mjs';
import {assertLocalMaterialIdentity,materialApproval} from './material-approval.mjs';

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
  assert.equal(JSON.parse(readFileSync(join(output,'selected.json'))).assets[0].width,2);assert.throws(()=>captureApprovedLocal({sourceDir:source,outputDir:output,card,entries:[entry]}),/NEW_PRIVATE_OUTPUT_REQUIRED/);
 }finally{rmSync(local,{recursive:true,force:true});rmSync(outputs,{recursive:true,force:true});}
});
