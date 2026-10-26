import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {admitDirectorAudio,directorAudio} from '../src/director-audio.ts';
import {commitCandidate,commitReviewDraft,failDirector,dispatchDirectorFailure,dispatchDirectorProgress} from '../src/director-recovery.ts';
import {immutableJson} from '../src/store.ts';
import {sqliteD1} from './fixtures/sqlite.mjs';
import {memoryMedia} from './fixtures/media.mjs';
import {filmFixture} from '../../../packages/film-runtime/test/fixture.mjs';
import {synthesizePlan} from '../../../packages/audio/src/index.mjs';
import {deriveAudioPlan} from '../../../packages/audio/src/plan.mjs';

function fixture(t){
 const{db,DB}=sqliteD1();t.after(()=>db.close());const{objects,MEDIA}=memoryMedia();
 const op={id:'audio-operation',workspace_id:'workspace',project_id:'project',generation:0,purpose:'evaluation',status:'active',max_micros:1000000};
 db.prepare('INSERT INTO pipeline_operations VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(op.id,op.workspace_id,op.project_id,0,op.purpose,op.status,'request',op.max_micros,Date.now(),null,null);
 const env={DB,MEDIA,SHARDS:{getByName(){return{async stopAndSettle(){}};}},OPERATIONS:{getByName(){return{async closeStudio(){},async progress(){throw Error('NOTICE_UNAVAILABLE');}};}}};
 const register=async(kind,bytes,approvals)=>{
  const resourceId=kind==='score'?'res_original_score':'res_original_wav',sha256=sha256Bytes(bytes),key=`evals/audio/${kind==='score'?'original.abc':'original.wav'}`;
  objects.set(key,{bytes,customMetadata:{sha256}});
  const source={kind,resourceId,sha256,key,byteLength:bytes.length,...(kind==='score'?{scoreRef:'audio/original.abc'}:{})};
  const evidence={kind:'audio_source_rights',operationId:op.id,resourceId,sha256,licenseRef:'LicenseRef-Original-Test',scope:'internal_eval_only',approvedBy:'owner',source:'Original test fixture',basis:'No third-party notes or recording.',...(approvals?{scoreApprovals:approvals}:{})};
  const record=await immutableJson(env,`evals/audio/${kind}-rights.json`,evidence);
  db.prepare('INSERT INTO pipeline_rights VALUES(?,?,?,?,?,?,?)').run(op.id,resourceId,sha256,evidence.licenseRef,record.key,evidence.scope,null);
  return source;
 };
 return{db,env,op,objects,register};
}
const score='X:1\nT:Original fixture\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC E G c | G E D C |';
const encode=text=>new TextEncoder().encode(text);
const approval=totalFrames=>({totalFrames,requestHash:digest({text:score,totalFrames})});
function wav(frames){
 const b=Buffer.alloc(44+frames*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);
 b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(48000,24);b.writeUInt32LE(96000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(frames*2,40);
 for(let i=0;i<frames;i++)b.writeInt16LE(Math.round(1000*Math.sin(i*2*Math.PI*440/48000)),44+i*2);
 return new Uint8Array(b);
}

test('trusted score approval binds exact bytes and duration through real synthesis, without implicit self-clearance',async t=>{
 const{env,op,db,register}=fixture(t),source=await register('score',encode(score),[approval(450)]);
 let reads=0;const get=env.MEDIA.get;env.MEDIA.get=async key=>{if(key===source.key)reads++;return get(key);};
 db.prepare('UPDATE pipeline_rights SET revoked_at=1').run();
 await assert.rejects(admitDirectorAudio(env,op,[source]),/ASSET_RIGHTS_PENDING/);assert.equal(reads,0);
 db.prepare('UPDATE pipeline_rights SET revoked_at=NULL').run();
 assert.throws(()=>deriveAudioPlan({...filmFixture(),audio:{music:{kind:'score',scoreRef:source.scoreRef},sfx:[],captions:'off'}},[]),/AUDIO_EXTERNAL_PLAN_REQUIRED/);
 await assert.rejects(admitDirectorAudio(env,op,[{...source,rightsCleared:true}]),/AUDIO_CATALOG_INVALID/);
 const admitted=await admitDirectorAudio(env,op,[source]),film=filmFixture();film.audio={music:{kind:'score',scoreRef:source.scoreRef},sfx:[],captions:'off'};
 const sound=directorAudio(film,admitted,'approved-score');assert.equal(sound.blobs[0].sha256,source.sha256);assert.equal(sound.plan.sources[0].licenseRef,'LicenseRef-Original-Test');
 const args={seed:'approved-score',clearedSources:new Map(sound.inputs.clearedSources.map(item=>[item.sourceId,item])),scores:new Map(sound.inputs.scores),bytesBySource:new Map([['music',encode(score)]])};
 const actual=synthesizePlan(sound.plan,args);assert.equal(actual.sampleFrames,720000);assert.equal(actual.silent,false);
 assert.throws(()=>directorAudio({...film,totalFrames:900,durationSeconds:30},admitted,'approved-score'),/SCORE_APPROVAL_REQUIRED/);
 const wrongText=score+'\n% different approved request';
 assert.throws(()=>synthesizePlan(sound.plan,{...args,scores:new Map([['music',wrongText]]),clearedSources:new Map([['music',{...sound.inputs.clearedSources[0],requestHash:digest({text:wrongText,totalFrames:450})}]])}),/SCORE_SOURCE_MISMATCH/);
 const bad=structuredClone(admitted);bad[0].scoreRef='audio/other.abc';assert.throws(()=>directorAudio(film,bad,'approved-score'),/AUDIO_EXTERNAL_PLAN_REQUIRED/);
});

test('licensed upload produces 48k stereo PCM; malformed, short and changed sources never pad or silently loop',async t=>{
 const{env,op,register}=fixture(t),bytes=wav(720000),source=await register('upload',bytes),catalog=await admitDirectorAudio(env,op,[source]);
 const film=filmFixture();film.audio={music:{kind:'upload',resourceId:source.resourceId},sfx:[],captions:'off'};
 const sound=directorAudio(film,catalog,'upload'),args={seed:'upload',clearedSources:new Map(sound.inputs.clearedSources.map(item=>[item.sourceId,item])),bytesBySource:new Map([['music',bytes]])};
 const actual=synthesizePlan(sound.plan,args);assert.equal(actual.sampleFrames,720000);assert.equal(actual.silent,false);assert.equal(actual.wav.readUInt16LE(22),2);assert.equal(actual.wav.readUInt32LE(24),48000);
 const long=directorAudio({...film,totalFrames:900,durationSeconds:30},catalog,'upload');assert.throws(()=>synthesizePlan(long.plan,args),/AUDIO_SOURCE_OUT_OF_RANGE/);
 const changed=bytes.slice();changed[100]^=1;assert.throws(()=>synthesizePlan(sound.plan,{...args,bytesBySource:new Map([['music',changed]])}),/AUDIO_SOURCE_IDENTITY_MISMATCH/);
 const malformed=encode('not a WAV'),hash=sha256Bytes(malformed),plan=structuredClone(sound.plan);plan.sources[0].sha256=hash;
 assert.throws(()=>synthesizePlan(plan,{...args,clearedSources:new Map([['music',{...sound.inputs.clearedSources[0],sha256:hash}]]),bytesBySource:new Map([['music',malformed]])}),/SAMPLE_WAV_INVALID/);
});

test('director terminal fencing preserves first cause, retries cleanup only and cannot undo a delivered candidate',async t=>{
 const{db,env,op,objects}=fixture(t);let closes=0;
 env.OPERATIONS.getByName=()=>({async closeStudio(){assert.equal(db.prepare('SELECT status FROM pipeline_operations').get().status,'failed');if(++closes===1)throw Error('CLEANUP_UNAVAILABLE');},async progress(){throw Error('NOTICE_UNAVAILABLE');}});
 db.prepare('INSERT INTO cost_reservations VALUES(?,?,?,?,?,?,?,?)').run('unknown-model',op.id,'request','model','spec',12345,'fixture',Date.now());
 await assert.rejects(failDirector(env,op,'SOURCE_UNAVAILABLE'),/COMPUTE_STOP_UNCONFIRMED/);
 await failDirector(env,op,'OPERATION_DEADLINE');
 const first=db.prepare("SELECT * FROM pipeline_outbox WHERE kind='operation_failure'").get();assert.equal(parseCanonicalJson(first.payload_json).code,'SOURCE_UNAVAILABLE');
 assert.equal(parseCanonicalJson(objects.get(`operations/${op.id}/failure.json`).bytes).code,'SOURCE_UNAVAILABLE');assert.equal(closes,2);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cost_settlements').get().n,0);
 await dispatchDirectorFailure(env,{operationId:op.id,payloadJson:first.payload_json});assert.equal(closes,3);
 db.prepare("UPDATE pipeline_operations SET status='active',result_key=NULL").run();
 await commitCandidate(env,op,'operations/audio-operation/candidate.json');
 const success=db.prepare("SELECT * FROM pipeline_outbox WHERE kind='operation_progress'").get();
 await assert.rejects(dispatchDirectorProgress(env,{operationId:op.id,payloadJson:success.payload_json}),/NOTICE_UNAVAILABLE/);
 await failDirector(env,op,'NOTICE_UNAVAILABLE');assert.equal(db.prepare('SELECT status FROM pipeline_operations').get().status,'succeeded');
 await commitCandidate(env,op,'operations/audio-operation/candidate.json');
 await assert.rejects(commitCandidate(env,op,'different-key'),/CANDIDATE_COMMIT_CONFLICT/);
 db.prepare("UPDATE pipeline_operations SET generation=1,status='cancelled'").run();await dispatchDirectorProgress(env,{operationId:op.id,payloadJson:success.payload_json});
 assert.equal(db.prepare('SELECT generation FROM pipeline_operations').get().generation,1);
});

test('review-draft handoff is idempotent, keeps the failure reason and cannot become an accepted candidate',async t=>{
 const{db,env,op}=fixture(t),key=`operations/${op.id}/review-draft.json`;
 await commitReviewDraft(env,op,key,'DIRECTOR_REPAIR_LIMIT');
 await commitReviewDraft(env,op,key,'DIRECTOR_REPAIR_LIMIT');
 await failDirector(env,op,'NOTICE_UNAVAILABLE');
 const row=db.prepare('SELECT status,result_key FROM pipeline_operations').get();assert.deepEqual({...row},{status:'failed',result_key:key});
 assert.equal(parseCanonicalJson(db.prepare("SELECT payload_json FROM pipeline_outbox WHERE kind='operation_failure'").get().payload_json).code,'DIRECTOR_REPAIR_LIMIT');
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pipeline_outbox WHERE kind='operation_failure'").get().n,1);
 await assert.rejects(commitCandidate(env,op,`operations/${op.id}/candidate.json`),/OPERATION_FENCED/);
 await assert.rejects(commitReviewDraft(env,op,key,'ASSET_RIGHTS_PENDING'),/REVIEW_DRAFT_SCOPE_INVALID/);
 db.prepare("UPDATE pipeline_operations SET status='cancelled',generation=1").run();
 await assert.rejects(commitReviewDraft(env,op,key,'DIRECTOR_REPAIR_LIMIT'),/OPERATION_FENCED/);
});
