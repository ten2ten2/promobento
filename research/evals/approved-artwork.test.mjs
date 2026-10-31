import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pngPixels,pngRgba} from '@promobento/contracts/seams';
import {sha256Bytes} from '@promobento/contracts/digest';
import {captureApprovedArtwork,captureApprovedWebArtwork,captureApprovedInlineArtwork,verifyArtworkSelections,artworkSourceObjectName,extractIcnsPng} from './approved-artwork.mjs';
import {prepareMaterialSelection} from './prepare-material-selection.mjs';

const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="40" height="30" fill="#22aa44"/><circle cx="20" cy="15" r="8" fill="#ffcc22"/></svg>');
function icon(){const png=pngRgba(2,3,Uint8Array.from({length:24},(_,i)=>i%4===3?255:60));const head=Buffer.alloc(22);head.writeUInt16LE(1,2);head.writeUInt16LE(1,4);head[6]=2;head[7]=3;head.writeUInt16LE(1,10);head.writeUInt16LE(32,12);head.writeUInt32LE(png.length,14);head.writeUInt32LE(22,18);return Buffer.concat([head,png]);}
const approval=(sourceFile,bytes)=>({status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Approved synthetic artwork.',sourceFile,sourceUrl:'local://fixture',sha256:sha256Bytes(bytes)});
const entry=(id,sourceFile)=>({id,sourceFile,sourceUrl:'local://fixture',description:'Synthetic cleared artwork.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/'+id});

test('inline SVG requires exact source and selector approval before any page request',async()=>{
 const root=mkdtempSync(resolve('artifacts/.inline-approval-test-'));let calls=0;
 try{
  const sourceUrl='https://example.com/product',selector='#mark',asset={id:'fixture-inline',sourceUrl,selector,description:'Synthetic logo.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-inline'};
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'official_product_page',url:sourceUrl}],materialApprovals:{}};
  const download=async()=>{calls++;throw Error('UNEXPECTED_DOWNLOAD');};
  await assert.rejects(captureApprovedInlineArtwork({outputDir:join(root,'denied'),card,entries:[asset],download}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);
  card.materialApprovals[asset.id]={status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Approved synthetic logo.',sourceUrl,selector,sha256:'a'.repeat(64)};
  await assert.rejects(captureApprovedInlineArtwork({outputDir:join(root,'wrong'),card,entries:[{...asset,selector:'#other'}],download}),/ARTWORK_APPROVAL_IDENTITY_MISMATCH/);
  await assert.rejects(captureApprovedInlineArtwork({outputDir:join(root,'complex'),card,entries:[{...asset,selector:'svg:has(rect)'}],download}),/ARTWORK_SELECTION_INVALID/);
  assert.equal(calls,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('extensionless web artwork requires an explicitly approved media type before download',async()=>{
 const root=mkdtempSync(resolve('artifacts/.web-artwork-type-test-'));let calls=0;
 try{
  const sourceUrl='https://example.com/product',imageUrl='https://example.com/brand',sourceMediaType='image/svg+xml';
  const asset={id:'fixture-mark',sourceUrl,imageUrl,sourceMediaType,description:'Synthetic logo.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-mark'};
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'official_product_page',url:sourceUrl}],
   materialApprovals:{'fixture-mark':{status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Approved synthetic logo.',sourceUrl,imageUrl,sha256:sha256Bytes(svg)}}};
  const download=async()=>{calls++;throw Error('UNEXPECTED_DOWNLOAD');};
  await assert.rejects(captureApprovedWebArtwork({outputDir:join(root,'no-type'),card,entries:[{...asset,sourceMediaType:undefined}],download}),/ARTWORK_KIND_UNSUPPORTED/);
  await assert.rejects(captureApprovedWebArtwork({outputDir:join(root,'unapproved-type'),card,entries:[asset],download}),/ARTWORK_APPROVAL_IDENTITY_MISMATCH/);
  await assert.rejects(captureApprovedWebArtwork({outputDir:join(root,'wrong-extension'),card,entries:[{...asset,imageUrl:imageUrl+'.svg',sourceMediaType:'image/gif'}],download}),/ARTWORK_KIND_UNSUPPORTED/);
  card.materialApprovals['fixture-mark'].sourceMediaType='image/gif';
  await assert.rejects(captureApprovedWebArtwork({outputDir:join(root,'wrong-approval'),card,entries:[asset],download}),/ARTWORK_APPROVAL_IDENTITY_MISMATCH/);
  assert.equal(calls,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('ICNS keeps the largest static embedded PNG and rejects malformed containers',()=>{
 const png=(size,color)=>Buffer.from(pngRgba(size,size,Uint8Array.from({length:size*size*4},(_,i)=>i%4===3?255:color)));
 const chunk=(type,bytes)=>{const head=Buffer.alloc(8);head.write(type);head.writeUInt32BE(bytes.length+8,4);return Buffer.concat([head,bytes]);};
 const small=png(2,20),large=png(4,80),body=Buffer.concat([chunk('ic07',small),chunk('ic08',large)]),header=Buffer.alloc(8);
 header.write('icns');header.writeUInt32BE(body.length+8,4);const source=Buffer.concat([header,body]);
 assert.deepEqual(extractIcnsPng(source),large);
 assert.equal(artworkSourceObjectName({id:'fixture-icon',derivation:{sourceMediaType:'image/icns'}}),'fixture-icon-source.icns');
 const bad=Buffer.from(source);bad.writeUInt32BE(bad.length+1,4);assert.throws(()=>extractIcnsPng(bad),/ARTWORK_ICNS_INVALID/);
 const broken=Buffer.from(source);broken.writeUInt32BE(0,12);assert.throws(()=>extractIcnsPng(broken),/ARTWORK_ICNS_INVALID/);
 const unsupported=Buffer.concat([header,chunk('ic07',Buffer.from('not png'))]);unsupported.writeUInt32BE(unsupported.length,4);
 assert.throws(()=>extractIcnsPng(unsupported),/ARTWORK_ICNS_UNSUPPORTED/);
});

test('GIF and AVIF sources retain their original format',()=>{
 for(const type of ['image/gif','image/avif']){
  assert.equal(artworkSourceObjectName({id:'fixture-art',derivation:{sourceMediaType:type}}),'fixture-art-source.'+type.split('/')[1]);
 }
});

test('approved SVG and icon are rasterized in isolated Chrome and re-created before ingestion',async()=>{
 const root=mkdtempSync(resolve('artifacts/.artwork-test-'));
 try{
  const source=join(root,'source');mkdirSync(source);const ico=icon();writeFileSync(join(source,'mark.svg'),svg);writeFileSync(join(source,'favicon.ico'),ico);
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}],
   materialApprovals:{'fixture-mark':approval('mark.svg',svg),'fixture-icon':approval('favicon.ico',ico)}};
  const entries=[entry('fixture-mark','mark.svg'),entry('fixture-icon','favicon.ico')],denied=join(root,'denied');
  await assert.rejects(captureApprovedArtwork({sourceDir:source,outputDir:denied,card,entries:[entries[0],{...entries[1],id:'unapproved-icon',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/unapproved-icon'}]}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);assert.equal(existsSync(denied),false);
  const output=join(root,'output'),result=await captureApprovedArtwork({sourceDir:source,outputDir:output,card,entries});
  assert.deepEqual(result.assets.map(a=>[a.width,a.height,a.review]),[[40,30,'pending_visual_selection'],[2,3,'pending_visual_selection']]);
  assert.deepEqual(readFileSync(join(output,'fixture-mark.source.svg')),svg);assert.deepEqual(readFileSync(join(output,'fixture-icon.source.ico')),ico);
  const cardPath=join(root,'card.json');writeFileSync(cardPath,JSON.stringify(card));const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:cardPath}]};
  await assert.rejects(verifyArtworkSelections(output,result,topics),/MATERIAL_REVIEW_REQUIRED/);
  const reviewed=structuredClone(result);for(const asset of reviewed.assets){asset.review='approved_for_internal_eval_by_codex';asset.reviewedAt='2026-10-31';}
  const verified=await verifyArtworkSelections(output,reviewed,topics);assert.equal(verified.size,2);
  assert.deepEqual(reviewed.assets.map(artworkSourceObjectName),['fixture-mark-source.svg','fixture-icon-source.ico']);
  for(const asset of reviewed.assets)assert.match('evals/materials-fixture/fixture/'+artworkSourceObjectName(asset),/^evals\/[A-Za-z0-9_/-]{4,240}\.[a-z0-9]{2,8}$/);
  assert.throws(()=>prepareMaterialSelection(output,reviewed,topics,{readCard:()=>card}),/ARTWORK_VERIFICATION_REQUIRED/);
  const prepared=prepareMaterialSelection(output,reviewed,topics,{readCard:()=>card,verifiedArtwork:verified});assert.equal(prepared.length,2);assert.equal(prepared[0].artwork.sourceMediaType,'image/svg+xml');
  const changedCard=structuredClone(card);changedCard.materialApprovals['fixture-mark'].sha256='0'.repeat(64);
  assert.throws(()=>prepareMaterialSelection(output,reviewed,topics,{readCard:()=>changedCard,verifiedArtwork:verified}),/ARTWORK_VERIFICATION_REQUIRED/);
  const mark=join(output,'fixture-mark.png'),original=readFileSync(mark);writeFileSync(mark,Buffer.concat([original,Buffer.from('tampered')]));
  await assert.rejects(verifyArtworkSelections(output,reviewed,topics),/ARTWORK_DERIVATION_MISMATCH/);writeFileSync(mark,original);
  const changed=structuredClone(reviewed);changed.assets[0].derivation.chromeVersion='0.0.0.0';await assert.rejects(verifyArtworkSelections(output,changed,topics),/ARTWORK_RENDERER_CHANGED/);
  writeFileSync(join(output,'fixture-mark.source.svg'),Buffer.from('tampered'));await assert.rejects(verifyArtworkSelections(output,reviewed,topics),/ARTWORK_APPROVAL_IDENTITY_MISMATCH/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('approved SVG must still reject active and externally linked markup',async()=>{
 const root=mkdtempSync(resolve('artifacts/.artwork-unsafe-test-'));
 try{const source=join(root,'source');mkdirSync(source);
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}],materialApprovals:{}};
  for(const bad of ['<script>alert(1)</script>','<image href="https://example.com/private.png"/>','<rect onload="alert(1)"/>','<rect fill="url(https://example.com/a)"/>','<text>unlicensed font</text>']){
   const bytes=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'+bad+'</svg>');writeFileSync(join(source,'bad.svg'),bytes);card.materialApprovals['fixture-bad']=approval('bad.svg',bytes);
   await assert.rejects(captureApprovedArtwork({sourceDir:source,outputDir:join(root,'output'),card,entries:[entry('fixture-bad','bad.svg')]}),/ARTWORK_SVG_UNSUPPORTED/);assert.equal(existsSync(join(root,'output')),false);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('approved SVG uses bounded local symbols, never external or recursive references',async()=>{
 const root=mkdtempSync(resolve('artifacts/.artwork-symbol-test-'));
 try{const source=join(root,'source');mkdirSync(source);
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}],materialApprovals:{}};
  const render=async(inner,output)=>{const bytes=Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="30">${inner}</svg>`);
   writeFileSync(join(source,'mark.svg'),bytes);card.materialApprovals['fixture-mark']=approval('mark.svg',bytes);
   return captureApprovedArtwork({sourceDir:source,outputDir:join(root,output),card,entries:[entry('fixture-mark','mark.svg')]});};
  await render('<defs><symbol id="mark" viewBox="0 0 10 10"><rect width="10" height="10" fill="#22aa44"/></symbol></defs><use xlink:href="#mark" width="20" height="20"/>','ok');
  const {width,pixels}=pngPixels(readFileSync(join(root,'ok','fixture-mark.png'))),offset=(5*width+5)*4;
  assert.deepEqual([...pixels.slice(offset,offset+4)],[34,170,68,255]);
  for(const [i,inner] of [
   '<use href="https://example.com/icon.svg#mark"/>',
   '<use href="#missing"/>',
   '<defs><g id="loop"><use href="#loop"/></g></defs><use href="#loop"/>',
   '<defs><g id="mark"/><g id="mark"/></defs><use href="#mark"/>',
   '<defs><g id="mark"/></defs><use href="#mark" xlink:href="#mark"/>',
   '<defs><g id="mark"><use href="#other"/></g><g id="other"/></defs><use href="#mark"/>',
   '<defs><g id="mark">'+'<path d="M0 0"/>'.repeat(100)+'</g></defs>'+'<use href="#mark"/>'.repeat(100)
  ].entries())await assert.rejects(render(inner,'bad-'+i),/ARTWORK_SVG_UNSUPPORTED/);
 }finally{rmSync(root,{recursive:true,force:true});}
});


test('web SVG is fetched only after exact source approval and revalidated before ingestion',async()=>{
 const root=mkdtempSync(resolve('artifacts/.web-artwork-test-'));let calls=0;
 try{const sourceUrl='https://example.com/product',imageUrl='https://cdn.example.com/logo.svg';
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'official_product_page',url:sourceUrl}],materialApprovals:{'fixture-mark':{status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Approved synthetic web artwork.',sourceUrl,imageUrl,sha256:sha256Bytes(svg)}}};
  const item={id:'fixture-mark',sourceUrl,imageUrl,description:'Approved synthetic SVG.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-mark'};
  const iconUrl='https://cdn.example.com/favicon.ico',ico=icon(),iconItem={...item,id:'fixture-icon',imageUrl:iconUrl,description:'Approved synthetic icon.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-icon'};
  card.materialApprovals['fixture-icon']={...card.materialApprovals['fixture-mark'],imageUrl:iconUrl,sha256:sha256Bytes(ico)};
  const download=async(url,options)=>{calls++;assert.match(options.accept,/svg/);if(url===imageUrl)return svg;assert.equal(url,iconUrl);return ico;};
  await assert.rejects(captureApprovedWebArtwork({outputDir:join(root,'denied'),card,entries:[item,{...item,id:'unapproved',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/unapproved'}],download}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);assert.equal(calls,0);
  await assert.rejects(captureApprovedWebArtwork({outputDir:join(root,'bad'),card,entries:[item],download:async()=>Buffer.from('changed')}),/ARTWORK_APPROVAL_IDENTITY_MISMATCH/);
  const out=join(root,'out'),selected=await captureApprovedWebArtwork({outputDir:out,card,entries:[item,iconItem],download});assert.equal(calls,2);assert.deepEqual(selected.assets.map(asset=>asset.review),['pending_visual_selection','pending_visual_selection']);
  const cardPath=join(root,'card.json');writeFileSync(cardPath,JSON.stringify(card));const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:cardPath}]},reviewed=structuredClone(selected);
  for(const asset of reviewed.assets){asset.review='approved_for_internal_eval_by_codex';asset.reviewedAt='2026-10-31';}const verified=await verifyArtworkSelections(out,reviewed,topics);
  assert.deepEqual(prepareMaterialSelection(out,reviewed,topics,{readCard:()=>card,verifiedArtwork:verified}).map(item=>item.artwork.sourceMediaType),['image/svg+xml','image/x-icon']);
  const changed=structuredClone(reviewed);changed.assets[0].imageUrl='https://cdn.example.com/other.svg';assert.throws(()=>prepareMaterialSelection(out,changed,topics,{readCard:()=>card,verifiedArtwork:verified}),/ARTWORK_VERIFICATION_REQUIRED/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
