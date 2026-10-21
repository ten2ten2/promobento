import test from 'node:test';
import assert from 'node:assert/strict';
import {assertTextLayout,assertClipRange,observeOpticalPulse,assertOpticalMarkers} from '../src/fixture-qa.mjs';

test('measured text QA catches clipped, missing and out-of-viewport text rather than trusting declared regions',()=>{
  const text={id:'headline',text:'A demo',x:10,y:20,width:500,height:100,scrollWidth:500,clientWidth:500,
    scrollHeight:100,clientHeight:100,fontStatus:'loaded'};
  assert.equal(assertTextLayout([text],{width:1080,height:1920}).status,'passed');
  for(const [change,error] of [[{x:-1},/TEXT_OUT_OF_BOUNDS/],[{width:1200},/TEXT_OUT_OF_BOUNDS/],
    [{scrollWidth:700},/TEXT_OVERFLOW/],[{scrollHeight:120},/TEXT_OVERFLOW/],[{fontStatus:'loading'},/FONT_NOT_READY/],
    [{text:''},/TEXT_CONTENT_MISSING/],[{x:NaN},/TEXT_BOUNDS_INVALID/]])
    assert.throws(()=>assertTextLayout([{...text,...change}],{width:1080,height:1920}),error);
  assert.throws(()=>assertTextLayout([],{width:1080,height:1920}),/TEXT_COVERAGE_MISSING/);
});

test('optical sync is detected from frame pixels, including missing, shifted and repeated pulse rejection',()=>{
  const rgba=new Uint8Array(1080*1920*4),offset=(1338*1080+870)*4,state={previous:null,frames:{}};
  const set=(rgb,frame)=>{rgba.set([...rgb,255],offset);observeOpticalPulse(rgba,{width:1080,height:1920},frame,state);};
  const marker={audioEventId:'cue_open',frame:30};
  set([129,145,135],29);set([32,255,96],30);set([32,255,96],31);set([129,145,135],36);
  assert.deepEqual(assertOpticalMarkers([marker],state.frames),{cue_open:30});
  assert.throws(()=>assertOpticalMarkers([{...marker,frame:31}],state.frames),/OPTICAL_MARKER_OUT_OF_SYNC/);
  assert.throws(()=>assertOpticalMarkers([marker],{}),/OPTICAL_MARKERS_MISSING/);
  assert.throws(()=>set([32,255,96],40),/OPTICAL_PULSE_REPEATED/);
});

test('trusted clip frame and sample cuts use the same nonempty half-open source range',()=>{
  assert.deepEqual(assertClipRange({frameStart:270,frameEndExclusive:330},900),
    {frameStart:270,frameEndExclusive:330,frameCount:60,startSample:432000,endSample:528000});
  for(const [frameStart,frameEndExclusive] of [[-1,30],[270,270],[300,200],[899,901],[0.5,30]])
    assert.throws(()=>assertClipRange({frameStart,frameEndExclusive},900),/CLIP_RANGE_INVALID/);
});
