import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeNativeVideo, validateVideo} from '../src/media.mjs';
import {run} from '../src/process.mjs';

// Real FFmpeg tests run in the pinned browser-test image, not the contracts-only runner.
const composition = {width:320,height:180,durationSeconds:1,fps:30};
const compliantVideo = ['-c:v','libx264','-profile:v','high','-pix_fmt','yuv420p','-r','30',
  '-g','15','-keyint_min','15','-sc_threshold','0','-bf','0','-b:v','700000',
  '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709'];
const videoBytes=async path=>(await run('ffmpeg',['-v','error','-i',path,'-map','0:v:0','-c:v','copy','-f','h264','pipe:1'])).stdout;

test('compliant native H.264 retains video packets while the final MP4 is verified',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'promobento-media-copy-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'native.mp4'),output=join(dir,'film.mp4');
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=1',...compliantVideo,'-an',input]);
 const result=await normalizeNativeVideo(input,output,composition);
 assert.equal(result.videoEncoding,'stream_copy');assert.equal(result.frameCount,30);
 assert.ok(Number.isSafeInteger(result.processingElapsedMs)&&result.processingElapsedMs>=0);
 assert.deepEqual(await videoBytes(output),await videoBytes(input),'the H.264 elementary stream must be unchanged');
 assert.ok(statSync(output).size>0);
 assert.equal((await validateVideo(output,composition,false)).frameCount,30);
});

test('stream-copying valid video still normalizes source PCM audio to one AAC track',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'promobento-media-audio-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'native.mov'),output=join(dir,'film.mp4');
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=1',
  '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1',...compliantVideo,
  '-c:a','pcm_s16le','-ac','2','-shortest',input]);
 const result=await normalizeNativeVideo(input,output,composition);
 assert.equal(result.videoEncoding,'stream_copy');assert.equal(result.audioCodec,'aac');
 assert.deepEqual(await videoBytes(output),await videoBytes(input),'audio processing must not re-encode video');
 assert.equal((await validateVideo(output,composition,true)).audioSampleRate,48000);
});

test('noncompliant native codecs still take the trusted full-encode fallback',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'promobento-media-fallback-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'native.mp4'),output=join(dir,'film.mp4');
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=1',
  '-c:v','mpeg4','-q:v','4','-an',input]);
 const result=await normalizeNativeVideo(input,output,composition);
 assert.equal(result.videoEncoding,'transcoded');assert.equal(result.copyRejection,'OUTPUT_VIDEO_INVALID');
 assert.ok(Number.isSafeInteger(result.processingElapsedMs)&&result.processingElapsedMs>=0);
 assert.equal((await validateVideo(output,composition,false)).frameCount,30);
});

test('H.264 alone is insufficient: noncompliant keyframe cadence must be re-encoded',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'promobento-media-gop-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const input=join(dir,'native.mp4'),output=join(dir,'film.mp4');
 const args=compliantVideo.slice(),gop=args.indexOf('-g');args[gop+1]='30';
 await run('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=1',...args,'-an',input]);
 const result=await normalizeNativeVideo(input,output,composition);
 assert.equal(result.videoEncoding,'transcoded');
 assert.equal(result.copyRejection,'OUTPUT_FRAME_TIMING_INVALID');
 assert.equal((await validateVideo(output,composition,false)).frameCount,30);
});
