import test from 'node:test';
import assert from 'node:assert/strict';
import {parseQualitySignals,assessQualitySignals} from '../src/quality.mjs';
import {motionReviewFrames} from '../../../packages/contracts/src/video-frames.mjs';

test('full-file decoder logs bind black, freeze, silence and measured loudness to time ranges',()=>{
  const video=[
    '[blackdetect @ 0x1] black_start:0.1 black_end:1.5 black_duration:1.4',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 2.0',
    '[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 4.0 | lavfi.freezedetect.freeze_duration: 2.0',
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

test('the 4x3 MP4 review samples use 12 exact and evenly spaced delivery frames',()=>{
  for(const duration of [15,30]){
    const frames=motionReviewFrames(duration);
    assert.equal(frames.length,12);assert.equal(new Set(frames).size,12);
    assert.equal(frames[0],0);assert.equal(frames.at(-1),duration*30-1);
    assert.ok(frames.every((frame,index)=>index===0||frame>frames[index-1]));
  }
  assert.throws(()=>motionReviewFrames(12),/VIDEO_DURATION_INVALID/);
});
