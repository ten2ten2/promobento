import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {pngRgba} from '@promobento/contracts/seams';
import {sha256Bytes} from '@promobento/contracts/digest';
import {captureApprovedWebImages,downloadApprovedImage} from './capture-approved-web-images.mjs';
import {prepareMaterialSelection} from './prepare-material-selection.mjs';

const png=pngRgba(2,3,new Uint8Array(2*3*4)),sha=sha256Bytes(png);
const sourceUrl='https://example.com/product',imageUrl='https://cdn.example.com/product.png';
const entry={id:'fixture-screen',sourceUrl,imageUrl,description:'Approved screenshot.',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/fixture-screen'};
const card=()=>({topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},
 assetSources:[{kind:'official_product_page',url:sourceUrl}],materialApprovals:{'fixture-screen':{status:'approved',approvedBy:'owner',scope:'internal_eval_only',storage:'staging_R2',publicUseCleared:false,approvedOn:'2026-10-31',basis:'Owner-approved synthetic fixture.',sourceUrl,imageUrl,sha256:sha}}});

test('web collection checks every approval before fetching, preserves approved bytes and requires visual review',async()=>{
 const root=mkdtempSync(resolve('artifacts/.web-capture-test-'));let requests=0;
 const download=async url=>{requests++;assert.equal(url,imageUrl);return png;};
 try{
  const denied=join(root,'denied');await assert.rejects(captureApprovedWebImages({outputDir:denied,card:card(),entries:[entry,{...entry,id:'second-unapproved',approvalRef:'research/evals/fact-cards/fixture.json#/materialApprovals/second-unapproved'}],download}),/MATERIAL_EXPLICIT_APPROVAL_REQUIRED/);
  assert.equal(requests,0);assert.equal(existsSync(denied),false);
  for(const bad of ['http://example.com/x','https://user@example.com/x','https://127.0.0.1/x','https://example.com/x#fragment','https://example.com/x?token=secret']){
   await assert.rejects(captureApprovedWebImages({outputDir:join(root,'bad'),card:card(),entries:[{...entry,imageUrl:bad}],download}),/WEB_MATERIAL_URL_INVALID/);assert.equal(requests,0);
  }
  const mismatch=join(root,'mismatch');await assert.rejects(captureApprovedWebImages({outputDir:mismatch,card:card(),entries:[entry],download:async()=>Buffer.from('changed')}),/WEB_MATERIAL_IDENTITY_MISMATCH/);assert.equal(existsSync(mismatch),false);
  const output=join(root,'accepted'),result=await captureApprovedWebImages({outputDir:output,card:card(),entries:[entry],download});
  assert.equal(requests,1);assert.deepEqual(readFileSync(join(output,'fixture-screen.png')),png);assert.deepEqual([result.assets[0].width,result.assets[0].height],[2,3]);
  assert.equal(result.assets[0].review,'pending_visual_selection');
  const topics={factConfirmation:{confirmedBy:'owner'},topics:[{id:'fixture',factCard:'fixture.json'}]};
  assert.throws(()=>prepareMaterialSelection(output,result,topics,{readCard:card}),/MATERIAL_REVIEW_REQUIRED/);
  const reviewed=structuredClone(result);reviewed.assets[0].review='approved_for_internal_eval_by_codex';reviewed.assets[0].reviewedAt='2026-10-31';
  assert.equal(prepareMaterialSelection(output,reviewed,topics,{readCard:card})[0].sha256,sha);
  for(const mutate of [asset=>{asset.imageUrl='https://cdn.example.com/other.png';},asset=>{delete asset.derivation;},asset=>{asset.sourceUrl='https://example.com/other';}]){
   const changed=structuredClone(reviewed);mutate(changed.assets[0]);assert.throws(()=>prepareMaterialSelection(output,changed,topics,{readCard:card}),/WEB_MATERIAL_IDENTITY_MISMATCH|MATERIAL_SOURCE_INVALID/);
  }
  await assert.rejects(captureApprovedWebImages({outputDir:output,card:card(),entries:[entry],download}),/NEW_PRIVATE_OUTPUT_REQUIRED/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the actual downloader rejects non-HTTPS and literal network addresses before DNS',async()=>{
 for(const url of ['http://example.com/x','https://localhost/x','https://[::1]/x','https://169.254.169.254/x'])await assert.rejects(downloadApprovedImage(url),/WEB_MATERIAL_URL_INVALID/);
});


test('downloader pins public DNS and refuses redirects, private addresses and oversized responses',async()=>{
 const publicDns=async()=>[{address:'93.184.216.34',family:4}];let calls=0;
 const responder=(status,body,headers={})=>(url,options,callback)=>{
  calls++;assert.equal(url.href,imageUrl);assert.equal(options.method,'GET');
  options.lookup('cdn.example.com',{all:true},(error,records)=>{assert.ifError(error);assert.deepEqual(records,[{address:'93.184.216.34',family:4}]);});
  const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=new PassThrough();res.statusCode=status;res.headers=headers;res.on('close',()=>req.emit('close'));callback(res);res.end(body);});req.destroy=error=>req.emit('error',error);req.on('error',()=>req.emit('close'));req.on('close',()=>{});return req;
 };
 assert.deepEqual(await downloadApprovedImage(imageUrl,{resolveAddress:publicDns,makeRequest:responder(200,png)}),png);
 await assert.rejects(downloadApprovedImage(imageUrl,{resolveAddress:publicDns,makeRequest:responder(302,Buffer.alloc(0))}),/WEB_MATERIAL_HTTP_302/);
 await assert.rejects(downloadApprovedImage(imageUrl,{resolveAddress:publicDns,makeRequest:responder(200,Buffer.alloc(0),{'content-length':String((1<<20)+1)})}),/DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED/);
 await assert.rejects(downloadApprovedImage(imageUrl,{resolveAddress:publicDns,makeRequest:responder(200,Buffer.alloc((1<<20)+1))}),/DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED/);
 for(const address of [{address:'127.0.0.1',family:4},{address:'10.1.2.3',family:4},{address:'169.254.169.254',family:4},{address:'::ffff:127.0.0.1',family:6},{address:'2001:db8::1',family:6}])
  await assert.rejects(downloadApprovedImage(imageUrl,{resolveAddress:async()=>[address],makeRequest:()=>{throw Error('UNEXPECTED_REQUEST');}}),/WEB_MATERIAL_ADDRESS_INVALID/);
 assert.equal(calls,4);
});
