import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {probeReviewRender} from '../../../research/evals/probe-review-render.mjs';
import {filmFixture,pageOptions} from '../../../packages/film-runtime/test/fixture.mjs';
import platform from '../../../config/platform-presets.json' with {type:'json'};

test('paid-spec repro keeps generated music working and transports exact approved score bytes without rewriting the film',async t=>{
 const output=mkdtempSync(join(tmpdir(),'promobento-music-repro-'));t.after(()=>rmSync(output,{recursive:true,force:true}));
 const film=filmFixture(),text='X:1\nT:Original repro fixture\nM:4/4\nL:1/4\nQ:1/4=96\nK:C\nC D E F | G A B c |',bytes=new TextEncoder().encode(text);
 const externalMusic={kind:'score',scoreRef:'audio/fixture.abc',resourceId:'res_original_fixture',key:'evals/original.abc',sha256:sha256Bytes(bytes),byteLength:bytes.length,
  licenseRef:'LicenseRef-Original-Test',text,approvals:[{totalFrames:450,requestHash:digest({text,totalFrames:450})}]};
 const context={...pageOptions('landscape',platform.aspectLayouts.landscape),durationSeconds:15,runtimeVersion:'film-runtime-v1',rendererRelease:'fixture-release'};
 context.resources=context.resources.map(asset=>({...asset,key:'evals/fixture.png',sha256:'a'.repeat(64),byteLength:100}));
 const objects=new Map();let submitted;
 const json=async(path,{method='GET',body}={})=>{
  if(path.startsWith('objects/')){const key=path.slice(8);objects.set(key,body);return{key,sha256:sha256Bytes(body),byteLength:body.length};}
  if(path==='renders'&&method==='POST'){submitted=body;return null;}
  return{status:'passed',result_json:canonical({outputs:[]})};
 };
 const run=()=>probeReviewRender({receipt:{kind:'metered_model_response',callId:'paid-fixture',result:{text:canonical(film),toolCalls:[]}},context,operationId:'music-repro',prefix:'evals/music-repro',output,json,download:async()=>{},stopping:()=>false,
  ...(film.audio.music.kind==='score'?{externalMusic}:{})});
 await run();assert.equal(submitted.audioInputsBlobs.length,1);assert.equal(submitted.job.resources.length,context.resources.length);
 film.audio={music:{kind:'score',scoreRef:externalMusic.scoreRef},sfx:'auto',captions:'off',mute:false};
 await assert.rejects(probeReviewRender({receipt:{kind:'metered_model_response',result:{text:canonical(film),toolCalls:[]}},context,output}),/TRUSTED_BLOCK_GENERATED_AUDIO_REVIEW_REQUIRED/);
 await run();assert.deepEqual(parseCanonicalJson(objects.get('evals/music-repro/review-film.json')),film);
 assert.deepEqual(submitted.audioInputsBlobs[1],{name:'audio:music',key:externalMusic.key,sha256:externalMusic.sha256,byteLength:externalMusic.byteLength});
 assert.deepEqual(submitted.audioInputs.scores,[['music',text]]);assert.equal(submitted.audioInputs.clearedSources[0].requestHash,externalMusic.approvals[0].requestHash);
 assert.equal(submitted.job.resources.at(-1).kind,'audio');assert.equal(submitted.job.resources.at(-1).resourceId,externalMusic.resourceId);
 assert.equal(parseCanonicalJson(readFileSync(join(output,'review-render.json'))).status,'passed');
});
