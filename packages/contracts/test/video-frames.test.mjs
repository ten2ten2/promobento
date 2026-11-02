import test from 'node:test';import assert from 'node:assert/strict';
import {canonical} from '../src/canonical.mjs';import {sha256Bytes} from '../src/digest.mjs';
import {parseVideoFrameManifest,openVideoFramePack} from '../src/video-frames.mjs';
const bytes=value=>new TextEncoder().encode(value),ref=value=>({sha256:sha256Bytes(value),byteLength:value.length});
function fixture(){const packs=[bytes('abcdef'),bytes('xyz')],poster=bytes('poster'),source=bytes('video');
 const manifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',source:{...ref(source),mediaType:'video/mp4'},browserVersion:'156.0.8078.74',width:100,height:100,poster:ref(poster),packs:packs.map(ref),frames:[
  {index:0,pts:0,duration:1/30,pack:0,offset:0,byteLength:3},
  {index:1,pts:1/30,duration:1/30,pack:0,offset:3,byteLength:3},
  {index:2,pts:2/30,duration:1/30,pack:1,offset:0,byteLength:3}]};return{manifest,packs};}
function parse(manifest){const raw=canonical(manifest);return parseVideoFrameManifest(raw,sha256Bytes(bytes(raw)));}
test('frame packs bind source, timings and every byte',()=>{const {manifest,packs}=fixture(),valid=parse(manifest);
 const opened=openVideoFramePack(valid,0,packs[0]);packs[0][0]=88;assert.equal(new TextDecoder().decode(opened.frame(0)),'abc');
 assert.throws(()=>opened.frame(2),/VIDEO_FRAME_UNAVAILABLE/);assert.throws(()=>openVideoFramePack(valid,0,bytes('xyzabc')),/VIDEO_FRAME_PACK_IDENTITY/);
 const raw=canonical(manifest);assert.throws(()=>parseVideoFrameManifest(raw,'0'.repeat(64)),/VIDEO_FRAME_MANIFEST_IDENTITY/);
});
test('QuickTime source identity remains distinct from MP4 and WebM',()=>{
 const {manifest}=fixture();manifest.source.mediaType='video/quicktime';assert.equal(parse(manifest).source.mediaType,'video/quicktime');
});
test('animated image frame packs retain their original source MIME identity',()=>{
 for(const type of ['image/gif','image/png','image/webp']){const {manifest}=fixture();manifest.source.mediaType=type;assert.equal(parse(manifest).source.mediaType,type);}
});
test('frame manifests accept explicit sample rules and retain unversioned approved packs',()=>{
 const {manifest}=fixture();assert.equal(parse(manifest).samplingRule,undefined);
 manifest.samplingRule='interval-center-v1';assert.equal(parse(manifest).samplingRule,'interval-center-v1');
 manifest.samplingRule='off-boundary-v2';assert.equal(parse(manifest).samplingRule,'off-boundary-v2');
 manifest.samplingRule='unknown';assert.throws(()=>parse(manifest),/VIDEO_FRAME_MANIFEST_INVALID/);
});
test('reject timing changes, skipped packs, overlaps and hidden bytes',()=>{for(const mutate of [m=>m.frames[1].pts=.5,m=>m.frames[1].offset=2,m=>m.frames[2].pack=0,m=>m.packs[1].byteLength++,m=>m.frames[0].extra=true,m=>m.source.mediaType='text/html']){
 const {manifest}=fixture();mutate(manifest);assert.throws(()=>parse(manifest),/VIDEO_FRAME_MANIFEST_INVALID/);
}});
