import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseCanonicalJson,createSchemaValidator} from '@promobento/contracts';
import {prepareFixtureAudio,validateEncodedAudio,readPcm16Wav,pcm16Wav} from '../src/audio.mjs';

const command=(args,options={})=>execFileSync('/usr/bin/ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...args],
  {timeout:60000,maxBuffer:24*1024*1024,...options});

function encode(path,mixedPath,{durationSeconds=30,startSample=0,markers=[30,300,600]}={}) {
  const expression=markers.map(frame=>`between(n,${frame},${frame+5})`).join('+');
  command(['-f','lavfi','-i',`color=c=black:s=64x64:r=30:d=${durationSeconds}`,'-i',mixedPath,
    '-map','0:v:0','-map','1:a:0','-vf',`drawbox=x=0:y=0:w=16:h=16:color=white:t=fill:enable='${expression}'`,
    '-af',`atrim=start_sample=${startSample}:end_sample=${startSample+durationSeconds*48000},asetpts=PTS-STARTPTS`,
    '-c:v','libx264','-preset','ultrafast','-threads','1','-filter_threads','1','-pix_fmt','yuv420p',
    '-c:a','aac','-profile:a','aac_low','-ar','48000','-ac','2','-b:a','128000',
    '-frames:v',String(durationSeconds*30),'-movflags','+faststart',path]);
}

function observedFlashes(path,markers) {
  const rgb=command(['-i',path,'-map','0:v:0','-vf','format=rgb24,crop=1:1:8:8','-threads','1','-filter_threads','1',
    '-pix_fmt','rgb24','-f','rawvideo','pipe:1']);
  const onsets=[];let lit=false;
  for (let frame=0;frame<rgb.length/3;frame++) {
    const now=rgb[frame*3]>200&&rgb[frame*3+1]>200&&rgb[frame*3+2]>200;
    if (now&&!lit) onsets.push(frame);lit=now;
  }
  assert.equal(onsets.length,markers.length);
  return markers.map((marker,index)=>({audioEventId:marker.audioEventId,frame:onsets[index]}));
}

test('actual frozen WAV and AAC output preserve measured loudness, sample length, priming and optical sync',{timeout:180000},()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-audio-media-'));
  try {
    const audio=prepareFixtureAudio({outputDirectory:join(directory,'first')});
    const schema=parseCanonicalJson(readFileSync(new URL('../../../contracts/production.schema.json',import.meta.url)));
    const validate=createSchemaValidator(schema);
    assert.deepEqual(validate(audio.mixedAudio,schema.$defs.mixedAudio),[]);
    for (const event of audio.audioEvents) assert.deepEqual(validate(event,schema.$defs.frozenAudioEvent),[]);
    for (const resource of audio.resources) assert.deepEqual(validate(resource,schema.$defs.resource),[]);
    const rerun=prepareFixtureAudio({outputDirectory:join(directory,'second')});
    assert.equal(audio.mixedAudio.sha256,rerun.mixedAudio.sha256,'Frozen mixing is reproducible under the pinned tools');
    assert.equal(readPcm16Wav(readFileSync(audio.mixedPath)).sampleFrames,1440000);
    assert.equal(audio.audioMetadata[audio.mixedAudio.sha256].sampleFrames,1440000);
    assert(Math.abs(audio.report.measurement.integratedLufs+16)<=0.5);
    const full=join(directory,'full.mp4');encode(full,audio.mixedPath);
    const visualMarkerFrames=observedFlashes(full,audio.markers);
    assert.deepEqual(visualMarkerFrames.map(item=>item.frame),[30,300,600]);
    const result=validateEncodedAudio(full,{...audio,visualMarkerFrames});
    assert.equal(result.interval.startSample,0);assert.equal(result.interval.endSample,1440000);
    assert.equal(result.interval.primingSamples,1024);
    assert(result.decoderTailPaddingFrames>=0&&result.decoderTailPaddingFrames<=1024);
    assert(result.mixedAudioComparison.correlation>0.97);
    assert(result.cueChecks.every(item=>Math.abs(item.differenceFrames)<=1));
    assert(result.measurement.truePeakDbtp<=-1);
    const shifted=visualMarkerFrames.map(item=>({...item,frame:item.frame+3}));
    assert.throws(()=>validateEncodedAudio(full,{...audio,visualMarkerFrames:shifted}),/AUDIO_VISUAL_SYNC_MISMATCH/);
    assert.throws(()=>validateEncodedAudio(full,{...audio,visualMarkerFrames:[]}),/AUDIO_VISUAL_OBSERVATION_REQUIRED/);
    const clip=join(directory,'clip.mp4'),marker={...audio.markers[1],frame:30};
    encode(clip,audio.mixedPath,{durationSeconds:2,startSample:270*1600,markers:[30]});
    const clipResult=validateEncodedAudio(clip,{...audio,durationSeconds:2,frameCount:60,referenceStartSample:270*1600,
      markers:[marker],visualMarkerFrames:observedFlashes(clip,[marker])});
    assert.equal(clipResult.interval.endSample,96000);assert.equal(clipResult.programLoudnessChecked,false);
    assert.equal(clipResult.cueChecks.length,1);
    // Real AAC bytes made from a different waveform cannot borrow the original mix's hash.
    const alternate=join(directory,'altered.wav'),decoded=readPcm16Wav(readFileSync(audio.mixedPath));
    writeFileSync(alternate,pcm16Wav(Float64Array.from(decoded.samples,sample=>sample*0.5)));
    const altered=join(directory,'altered.mp4');encode(altered,alternate,{durationSeconds:2,startSample:270*1600,markers:[30]});
    assert.throws(()=>validateEncodedAudio(altered,{...audio,durationSeconds:2,frameCount:60,referenceStartSample:270*1600,
      markers:[marker],visualMarkerFrames:observedFlashes(altered,[marker])}),/AUDIO_MIX_NOT_CONSUMED/);
    console.log('M0a audio: '+JSON.stringify({wav:audio.report.measurement,aac:result.measurement,
      interval:result.interval,decoderTailPaddingFrames:result.decoderTailPaddingFrames,cueChecks:result.cueChecks,clip:clipResult.referenceRange}));
  } finally {rmSync(directory,{recursive:true,force:true});}
});
