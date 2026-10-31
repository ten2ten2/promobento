import test from 'node:test';import assert from 'node:assert/strict';
import {canonical} from '@promobento/contracts/canonical';import {sha256Bytes} from '@promobento/contracts/digest';
import {admitPackedVideos} from './video-input.mjs';
const bytes=value=>new TextEncoder().encode(value),ref=value=>({sha256:sha256Bytes(value),byteLength:value.length});
function fixture(){
 const id='res_fixture_video',poster=bytes('poster'),pack=bytes('firstsecond'),manifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',source:{...ref(bytes('source')),mediaType:'video/mp4'},browserVersion:'156.0.8078.74',width:100,height:80,poster:ref(poster),packs:[ref(pack)],frames:[
  {index:0,pts:0,duration:1/30,pack:0,offset:0,byteLength:5},{index:1,pts:1/30,duration:1/30,pack:0,offset:5,byteLength:6}]};
 const raw=bytes(canonical(manifest)),data=new Map([['resource:'+id,raw],['poster:'+id,poster],['framepack:'+id+':0',pack]]),objects=new Map([...data].map(([name,value])=>[name,{name,...ref(value)}]));
 const task={job:{resources:[{resourceId:id,sha256:sha256Bytes(raw),kind:'video'}]},options:{resources:[{resourceId:id,kind:'video',width:100,height:80,videoFramePacking:'webp-pack-v1',videoFrames:manifest.frames.map(({index,pts,duration})=>({index,pts,duration}))}]}};
 return{id,task,objects,data,read:async name=>data.get(name)};
}
test('packed video binds the exact manifest, poster, timings and pack bytes',async()=>{const f=fixture(),videos=await admitPackedVideos(f.task,f.objects,f.read),video=videos.get(f.id);
 assert.equal(new TextDecoder().decode(await video.poster()),'poster');assert.equal(new TextDecoder().decode(await video.frame(1)),'second');assert.equal(new TextDecoder().decode(await video.frame(0)),'first');
 f.data.get('framepack:'+f.id+':0')[0]=88;assert.equal(new TextDecoder().decode(await video.frame(0)),'first'); // The admitted pack is an independent copy.
 await assert.rejects(video.frame(2),/VIDEO_FRAME_UNAVAILABLE/);
});
test('reject manifest substitution, timing substitution and missing broker inputs; retain legacy frame entry',async()=>{
 let f=fixture();f.task.options.resources[0].videoFrames[1].pts=.1;await assert.rejects(admitPackedVideos(f.task,f.objects,f.read),/VIDEO_FRAME_MANIFEST_MISMATCH/);
 f=fixture();f.objects.get('framepack:'+f.id+':0').sha256='0'.repeat(64);await assert.rejects(admitPackedVideos(f.task,f.objects,f.read),/VIDEO_FRAME_PACK_IDENTITY/);
 f=fixture();f.task.job.resources[0].sha256='0'.repeat(64);await assert.rejects(admitPackedVideos(f.task,f.objects,f.read),/VIDEO_FRAME_MANIFEST_IDENTITY/);
 f=fixture();f.data.get('framepack:'+f.id+':0')[0]=88;const videos=await admitPackedVideos(f.task,f.objects,f.read);await assert.rejects(videos.get(f.id).frame(0),/VIDEO_FRAME_PACK_IDENTITY/);
 f=fixture();f.objects.delete('poster:'+f.id);await assert.rejects(admitPackedVideos(f.task,f.objects,f.read),/VIDEO_FRAME_POSTER_IDENTITY/);
 f=fixture();delete f.task.options.resources[0].videoFramePacking;assert.equal((await admitPackedVideos(f.task,f.objects,f.read)).size,0);
});
