import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionVerificationPlan} from '../src/admission-capture.mjs';
import {admissionVerification,admissionCommandVerificationPlan,admissionEngineRequests} from '../src/admission-verification.mjs';
import {admissionHistoryFrame} from './admission-resource.cases.mjs';

const frames=requests=>requests.map(request=>request.frame);
const sampled=frameCount=>{const plan=admissionVerificationPlan(frameCount);return new Set([...plan.repeated,...plan.unordered,...plan.cold]);};

test('command and pixel verification are versioned separately; pixel samples stay unchanged',()=>{
  for(const frameCount of [450,900]) {
    const verification=admissionVerification(frameCount),pixels=admissionVerificationPlan(frameCount);
    assert.equal(verification.version,'admission-verification-v2');
    assert.deepEqual(verification.pixels,pixels);
    assert.equal(pixels.version,'admission-determinism-v1');
    assert.equal(pixels.cold.length,6,'Pixel cold capture must not grow with the command pass');
    assert.deepEqual(admissionCommandVerificationPlan(frameCount).cold,{order:'full_reverse',newContainer:true,frameCount});
  }
  assert.throws(()=>admissionVerification(451),/ADMISSION_FRAME_COUNT_INVALID/);
});

test('first container keeps forward, repeated and unordered requests and their capture files',()=>{
  for(const frameCount of [450,900]) {
    const pixels=admissionVerificationPlan(frameCount),{first}=admissionEngineRequests(admissionVerification(frameCount));
    assert.deepEqual(frames(first),[...Array.from({length:frameCount},(_,frame)=>frame),...pixels.repeated,...pixels.unordered]);
    assert.deepEqual(first.map(request=>request.paths[0]),[...Array.from({length:frameCount},(_,frame)=>'forward/'+frame+'.json'),
      ...pixels.repeated.map((_,index)=>'repeated/'+index+'.json'),...pixels.unordered.map((_,index)=>'unordered/'+index+'.json')]);
    assert(first.length<=920,'Worker frame plan bound');
  }
});

test('fresh container evaluates every frame once in reverse and still supplies each pixel cold file',()=>{
  for(const frameCount of [450,900]) {
    const pixels=admissionVerificationPlan(frameCount),{cold}=admissionEngineRequests(admissionVerification(frameCount));
    assert.deepEqual(frames(cold),Array.from({length:frameCount},(_,index)=>frameCount-1-index));
    assert(cold.every(request=>request.check==='cold_reverse'));
    const files=cold.flatMap(request=>request.paths.map(path=>[path,request.frame]));
    assert.deepEqual(files.toSorted(([a],[b])=>a.localeCompare(b)),
      pixels.cold.map((frame,index)=>['cold/'+index+'.json',frame]).toSorted(([a],[b])=>a.localeCompare(b)));
    assert.equal(cold.filter(request=>request.paths.length).length,new Set(pixels.cold).size);
  }
});

test('altered or stale verification plans are refused before any task starts',()=>{
  const verification=admissionVerification(900);
  for(const changed of [{...verification,version:'admission-verification-v1'},
    {...verification,commands:{...verification.commands,cold:{...verification.commands.cold,order:'sampled'}}},
    {...verification,commands:{...verification.commands,cold:{...verification.commands.cold,frameCount:450}}},
    {...verification,pixels:{...verification.pixels,cold:[0]}}])
    assert.throws(()=>admissionEngineRequests(changed),/ADMISSION_VERIFICATION_INVALID/);
});

test('equivalent verification plans accept different object key ordering',()=>{
  const plan=admissionVerification(900),{version,commands,pixels}=plan;
  const reordered={pixels,commands:{cold:commands.cold,unordered:commands.unordered,repeated:commands.repeated,version:commands.version},version};
  assert.deepEqual(admissionEngineRequests(reordered),admissionEngineRequests(plan));
});

test('trusted simulation: call-count state at an unsampled frame passes the old samples but not the reverse pass',()=>{
  // This is trusted test code, not candidate evaluation. It mirrors the container case.
  const engine=()=>{let calls=0;return frame=>{calls++;return frame===admissionHistoryFrame&&calls!==admissionHistoryFrame+1?'changed':'baseline:'+frame;};};
  for(const frameCount of [450,900]) {
    assert(!sampled(frameCount).has(admissionHistoryFrame),'The regression frame must sit outside every sampled list');
    const {first,cold}=admissionEngineRequests(admissionVerification(frameCount));
    const forward=engine(),hashes=[],mismatches=checks=>{const fresh=engine();return checks.filter(frame=>fresh(frame)!==hashes[frame]);};
    for(const request of first) {
      const value=forward(request.frame);
      if(request.check==='forward')hashes[request.frame]=value;else assert.equal(value,hashes[request.frame]);
    }
    assert.deepEqual(mismatches(admissionVerificationPlan(frameCount).cold),[],'The former six-frame cold sample misses it');
    assert.deepEqual(mismatches(frames(cold)),[admissionHistoryFrame]);
  }
});
