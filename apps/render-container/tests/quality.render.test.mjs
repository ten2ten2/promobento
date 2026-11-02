import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {run} from '../src/process.mjs';
import {analyzeEncodedQuality} from '../src/quality.mjs';
import {extractMotionReviewSheet} from '../src/media.mjs';

test('dynamic QA decodes the delivered MP4 and builds an actual 12-frame image',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'promobento-dynamic-review-'));
  try{
    const movie=join(dir,'film.mp4'),composition={durationSeconds:15,fps:30,width:320,height:180};
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi',
      '-i','testsrc2=size=320x180:rate=30:duration=15','-c:v','mpeg4','-q:v','5','-an',movie],{timeoutMs:120_000});
    const quality=await analyzeEncodedQuality(movie,composition,false);
    assert.equal(quality.kind,'encoded_dynamic_qa');
    assert.equal(quality.coverage,'full_video_decode_no_audio');
    assert.equal(quality.ownerNormalSpeedReview,'pending');
    assert.notEqual(quality.status,'blocked');
    const review=await extractMotionReviewSheet(movie,join(dir,'review'),composition);
    assert.equal(review.frames.length,12);
    assert.deepEqual([...readFileSync(review.sheet).subarray(0,3)],[0xff,0xd8,0xff]);
    const invalid=join(dir,'invalid.mp4');writeFileSync(invalid,'this is not an MP4');
    await assert.rejects(analyzeEncodedQuality(invalid,composition,false),/MEDIA_PROCESS_FAILED/);
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('the full-file audio decoder measures a normalized AAC track, not a page-side volume claim',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'promobento-encoded-audio-'));
  try{
    const movie=join(dir,'film.mp4'),composition={durationSeconds:15,fps:30,width:320,height:180};
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi',
      '-i','testsrc2=size=320x180:rate=30:duration=15','-f','lavfi',
      '-i','sine=frequency=440:sample_rate=48000:duration=15',
      '-c:v','mpeg4','-q:v','5','-c:a','aac','-ar','48000','-ac','2','-af','loudnorm=I=-14:TP=-1:LRA=11','-t','15',movie],
      {timeoutMs:120_000});
    const quality=await analyzeEncodedQuality(movie,composition,true);
    assert.equal(quality.coverage,'full_video_and_audio_decode');
    assert.equal(quality.signals.black.length,0);
    assert.ok(Number.isFinite(quality.signals.integratedLufs));
    assert.ok(Number.isFinite(quality.signals.truePeakDbtp));
    assert.notEqual(quality.status,'blocked',JSON.stringify(quality));
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('a truly static encoded movie is reported for review even without a freeze_end log',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'promobento-frozen-encoded-'));
  try{
    const movie=join(dir,'film.mp4'),composition={durationSeconds:15,fps:30,width:320,height:180};
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi',
      '-i','color=c=blue:s=320x180:r=30:d=15','-c:v','mpeg4','-q:v','5','-an',movie],{timeoutMs:120_000});
    const quality=await analyzeEncodedQuality(movie,composition,false);
    assert.equal(quality.status,'review_required');
    assert.ok(quality.signals.freeze.some(item=>item.startSeconds===0&&item.endSeconds===15));
    assert.ok(quality.findings.some(item=>item.kind==='static_segment'&&item.durationSeconds>=14));
  }finally{rmSync(dir,{force:true,recursive:true});}
});

test('corrupt H.264 packets are rejected even when FFmpeg ordinarily exits successfully after decoding errors',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'promobento-corrupt-encoded-'));
  try{
    const clean=join(dir,'clean.mp4'),corrupt=join(dir,'corrupt.mp4'),composition={durationSeconds:15,fps:30,width:320,height:180};
    await run('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi',
      '-i','testsrc2=size=320x180:rate=30:duration=15','-c:v','libx264','-preset','ultrafast',
      '-g','30','-pix_fmt','yuv420p','-an',clean],{timeoutMs:120_000});
    const packets=JSON.parse((await run('ffprobe',['-v','error','-select_streams','v:0',
      '-show_entries','packet=pos,size','-of','json',clean])).stdout.toString()).packets;
    assert.ok(packets.length>200);
    const bytes=Buffer.from(readFileSync(clean)),packet=packets[Math.floor(packets.length/2)];
    const pos=Number(packet.pos);
    assert.ok(Number.isSafeInteger(pos)&&pos>0&&pos+4<bytes.length);
    bytes.writeUInt32BE(0x7fffffff,pos); // Impossible length-prefixed NAL, but valid MP4 container.
    writeFileSync(corrupt,bytes);
    const ordinary=await run('ffmpeg',['-hide_banner','-loglevel','error','-i',corrupt,
      '-map','0:v:0','-an','-f','null','-'],{timeoutMs:120_000});
    assert.match(ordinary.stderr,/NAL unit|error|invalid/i);
    await assert.rejects(analyzeEncodedQuality(corrupt,composition,false),/MEDIA_DECODE_CORRUPT/);
  }finally{rmSync(dir,{force:true,recursive:true});}
});
