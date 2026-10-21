import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// These observations are collected from the reviewed fixture in a trusted host.
// They are deliberately not a general customer-content or moderation verdict.
export function assertTextLayout(observations,{width,height}) {
  assert(Array.isArray(observations)&&observations.length>0,'TEXT_COVERAGE_MISSING');
  const ids=new Set();
  for(const item of observations) {
    assert(item && typeof item.id==='string' && !ids.has(item.id),'TEXT_OBSERVATION_INVALID');ids.add(item.id);
    assert(typeof item.text==='string' && item.text.length>0,'TEXT_CONTENT_MISSING');
    assert([item.x,item.y,item.width,item.height,item.scrollWidth,item.scrollHeight,item.clientWidth,item.clientHeight].every(Number.isFinite),
      'TEXT_BOUNDS_INVALID');
    assert(item.width>0 && item.height>0 && item.x>=0 && item.y>=0 && item.x+item.width<=width+0.5
      && item.y+item.height<=height+0.5,'TEXT_OUT_OF_BOUNDS: '+item.id);
    assert(item.scrollWidth<=item.clientWidth+1 && item.scrollHeight<=item.clientHeight+1,'TEXT_OVERFLOW: '+item.id);
    assert(item.fontStatus==='loaded','FONT_NOT_READY: '+item.id);
  }
  return {status:'passed',textNodes:observations.length,ids:[...ids]};
}

/** Actual DOM measurement, after the exact frame draw/font/compositor barrier. */
export function observeFixtureText(page) {
  return page.evaluate(()=>[...document.querySelectorAll('#composition [data-qa-text]')].filter(node=>getComputedStyle(node).display!=='none').map(node=>{
    const rect=node.getBoundingClientRect();
    return {id:node.dataset.qaText,text:node.textContent,x:rect.x,y:rect.y,width:rect.width,height:rect.height,
      scrollWidth:node.scrollWidth,scrollHeight:node.scrollHeight,clientWidth:node.clientWidth,clientHeight:node.clientHeight,
      fontStatus:document.fonts.status};
  }));
}

const pulseColors=Object.freeze({cue_open:[32,255,96],cue_focus:[255,32,224],cue_finish:[32,224,255]});
function recordPulse(rgb,frameIndex,state,tolerance) {
  const active=Object.keys(pulseColors).find(key=>pulseColors[key].every((value,index)=>Math.abs(rgb[index]-value)<=tolerance))??null;
  if(active!==state.previous) {
    if(active) {
      assert(!Object.hasOwn(state.frames,active),'OPTICAL_PULSE_REPEATED: '+active);
      state.frames[active]=frameIndex;
    }
    state.previous=active;
  }
}
export function observeOpticalPulse(rgba,{width,height},frameIndex,state) {
  assert(Number.isSafeInteger(frameIndex) && frameIndex>=0,'OPTICAL_FRAME_INVALID');
  assert(rgba.length===width*height*4 && width>870 && height>1338,'OPTICAL_PIXELS_INVALID');
  const offset=(1338*width+870)*4;
  recordPulse(rgba.subarray(offset,offset+3),frameIndex,state,2);
}

/** Read the actual H.264 output after its color conversion, independent of PNG captures. */
export function observeEncodedOptical(videoPath,frameCount) {
  assert(Number.isSafeInteger(frameCount)&&frameCount>0&&frameCount<=900,'OPTICAL_FRAME_COUNT_INVALID');
  const rgb=execFileSync('/usr/bin/ffmpeg',['-v','error','-nostdin','-i',videoPath,'-map','0:v:0','-an','-vf',
    'crop=2:2:870:1338,zscale=matrixin=bt709:transferin=bt709:primariesin=bt709:rangein=limited:matrix=gbr:transfer=iec61966-2-1:primaries=bt709:range=full,format=gbrpf32le,format=rgb24',
    '-fps_mode','passthrough','-threads','1','-filter_threads','1','-f','rawvideo','pipe:1'],
  {timeout:60000,killSignal:'SIGKILL',maxBuffer:frameCount*12+1024});
  assert.equal(rgb.length,frameCount*12,'OPTICAL_ENCODED_FRAME_COUNT_MISMATCH');
  const state={previous:null,frames:{}};
  for(let index=0;index<frameCount;index++)recordPulse(rgb.subarray(index*12,index*12+3),index,state,10);
  return state.frames;
}

export function assertOpticalMarkers(markers,observed) {
  assert.equal(Object.keys(observed).length,markers.length,'OPTICAL_MARKERS_MISSING');
  for(const marker of markers) {
    assert(Object.hasOwn(observed,marker.audioEventId),'OPTICAL_MARKER_MISSING: '+marker.audioEventId);
    assert.equal(observed[marker.audioEventId],marker.frame,'OPTICAL_MARKER_OUT_OF_SYNC: '+marker.audioEventId);
  }
  return {...observed};
}

export function assertClipRange({frameStart,frameEndExclusive},totalFrames) {
  assert(Number.isSafeInteger(frameStart)&&Number.isSafeInteger(frameEndExclusive)
    && frameStart>=0 && frameStart<frameEndExclusive && frameEndExclusive<=totalFrames,'CLIP_RANGE_INVALID');
  return {frameStart,frameEndExclusive,frameCount:frameEndExclusive-frameStart,
    startSample:frameStart*1600,endSample:frameEndExclusive*1600};
}
