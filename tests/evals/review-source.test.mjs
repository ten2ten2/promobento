import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import {pngRgba} from '@promobento/contracts/seams';
import {customFixture} from '../../packages/film-runtime/test/custom-fixture.mjs';
import {completedReviewFilm,probeReviewRender} from '../../research/evals/probe-review-render.mjs';
import {readAuthoredSnapshot,probeAuthoredFrames} from '../../research/evals/probe-authored-frames.mjs';

test('native review accepts the original paid tool contract and the actual completed C JSON, never partial output',()=>{
  const receipt=parseCanonicalJson(readFileSync(new URL('../../docs/evidence/2026-10-24-s1-director/minimax-seventh-attempt/spec-response.json',import.meta.url)));
  const actual=completedReviewFilm(receipt);
  assert.equal(actual.sourceKind,'completed_film_json');assert.equal(actual.film.specVersion,'film-v1');
  assert.equal(actual.film.style.palette.roles.bg,'#2f8cff');
  const original={kind:'metered_model_response',result:{toolCalls:[{name:'write_spec',input:{film:actual.film}}]}};
  assert.deepEqual(completedReviewFilm(original),{film:actual.film,sourceKind:'completed_write_spec'});
  assert.throws(()=>completedReviewFilm({...receipt,result:{...receipt.result,failure:'MODEL_OUTPUT_TRUNCATED'}}),/COMPLETED_FILM_RECEIPT_REQUIRED/);
  assert.throws(()=>completedReviewFilm({...original,result:{toolCalls:[{name:'write_spec',input:{film:actual.film,note:'extra'}}]}}),/COMPLETED_FILM_RECEIPT_REQUIRED/);
  assert.throws(()=>completedReviewFilm({...receipt,result:{...receipt.result,text:'{"kind":"fact_analysis"}'}}),/COMPLETED_FILM_RECEIPT_REQUIRED/);
});

test('authored frame recheck binds the original source, checks both aspects and refuses unverified assets',async()=>{
 mkdirSync('artifacts',{recursive:true});const root=mkdtempSync(resolve('artifacts/authored-probe-fixture-')),output=mkdtempSync(join(tmpdir(),'authored-probe-'));
 try{
  const{film,sources}=customFixture(),path='scenes/product/index.js';film.assets={dashboard:{resourceId:'res_fixture_dashboard'}};
  film.scenes[0].params.assetKeys=['dashboard'];film.scenes[0].params.assetChecks=[{frame:45,assetKeys:['dashboard']}];
  for(const hold of film.scenes[0].params.readingHolds)hold.visibleTextSlots=[];
  sources[path]=sources[path].replace('const w=','ctx.asset(\'dashboard\'); const w=');
  const hash=filmSourceHash(canonical(film),sources),receipt={kind:'metered_model_response',callId:'fixture-spec',quote:{usdMicros:10},result:{text:canonical(film),toolCalls:[]}},failure={kind:'custom_scene_check_failure',sourceHash:hash};
  mkdirSync(join(root,'scenes/product'),{recursive:true});writeFileSync(join(root,'film-receipt.json'),canonical(receipt));writeFileSync(join(root,'failure.json'),canonical(failure));writeFileSync(join(root,path),sources[path]);
  const snapshot=readAuthoredSnapshot(root);assert.equal(snapshot.failure.sourceHash,hash);
  writeFileSync(join(root,path),sources[path]+' ');assert.throws(()=>readAuthoredSnapshot(root),/AUTHORED_SNAPSHOT_IDENTITY_MISMATCH/);writeFileSync(join(root,path),sources[path]);
  const context={durationSeconds:15,aspects:['landscape','portrait'],seed:'fixture',runtimeVersion:'film-runtime-v1',rendererRelease:'fixture-release',fonts:[],confirmedFactIds:[],resources:[{resourceId:'res_fixture_dashboard',kind:'image',key:'evals/fixture/image.png',sha256:'a'.repeat(64),byteLength:10,width:10,height:10,licenseRef:'fixture'}]};
  const png=pngRgba(1,1,Uint8Array.from([20,30,40,255]));let studio,unverified=false,closed=0;
  const json=async(name,options)=>{
   if(name.startsWith('objects/'))return{key:name.slice(8),sha256:'a'.repeat(64),byteLength:options.body.length};
   if(name==='studio'){studio=options.body;return{};}
   const frame=Number(name.split('/').at(-1));return{frameIndex:frame,observation:{schemaVersion:'3.0.0',kind:'frame_observation',renderId:studio.job.renderId,aspectId:studio.job.aspectId,frame,texts:[],regions:[],findings:[],assets:[{sceneId:'product',resourceId:'res_fixture_dashboard',visibility:unverified?'unverified':'visible'}]}};
  };
  const call=async(name)=>{if(name.endsWith('/studio/close')){closed++;return new Response(null,{status:204});}return new Response(png);};
  const args={snapshot,context,operationId:'fixture-operation',prefix:'evals/fixture-operation',output,json,call};
  const report=await probeAuthoredFrames(args);assert.equal(report.status,'passed');assert.deepEqual(report.aspects.map(a=>a.aspect),['landscape','portrait']);assert.ok(report.aspects.every(a=>a.comparisons.some(c=>c.mode==='cold')));assert.equal(closed,4);
  unverified=true;await assert.rejects(probeAuthoredFrames(args),/CUSTOM_REQUIRED_ASSET_NOT_VISIBLE/);assert.equal(closed,5);
  assert.equal(parseCanonicalJson(readFileSync(join(output,'authored-frame-check.json'))).status,'failed');
 }finally{rmSync(root,{recursive:true,force:true});rmSync(output,{recursive:true,force:true});}
});

test('the final-only probe keeps the paid source and submits final quality while review callers retain their existing outputs',async()=>{
 const receipt=parseCanonicalJson(readFileSync(new URL('../../docs/evidence/2026-10-24-s1-director/minimax-seventh-attempt/spec-response.json',import.meta.url)));
 const context={durationSeconds:15,seed:'probe-case',runtimeVersion:'film-runtime-v1',rendererRelease:'probe-release',fonts:[],resources:[],confirmedFactIds:[]};
 for(const quality of ['review','final']){
  const output=mkdtempSync(join(tmpdir(),'promobento-film-probe-')),downloads=[];let input;
  try{
   const report=await probeReviewRender({receipt,context,operationId:'probe-case',prefix:'evals/probe-case',output,...(quality==='final'?{quality}:{}),
    stopping:()=>false,download:async(_ref,file)=>downloads.push(file),json:async(path,options)=>{
     if(path.startsWith('objects/'))return{key:path.slice(8),sha256:'a'.repeat(64),byteLength:options.body.length,mediaType:'application/json'};
     if(path==='renders'){input=options.body;return{};}
     return{status:'passed',result_json:canonical({outputs:[{key:'renders/probe/film.mp4'}]})};
    }});
   assert.equal(input.job.quality,quality);assert.equal(input.job.totalFrames,450);assert.equal(input.options.target.fps,30);
   assert.equal(report.sourceCallId,receipt.callId);assert.equal(report.sourceKind,'completed_film_json');assert.equal(report.status,'passed');
   assert.deepEqual(downloads,[quality+'-film.mp4']);
   assert.equal(parseCanonicalJson(readFileSync(join(output,quality+'-render.json'))).renderId,quality+'-probe-case');
  }finally{rmSync(output,{recursive:true,force:true});}
 }
});
