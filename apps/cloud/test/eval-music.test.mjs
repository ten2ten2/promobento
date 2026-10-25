import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {approvedMusic,admitMusic} from '../../../research/evals/admit-music.mjs';

// Original transport fixture; the owner's internal-only melody is not published in the repository.
const text='X:1\nT:Transport fixture\nM:4/4\nL:1/4\nQ:1/4=96\nK:C\nC D E F | G A B c |\n';
const bytes=new TextEncoder().encode(text);
const fixtureApproval=()=>({...parseCanonicalJson(readFileSync('docs/evidence/2026-10-24-s1-audio-review/original-score-test-clearance.json')),
 scoreSource:{sha256:sha256Bytes(bytes),byteLength:bytes.length},scoreApprovals:[450,900].map(totalFrames=>({totalFrames,requestHash:digest({text,totalFrames})})),sourcePreparation:{outputs:[]}});

test('eval music preserves both owner-approved score lengths and creates operation-specific rights before creative use',async()=>{
 const approval=fixtureApproval();
 for(const totalFrames of [450,900]){
  const music=approvedMusic({kind:'score',bytes,totalFrames,approval}),objects=new Map(),rights=[];
  const json=async(path,{body})=>{const value={key:path.slice('objects/'.length),sha256:sha256Bytes(body),byteLength:body.length};objects.set(value.key,body);return value;};
  const result=await admitMusic(music,{operationId:'music-fixture-'+totalFrames,prefix:'evals/music-fixture-'+totalFrames,json,
   call:async(path,{body})=>{assert.equal(path,'rights');assert.equal(objects.size,2);rights.push(body);}});
  assert.deepEqual(result.selector,{kind:'score',scoreRef:'audio/s1-original.abc'});
  assert.equal(result.source.key,'evals/s1-approved-music/'+approval.scoreSource.sha256+'.abc','immutable source bytes can be shared; rights remain operation-specific');
  const evidence=parseCanonicalJson(objects.get(result.evidenceKey));assert.equal(evidence.operationId,'music-fixture-'+totalFrames);
  assert.deepEqual(evidence.scoreApprovals,approval.scoreApprovals);assert.equal(rights[0].evidenceKey,result.evidenceKey);
 }
 assert.throws(()=>approvedMusic({kind:'score',bytes:new TextEncoder().encode(text+'\n'),totalFrames:450,approval}),/SCORE_IDENTITY_MISMATCH/);
 assert.throws(()=>approvedMusic({kind:'score',bytes,totalFrames:900,approval:{...approval,scoreApprovals:approval.scoreApprovals.slice(0,1)}}),/SCORE_APPROVAL_MISMATCH/);
 assert.throws(()=>approvedMusic({kind:'score',bytes,totalFrames:450,approval:{...approval,publicUseCleared:true}}),/APPROVAL_REQUIRED/);
});

test('an uploaded WAV must match a recorded derivative of this exact score and cover the requested duration',()=>{
 const approval=fixtureApproval();
 // Synthetic PCM is only a unit-test transport fixture, not a recorded preparation or owner acceptance.
 const bytes=Buffer.alloc(44+720000*4);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);
 bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(48000,24);bytes.writeUInt32LE(192000,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);
 bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 approval.sourcePreparation={outputs:[{sha256:sha256Bytes(bytes),byteLength:bytes.length,totalFrames:450,sampleFrames:720000,sampleRate:48000,channels:2}]};
 const args={kind:'upload',bytes,totalFrames:450,approval};assert.equal(approvedMusic(args).selector.kind,'upload');
 assert.throws(()=>approvedMusic({...args,totalFrames:900}),/DERIVED_WAV_IDENTITY_MISMATCH/);
 assert.throws(()=>approvedMusic({...args,bytes:Buffer.from('not the approved derivative')}),/DERIVED_WAV_IDENTITY_MISMATCH/);
 assert.throws(()=>approvedMusic({...args,approval:{...approval,sourcePreparation:{outputs:[]}}}),/DERIVED_WAV_IDENTITY_MISMATCH/);
});
