import test from 'node:test';import assert from 'node:assert/strict';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';import {sha256Bytes} from '@promobento/contracts/digest';
import {admitDirectorVideos,directorResourceOptions,directorResourceInputs} from '../src/director-video.ts';
const text=(s:string)=>new TextEncoder().encode(s),hash=(b:Uint8Array)=>sha256Bytes(b),make=(key:string,b:Uint8Array)=>({key,sha256:hash(b),byteLength:b.length});
function fixture(){
 const id='res_test_video',source=text('original'),poster=text('poster'),pack=new Uint8Array(60).fill(1),sourceRef=make('evals/test/video-source.webm',source),preview=make('evals/test/video-poster.png',poster),packRef=make('evals/test/video-pack-0.bin',pack);
 const manifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',source:{sha256:sourceRef.sha256,byteLength:sourceRef.byteLength,mediaType:'video/webm'},browserVersion:'156.0.8078.74',width:100,height:80,poster:{sha256:preview.sha256,byteLength:preview.byteLength},packs:[{sha256:packRef.sha256,byteLength:packRef.byteLength}],frames:Array.from({length:60},(_,index)=>({index,pts:index/30,duration:1/30,pack:0,offset:index,byteLength:1}))};
 const raw=text(canonical(manifest)),asset={resourceId:id,kind:'video',key:'evals/test/video.json',sha256:hash(raw),byteLength:raw.length,width:100,height:80,licenseRef:'fixture',videoFramePacking:'webp-pack-v1',preview:{key:'untrusted'}};
 const evidence={resourceId:id,sha256:asset.sha256,scope:'internal_eval_only',licenseRef:'fixture',videoSource:sourceRef,preview,framePacks:[packRef]};
 const objects=new Map<string,Uint8Array>([[asset.key,raw],[sourceRef.key,source],[preview.key,poster],[packRef.key,pack],['evals/test/rights.json',text(canonical(evidence))]]);
 const env:any={DB:{prepare(){return{bind(){return{async first(){return{evidence_key:'evals/test/rights.json',license_ref:'fixture'};}}}};}},MEDIA:{async head(key:string){const value=objects.get(key);return value?{size:value.length,customMetadata:{sha256:hash(value)}}:null;},async get(key:string){const value=objects.get(key);return value?{size:value.length,customMetadata:{sha256:hash(value)},async arrayBuffer(){return value.slice().buffer;}}:null;}}};
 const op:any={id:'operation-fixture'};return{env,op,asset,evidence,objects,preview,packRef};
}
test('video admission binds source, poster and packs to the operation rights evidence',async()=>{const f=fixture(),[asset]=await admitDirectorVideos(f.env,f.op,[f.asset]);
 assert.equal(asset.preview.key,f.preview.key);assert.equal(asset.videoFrames.length,60);assert.equal(directorResourceOptions([asset])[0].videoFramePacking,'webp-pack-v1');
 assert.deepEqual(directorResourceInputs([asset]).map(ref=>ref.name),['resource:res_test_video','poster:res_test_video','framepack:res_test_video:0']);
 const ordinary={resourceId:'res_image',kind:'image',key:'evals/test/image.png',sha256:'a'.repeat(64),byteLength:10,width:10,height:10,licenseRef:'x'};
 assert.equal((await admitDirectorVideos(f.env,f.op,[ordinary]))[0],ordinary);assert.equal(directorResourceInputs([ordinary]).length,1);
});
test('an approved animated GIF keeps its source identity while using the existing video-frame path',async()=>{
 const f=fixture(),manifest=parseCanonicalJson(f.objects.get(f.asset.key)!) as any;manifest.source.mediaType='image/gif';
 const raw=text(canonical(manifest));f.asset.sha256=hash(raw);f.asset.byteLength=raw.length;f.evidence.sha256=f.asset.sha256;
 const source=f.objects.get(f.evidence.videoSource.key)!;f.objects.delete(f.evidence.videoSource.key);f.evidence.videoSource.key='evals/test/source.gif';f.objects.set(f.evidence.videoSource.key,source);
 f.objects.set(f.asset.key,raw);f.objects.set('evals/test/rights.json',text(canonical(f.evidence)));
 const [asset]=await admitDirectorVideos(f.env,f.op,[f.asset]);assert.equal(asset.videoFrames.length,60);assert.equal(asset.framePacks[0].key,f.packRef.key);
});
test('video admission rejects changed provenance and unavailable immutable packs',async()=>{
 let f=fixture();f.evidence.videoSource.sha256='0'.repeat(64);f.objects.set('evals/test/rights.json',text(canonical(f.evidence)));await assert.rejects(admitDirectorVideos(f.env,f.op,[f.asset]),/VIDEO_ADMISSION_INVALID/);
 f=fixture();f.objects.delete(f.packRef.key);await assert.rejects(admitDirectorVideos(f.env,f.op,[f.asset]),/VIDEO_BLOB_UNAVAILABLE/);
 f=fixture();f.asset.width=99;await assert.rejects(admitDirectorVideos(f.env,f.op,[f.asset]),/VIDEO_ADMISSION_INVALID/);
});
