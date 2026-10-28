import test from 'node:test';
import assert from 'node:assert/strict';
import {focusParams} from './focus.mjs';

const start={edge:'start',offsetFrames:0},end={edge:'end',offsetFrames:0},bounds={from:start,until:end};
const sourceTime={relations:[{kind:'rate',target:bounds,targetAt:start,sourceAt:{edge:'start',offsetFrames:60},rate:{numerator:1,denominator:1},source:bounds}]};
const input={assetKey:'screen',clipFrames:120,sourceFrameCount:300,sourceTime,
 focusTrack:[{at:{kind:'start',offsetFrames:0},x:.2,y:.5,zoom:1},{at:{kind:'progress',value:.5},x:.7,y:.5,zoom:1.4},
  {at:{kind:'end',offsetFrames:-1},x:.5,y:.5,zoom:1}]};

test('Hypit source-time and positions lower to the real-time isolated focus block',()=>{
 const result=focusParams(input);
 assert.equal(result.sourceStartFrame,60);assert.deepEqual(result.focusTrack.map(point=>point.frame),[0,60,119]);
 assert.equal(result.focusTrack.at(-1).x,.5);
});
test('the bridge refuses freezes, speed changes, source overrun and collapsed or outside keyframes',()=>{
 const relation=sourceTime.relations[0];
 for(const changes of [{rate:{numerator:0,denominator:1}},{rate:{numerator:2,denominator:1}},{sourceAt:{edge:'start',offsetFrames:250}}])
  assert.throws(()=>focusParams({...input,sourceTime:{relations:[{...relation,...changes}]}}),/HYPIT_FOCUS_REALTIME_CONTINUOUS_SOURCE_REQUIRED/);
 assert.throws(()=>focusParams({...input,focusTrack:[input.focusTrack[0],{...input.focusTrack[1],at:{kind:'end',offsetFrames:0}}]}),/HYPIT_FOCUS_TRACK_INVALID/);
 assert.throws(()=>focusParams({...input,focusTrack:null}),/HYPIT_FOCUS_TRACK_INVALID/);
});
