import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {completedReviewFilm,probeReviewRender} from '../../research/evals/probe-review-render.mjs';

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
