import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonical,parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {initializeProject,createWork,recordReview,acceptCandidate} from '../src/runner.mjs';
import {project,config,provider,mockRender,mockMethod,mockCapture} from './fixtures.mjs';
const raw=(directory,id)=>parseCanonicalJson(readFileSync(join(directory,'operations',id,'run.json')));
async function setup(t) {
  const directory=mkdtempSync(join(tmpdir(),'edit-evidence-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const p=project();await initializeProject({directory,project:p});
  const status=await createWork({directory,projectId:p.id,config:config(),operationId:'base',provider:provider(),render:mockRender,method:mockMethod});
  await recordReview({directory,operationId:'base',receipt:{reviewerId:'human',reviewedAt:new Date().toISOString(),subjectHash:status.subjectHash,decision:'allowed',policyVersion:'m0a-local-human-review-v1',evidenceRef:'UNIT MOCK',checks:{facts:true,rights:true,contentSafety:true,normalSpeedAudiovisual:true,silentReadability:true}}});
  await acceptCandidate({directory,operationId:'base',expectedRevisionId:null});
  return {directory,p,revision:status.selectedCandidateId,args:{directory,projectId:p.id,config:config(),kind:'agent_patch',render:mockRender,method:mockMethod,capture:mockCapture,
    comments:[{targetId:'tiktok:portrait',frameIndex:42,normalizedPoint:{x:.7,y:.3},comment:'Inspect this object, not the poster.',editScope:'shot'}]}};
}
test('non-keyframe patch gets exact saved frame and 2x detail before generation, with immutable identity',async t=>{
  const {directory,args,revision}=await setup(t);let request,captureRequest;
  const api=provider(),generate=api.generate;api.generate=async input=>{request=input;return generate(input);};
  await createWork({...args,operationId:'patch',expectedRevisionId:revision,provider:api,capture:async input=>{captureRequest=input;return mockCapture(input);}});
  const data=parseCanonicalJson(request.input),record=raw(directory,'patch');
  assert.equal(captureRequest.frameIndex,42);assert.deepEqual(captureRequest.point,{x01:.7,y01:.3});assert.equal(request.images.length,2);
  assert.equal(captureRequest.expectedMediaSha256,data.editEvidence[0].mediaSha256);
  assert.equal(data.editEvidence[0].revisionId,revision);assert.equal(data.editEvidence[0].frameIndex,42);assert.equal(data.editEvidence[0].detail.scale,2);
  assert.ok(data.editEvidence[0].full.sha256);assert.deepEqual(record.editEvidence,data.editEvidence);
  assert.ok(!JSON.stringify(record).includes('data:image')); // images are private files, not copied into status records
});
test('saved media reports larger than 4 MiB remain usable within the renderer observation budget',async t=>{
  const {directory,args}=await setup(t),target=raw(directory,'base').candidates[0].targets['tiktok:portrait'];
  const reportPath=join(directory,target.report),report=parseCanonicalJson(readFileSync(reportPath));
  const observations=Array.from({length:450},(_,frame)=>({frame,texts:Array.from({length:16},(_,index)=>({
    id:'label-'+index,text:'Test fixture '+index,fontId:'geist-sans-fixture',weight:600,fontSize:24,
    faces:[{fontId:'geist-sans-fixture',weight:600,sha256:'c'.repeat(64)}],
    bounds:{x:120,y:240+index*50,width:180,height:30},ink:{left:121,top:244+index*50,right:298,bottom:269+index*50},opacity:1,
  }))}));
  const observationBytes=observations.reduce((sum,frame)=>sum+Buffer.byteLength(canonical(frame)),0),maxObservationBytes=16*1024*1024;
  assert.ok(observationBytes<maxObservationBytes);
  report.capture.media={observations,observationBytes,maxObservationBytes};
  const bytes=JSON.stringify(report,null,2)+'\n'; // Match the trusted renderer's pretty-printed report.
  assert.ok(Buffer.byteLength(bytes)>4*1024*1024);assert.ok(Buffer.byteLength(bytes)<64*1024*1024);
  writeFileSync(reportPath,bytes);
  let request;const api=provider(),generate=api.generate;api.generate=async input=>{request=input;return generate(input);};
  const result=await createWork({...args,operationId:'large-report',provider:api});
  assert.equal(result.state,'awaiting_user');assert.equal(result.phase,'output_review');assert.equal(request.images.length,2);
  assert.equal(parseCanonicalJson(request.input).editEvidence[0].qaInputHash,target.qaInputHash);
});
test('stale requested revision, missing media and replaced bytes block before any model call',async t=>{
  const {directory,args}=await setup(t);let called=0;const api={id:'mock',generate:async()=>{called++;throw Error('SHOULD_NOT_CALL');}};
  await assert.rejects(createWork({...args,operationId:'stale',expectedRevisionId:'old-revision',provider:api}),/BASE_CONFLICT/);
  const target=Object.values(raw(directory,'base').candidates[0].targets)[0],path=join(directory,target.media),bytes=readFileSync(path);
  writeFileSync(path,'replaced media');await assert.rejects(createWork({...args,operationId:'replaced',provider:api}),/EVIDENCE_IDENTITY/);
  unlinkSync(path);await assert.rejects(createWork({...args,operationId:'missing',provider:api}),/ENOENT/);
  const outside=join(directory,'outside.mp4');writeFileSync(outside,bytes);symlinkSync(outside,path);
  await assert.rejects(createWork({...args,operationId:'symlink',provider:api}),/EVIDENCE_PATH/);assert.equal(called,0);
});
test('untrusted screenshot ID never selects a file and corrupted capture metadata is rejected',async t=>{
  const {args}=await setup(t);let called=0;
  await assert.rejects(createWork({...args,operationId:'bad-capture',comments:[{...args.comments[0],screenshotAssetId:'another-users-file'}],
    provider:{id:'mock',generate:async()=>{called++;}},capture:async input=>{const result=await mockCapture(input);result.frameIndex=0;return result;}}),/EVIDENCE_IDENTITY/);
  assert.equal(called,0);
});
