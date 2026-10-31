import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';import {sha256Bytes} from '@promobento/contracts/digest';import {openVideoFramePack} from '@promobento/contracts/video-frames';
import {captureApprovedLocalVideo,captureApprovedWebVideo,verifyVideoSelections,extractVideo} from './approved-video.mjs';import {prepareMaterialSelection} from './prepare-material-selection.mjs';
async function syntheticVideo(){let browser;try{
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,chromiumSandbox:true});const page=await browser.newPage();
 const data=await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=64;const ctx=canvas.getContext('2d'),stream=canvas.captureStream(10),chunks=[];
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};const stopped=new Promise(resolve=>recorder.onstop=resolve);recorder.start();
  for(let i=0;i<22;i++){ctx.fillStyle=i<11?'#16c930':'#1640e0';ctx.fillRect(0,0,96,64);await new Promise(resolve=>setTimeout(resolve,100));}
  recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());return Array.from(new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer()));});return Buffer.from(data);
 }finally{await browser?.close();}}
const entry={id:'fixture-video',sourceFile:'test.webm',sourceUrl:'local://fixture',description:'Synthetic footage.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-video'};
test('QuickTime intake checks exact approval and bytes before decoding or download',async()=>{
 const root=mkdtempSync(resolve('artifacts/.quicktime-approval-test-'));
 try{
  const sourceDir=join(root,'source');mkdirSync(sourceDir);writeFileSync(join(sourceDir,'test.mov'),Buffer.from('different bytes'));
  const movEntry={...entry,sourceFile:'test.mov'},approval={status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Original synthetic test.',sourceFile:'test.mov',sourceUrl:'local://fixture',sha256:'a'.repeat(64)};
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}],materialApprovals:{'fixture-video':approval}};
  await assert.rejects(captureApprovedLocalVideo({sourceDir,outputDir:join(root,'out'),card,entries:[movEntry]}),/VIDEO_SOURCE_IDENTITY_MISMATCH/);
  const sourceUrl='https://example.com/product',videoUrl='https://cdn.example.com/demo.mov',web={...card,assetSources:[{kind:'official_product_page',url:sourceUrl}],materialApprovals:{'fixture-video':{...approval,sourceUrl,videoUrl}}};
  let calls=0;const download=async()=>{calls++;return Buffer.from('different bytes');};
  await assert.rejects(captureApprovedWebVideo({outputDir:join(root,'denied'),card:{...web,materialApprovals:{}},entries:[{...movEntry,sourceUrl,videoUrl}],download}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);assert.equal(calls,0);
  await assert.rejects(captureApprovedWebVideo({outputDir:join(root,'web'),card:web,entries:[{...movEntry,sourceUrl,videoUrl}],download}),/VIDEO_SOURCE_IDENTITY_MISMATCH/);assert.equal(calls,1);
  await assert.rejects(extractVideo({page:{evaluate(){throw Error('UNEXPECTED_DECODE');}},version:'151.0.0.0'},Buffer.from('not a movie'),'video/quicktime'),/VIDEO_SOURCE_FORMAT_INVALID/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('approved video becomes reproducible 30 fps frames and a source-bound manifest',async()=>{
 const root=mkdtempSync(resolve('artifacts/.approved-video-test-'));
 try{const sourceDir=join(root,'source');mkdirSync(sourceDir);const source=await syntheticVideo();writeFileSync(join(sourceDir,'test.webm'),source);
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}],
   materialApprovals:{'fixture-video':{status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Original synthetic test.',sourceFile:'test.webm',sourceUrl:'local://fixture',sha256:sha256Bytes(source)}}};
  const denied=join(root,'denied');await assert.rejects(captureApprovedLocalVideo({sourceDir,outputDir:denied,card:{...card,materialApprovals:{}},entries:[entry]}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);assert.equal(existsSync(denied),false);
  const output=join(root,'out'),selected=await captureApprovedLocalVideo({sourceDir,outputDir:output,card,entries:[entry]});assert.equal(selected.assets[0].review,'pending_visual_selection');
  const cardPath=join(root,'card.json');writeFileSync(cardPath,JSON.stringify(card));const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:cardPath}]};
  await assert.rejects(verifyVideoSelections(output,selected,topics),/MATERIAL_REVIEW_REQUIRED/);
  const reviewed=structuredClone(selected);reviewed.assets[0].review='approved_for_internal_eval_by_codex';reviewed.assets[0].reviewedAt='2026-10-31';
  const verified=await verifyVideoSelections(output,reviewed,topics),video=verified.get('fixture-video');assert.ok(video.manifest.frames.length>=46);assert.deepEqual([video.manifest.width,video.manifest.height],[96,64]);
  const first=video.manifest.frames[0],last=video.manifest.frames.at(-1),firstPack=openVideoFramePack(video.manifest,first.pack,video.packs[first.pack]),lastPack=openVideoFramePack(video.manifest,last.pack,video.packs[last.pack]);
  assert.notDeepEqual(firstPack.frame(first.index),lastPack.frame(last.index));
  assert.throws(()=>prepareMaterialSelection(output,reviewed,topics,{readCard:()=>card}),/VIDEO_VERIFICATION_REQUIRED/);
  const prepared=prepareMaterialSelection(output,reviewed,topics,{readCard:()=>card,verifiedVideos:verified});assert.equal(prepared[0].sha256,sha256Bytes(video.manifestBytes));assert.equal(prepared[0].video.manifest.source.sha256,sha256Bytes(source));
  const packPath=join(output,reviewed.assets[0].derivation.packFiles[0]),pack=readFileSync(packPath);pack[0]^=1;writeFileSync(packPath,pack);
  await assert.rejects(verifyVideoSelections(output,reviewed,topics),/VIDEO_DERIVATION_MISMATCH/);
  const sourceUrl='https://example.com/product',videoUrl='https://cdn.example.com/demo.webm',webCard={...card,assetSources:[{kind:'official_product_page',url:sourceUrl}],materialApprovals:{'fixture-video':{...card.materialApprovals['fixture-video'],sourceUrl,videoUrl}}};
  const webEntry={...entry,sourceFile:undefined,sourceUrl,videoUrl};let calls=0;
  const download=async(url,options)=>{calls++;assert.equal(url,videoUrl);assert.equal(options.maxBytes,50<<20);assert.match(options.accept,/video/);return source;};
  await assert.rejects(captureApprovedWebVideo({outputDir:join(root,'web-denied'),card:webCard,entries:[webEntry,{...webEntry,id:'unapproved',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/unapproved'}],download}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);assert.equal(calls,0);
  await assert.rejects(captureApprovedWebVideo({outputDir:join(root,'web-bad'),card:webCard,entries:[webEntry],download:async()=>Buffer.from('changed')}),/VIDEO_SOURCE_IDENTITY_MISMATCH/);
  const webOutput=join(root,'web'),webSelected=await captureApprovedWebVideo({outputDir:webOutput,card:webCard,entries:[webEntry],download});assert.equal(calls,1);assert.equal(webSelected.assets[0].review,'pending_visual_selection');
  writeFileSync(cardPath,JSON.stringify(webCard));webSelected.assets[0].review='approved_for_internal_eval_by_codex';webSelected.assets[0].reviewedAt='2026-10-31';
  const webVerified=await verifyVideoSelections(webOutput,webSelected,topics),webPrepared=prepareMaterialSelection(webOutput,webSelected,topics,{readCard:()=>webCard,verifiedVideos:webVerified});
  assert.equal(webPrepared[0].video.manifest.source.sha256,sha256Bytes(source));
  const changed=structuredClone(webSelected);changed.assets[0].videoUrl='https://cdn.example.com/other.webm';assert.throws(()=>prepareMaterialSelection(webOutput,changed,topics,{readCard:()=>webCard,verifiedVideos:webVerified}),/VIDEO_VERIFICATION_REQUIRED/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
