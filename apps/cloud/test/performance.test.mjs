import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {validate} from '@promobento/contracts/validators/render-job';
import {distribution,performanceFilm,performanceSummary} from '../scripts/probe-performance.mjs';

test('G1 counts complete 30s populations, real per-frame timings and settled costs without inventing missing measurements',()=>{
 const history=parseCanonicalJson(readFileSync('docs/evidence/2026-10-24-s1-staging/film-attempt/inspection.json'));
 const receipt=parseCanonicalJson(history.attempts.find(item=>item.mode==='shard').result_json).report;
 assert.equal(validate(receipt),true,'historical receipts do not require the new optional field');
 assert.equal(validate({...receipt,timings:{...receipt.timings,frameCaptureMs:[12.25,0]}}),true);
 assert.equal(validate({...receipt,timings:{...receipt.timings,frameCaptureMs:[-1]}}),false);
 assert.deepEqual(distribution([40,10,30,20]),{count:4,min:10,p50:20,p95:40,max:40});
 assert.throws(()=>distribution([]),/METRIC_MISSING/);
 for(const kind of ['2d','webgl']){
  const film=performanceFilm(kind);assert.equal(film.totalFrames,900);assert.equal(film.durationSeconds,30);assert.equal(film.scenes.at(-1).end,900);
  assert.equal(film.treatment.energyCurve.at(-1).frame,899);
 }
 const samples=[];
 for(const kind of ['2d','webgl'])for(const [mode,count]of [['serial',10],['parallel',4]])for(let index=0;index<count;index++){
  const shardCount=kind==='webgl'?24:6,units=900/15;
  const cuts=Array.from({length:shardCount+1},(_,n)=>Math.floor(n*units/shardCount)*15);
  samples.push({kind,mode,status:'passed',renderToPassedMs:mode==='serial'?100+index:1000+index,
   outcome:{media:{totalFrames:900},seamReport:{seams:Array.from({length:shardCount-1},()=>({identical:true,verdict:'pass'}))}},
   recovery:{costs:[{kind:'compute',actual_micros:20}],attempts:cuts.slice(1).map((end,n)=>({mode:'shard',status:'succeeded',physicallyStopped:true,
    result_json:canonical({lifecycleTimings:{containerReadyMs:5,capacityWaitMs:1},report:{...receipt,start:cuts[n],end,shardIndex:n,
     ...(kind==='webgl'?{webgl:[{renderer:'fixture'}]}:{}),timings:{...receipt.timings,frameCaptureMs:Array(end-cuts[n]).fill(12.5)}}})}))}});
 }
 const summary=performanceSummary(samples);
 assert.equal(summary.groups['2d'].serial.wallMs.p95,109);assert.equal(summary.groups['2d'].parallel.wallMs.p50,1001);
 assert.equal(summary.groups.webgl.serial.frameCaptureMs.count,9000);assert.equal(summary.groups.webgl.parallel.seams.count,92);
 assert.equal(summary.peakMemory.status,'unverified');assert.equal(summary.peakMemory.unavailableCount,420);
 const retried=structuredClone(samples);
 retried[0].recovery.attempts.push({mode:'shard',status:'failed',physicallyStopped:true,result_json:canonical({status:'failed',code:'RENDER_CAPACITY_UNAVAILABLE'})});
 retried[0].recovery.costs.push({kind:'compute',actual_micros:7});
 const retrySummary=performanceSummary(retried).groups['2d'].serial;
 assert.equal(retrySummary.computeAttempts.unsuccessful,1);assert.equal(retrySummary.totalComputeUpperBoundMicros,207);
 assert.equal(retrySummary.frameCaptureMs.count,9000);assert.equal(retrySummary.wallMs.p95,109);
 assert.throws(()=>performanceSummary(samples.slice(1)),/MATRIX_INCOMPLETE/);
 const partial=structuredClone(samples);partial[0].recovery.costs[0].actual_micros=null;
 assert.throws(()=>performanceSummary(partial),/SETTLEMENT_INCOMPLETE/);
 const absent=structuredClone(samples),old=parseCanonicalJson(absent[0].recovery.attempts[0].result_json);delete old.report.timings.frameCaptureMs;
 absent[0].recovery.attempts[0].result_json=canonical(old);assert.throws(()=>performanceSummary(absent),/TELEMETRY_MISSING/);
});
