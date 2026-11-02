import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {referenceFrameEvidence} from './reference-evidence.mjs';

function fixture() {
  const image = number => {
    const data=Buffer.alloc(20,number);data.write('RIFF',0);data.writeUInt32LE(12,4);data.write('WEBP',8);
    return data;
  };
  const samples=Array.from({length:5},(_,index)=>image(index));
  const packs=[Buffer.concat(samples.slice(0,3)),Buffer.concat(samples.slice(3))];
  const source=Buffer.from('verified reference source'),poster=Buffer.from('source poster');
  const identity=bytes=>({sha256:sha256Bytes(bytes),byteLength:bytes.length});
  const manifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',
    source:{...identity(source),mediaType:'video/mp4'},browserVersion:'156.0.8078.74',
    width:100,height:100,poster:identity(poster),packs:packs.map(identity),
    frames:samples.map((sample,index)=>({index,pts:index/30,duration:1/30,
      pack:index<3?0:1,offset:(index<3?index:index-3)*20,byteLength:sample.length}))};
  const manifestBytes=new TextEncoder().encode(canonical(manifest));
  return {source:manifest.source,manifestBytes,manifestSha256:sha256Bytes(manifestBytes),
    framePacks:packs.map((bytes,index)=>({key:'ref/pack-'+index,...identity(bytes)})),packs};
}

test('reference evidence reads only selected SHA-verified WebP source frames with original clocks',async()=>{
  const input=fixture(),reads=[];
  const evidence=await referenceFrameEvidence({resourceId:'reference',...input,maxSamples:3,
    readPack:async blob=>{reads.push(blob.key);return input.packs[Number(blob.key.at(-1))];}});
  assert.deepEqual(evidence.sampledFrames,[0,2,4]);
  assert.deepEqual(evidence.frames.map(frame=>frame.index),[0,2,4]);
  assert.deepEqual(evidence.frames.map(frame=>frame.timeSeconds),[0,2/30,4/30]);
  assert.equal(evidence.audioStatus,'not_analyzed');
  assert.deepEqual(reads,['ref/pack-0','ref/pack-1']);
  assert.deepEqual(evidence.frames.map(frame=>frame.bytes[12]),[0,2,4]);
});

test('reference evidence rejects swapped video sources, packs and altered frame bytes',async()=>{
  const input=fixture();
  const readPack=async blob=>input.packs[Number(blob.key.at(-1))];
  await assert.rejects(referenceFrameEvidence({resourceId:'ref',...input,
    source:{...input.source,sha256:'f'.repeat(64)},readPack}),/REFERENCE_SOURCE_IDENTITY_INVALID/);
  await assert.rejects(referenceFrameEvidence({resourceId:'ref',...input,
    framePacks:[{...input.framePacks[0],sha256:'f'.repeat(64)},input.framePacks[1]],readPack}),/REFERENCE_PACK_IDENTITY_INVALID/);
  await assert.rejects(referenceFrameEvidence({resourceId:'ref',...input,
    readPack:async blob=>blob.key.endsWith('0')?Buffer.from('corrupted'):input.packs[1]}),/VIDEO_FRAME_PACK_IDENTITY/);
});
