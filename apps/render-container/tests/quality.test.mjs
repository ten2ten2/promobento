import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQualitySignals,assessQualitySignals} from '../src/quality.mjs';
import {motionReviewFrames} from '../../../packages/contracts/src/video-frames.mjs';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nativeProjectHash,NATIVE_RUNTIME_COMMIT} from '../../../packages/contracts/src/native-project.mjs';
import {sha256Bytes} from '../../../packages/contracts/src/digest.mjs';
import {persistQualityFailure} from '../src/quality-failure.mjs';

test('full-file decoder logs bind black, freeze, silence and measured loudness to time ranges',()=>{
  const video=[
    '[blackdetect @ 0x1] black_start:0.1 black_end:1.5 black_duration:1.4',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 2.0',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 2.0',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 4.0',
    '[blackdetect @ 0x1] black_start:20 black_end:25 black_duration:5'
  ].join('\n');
  const audio=['[silencedetect @ 0x3] silence_start: 5.0',
    '[silencedetect @ 0x3] silence_end: 7.5 | silence_duration: 2.5',
    '[Parsed_loudnorm_1 @ 0x4] {', '"input_i" : "-14.20",', '"input_tp" : "-1.10",',
    '"input_lra" : "0.00"', '}'].join('\n');
  const signals=parseQualitySignals(video,audio,15);
  assert.deepEqual(signals.black,[{startSeconds:.1,endSeconds:1.5,durationSeconds:1.4}]);
  assert.deepEqual(signals.freeze,[{startSeconds:2,endSeconds:4,durationSeconds:2}]);
  assert.deepEqual(signals.silence,[{startSeconds:5,endSeconds:7.5,durationSeconds:2.5}]);
  assert.equal(signals.integratedLufs,-14.2);
  assert.equal(signals.truePeakDbtp,-1.1);
  assert.deepEqual(assessQualitySignals(signals,true).map(item=>[item.kind,item.severity]),
    [['black_segment','review'],['static_segment','review'],['silent_segment','review']]);
  assert.deepEqual(assessQualitySignals({...signals,integratedLufs:-19},true).at(-1),
    {kind:'audio_loudness_out_of_range',severity:'block'});
  assert.deepEqual(assessQualitySignals({...signals,truePeakDbtp:null},true).at(-1),
    {kind:'audio_measurement_unavailable',severity:'block'});
  assert.equal(parseQualitySignals('',null,15).integratedLufs,null);
});

test('freeze detector pairs distinct events and closes a final still frame at EOF',()=>{
  const log=[
    '[freezedetect @ 0xa] lavfi.freezedetect.freeze_start: 0',
    '[freezedetect @ 0xa] lavfi.freezedetect.freeze_duration: 2.5',
    '[freezedetect @ 0xa] lavfi.freezedetect.freeze_end: 2.5',
    '[freezedetect @ 0xa] lavfi.freezedetect.freeze_start: 10',
    'frame=450 fps=0.0 time=00:00:14.96'
  ].join('\n');
  const signals=parseQualitySignals(log,null,15);
  assert.deepEqual(signals.freeze,[
    {startSeconds:0,endSeconds:2.5,durationSeconds:2.5},
    {startSeconds:10,endSeconds:15,durationSeconds:5}
  ]);
  assert.deepEqual(assessQualitySignals(signals,false).map(item=>item.kind),['static_segment','static_segment']);
  assert.deepEqual(parseQualitySignals('freeze_start: 3\nfreeze_duration: 1\nfreeze_end: 4\nfreeze_start: 9',null,10).freeze,
    [{startSeconds:3,endSeconds:4,durationSeconds:1},{startSeconds:9,endSeconds:10,durationSeconds:1}]);
  assert.deepEqual(parseQualitySignals('freeze_start: 1\nfreeze_duration: 90\nfreeze_end: 2',null,15).freeze,[]);
});

test('the 4x3 MP4 review samples use 12 exact and evenly spaced delivery frames',()=>{
  for(const duration of [15,30]){
    const frames=motionReviewFrames(duration);
    assert.equal(frames.length,12);assert.equal(new Set(frames).size,12);
    assert.equal(frames[0],0);assert.equal(frames.at(-1),duration*30-1);
    assert.ok(frames.every((frame,index)=>index===0||frame>frames[index-1]));
  }
  assert.throws(()=>motionReviewFrames(12),/VIDEO_DURATION_INVALID/);
});

test('a blocked loudness result stores a SHA-bound private diagnostic and never a delivery output',async()=>{
 const base=mkdtempSync(join(tmpdir(),'promobento-qa-failure-'));
 try{
  mkdirSync(join(base,'out'));const filmPath=join(base,'out','film.mp4'),bytes=Buffer.from('final broken-loudness fixture');
  writeFileSync(filmPath,bytes);
  const sha256=sha256Bytes(bytes),project={schemaVersion:'1.0.0',kind:'native_project',entry:'index.html',
   runtime:{name:'huashu-motion',commit:NATIVE_RUNTIME_COMMIT},composition:{durationSeconds:15,fps:30,width:1920,height:1080},
   files:[{path:'index.html',key:'operations/example/index.html',sha256:'a'.repeat(64),byteLength:30,mediaType:'text/html'}],resources:[]};
  const task={taskId:'attempt',renderId:'render',project};
  const evidence={kind:'encoded_quality_failure',projectHash:await nativeProjectHash(project),
   composition:project.composition,film:{name:'film.mp4',sha256,byteLength:bytes.length},
   dynamicQuality:{kind:'encoded_dynamic_qa',source:'film.mp4',status:'blocked',signals:{integratedLufs:-21.78,truePeakDbtp:-20.76},
    findings:[{kind:'audio_loudness_out_of_range',severity:'block'}]}};
  const saved=[];
  const broker={writeFile:async(key,path,identity,type)=>{saved.push({key,path,type});return{key,...identity,mediaType:type};},
   write:async(key,body,type)=>{saved.push({key,body,type});return{key,sha256:sha256Bytes(body),byteLength:body.length,mediaType:type};}};
  const result=await persistQualityFailure({base,task,evidence,broker});
  assert.equal(saved.length,2);
  assert.equal(result.film.key,'renders/render/attempts/attempt/failed/film.mp4');
  assert.equal(result.report.key,'renders/render/attempts/attempt/failed/qa.json');
  assert.deepEqual(result.signals,evidence.dynamicQuality.signals);
  const stored=JSON.parse(saved[1].body.toString());
  assert.equal(stored.film.sha256,sha256);
  assert.equal(stored.dynamicQuality.findings[0].kind,'audio_loudness_out_of_range');
  const decodeFailure={...evidence,dynamicQuality:{kind:'encoded_dynamic_qa',source:'film.mp4',
   coverage:'incomplete_decode',status:'blocked',signals:parseQualitySignals('',null,15),
   findings:[{kind:'decode_scan_failed',severity:'block',code:'MEDIA_DECODE_CORRUPT'}],
   diagnostic:'invalid NAL unit size'}};
  const decoded=await persistQualityFailure({base,task,evidence:decodeFailure,broker});
  assert.equal(decoded.film.sha256,sha256);
  const decodeReport=JSON.parse(saved[3].body.toString());
  assert.equal(decodeReport.dynamicQuality.coverage,'incomplete_decode');
  assert.equal(decodeReport.dynamicQuality.diagnostic,'invalid NAL unit size');
  await assert.rejects(persistQualityFailure({base,task,evidence:{...evidence,film:{...evidence.film,sha256:'b'.repeat(64)}},broker}),
   /NATIVE_QA_EVIDENCE_INVALID/);
  assert.equal(saved.length,4,'no upload is permitted after an identity mismatch');
 }finally{rmSync(base,{recursive:true,force:true});}
});
