// Canonical identity for approved source video and its deterministic 30 fps still-frame packs.
// Object keys are transport locations, never authority: every blob is bound by sha256 and length.
import {parseCanonicalJson} from './canonical.mjs';
import {sha256Bytes} from './digest.mjs';
import {validate} from '../generated/video-frame-manifest.mjs';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
/** Read inert bytes only. Callers separately verify the original's rights and each referenced blob. */
export function parseVideoFrameManifest(raw,expectedSha){
 if(!(typeof raw==='string'||raw instanceof Uint8Array)||typeof raw==='string'&&raw.length>1<<20||raw instanceof Uint8Array&&raw.byteLength>1<<20)throw Error('VIDEO_FRAME_MANIFEST_INVALID');
 if(!hash(expectedSha)||sha256Bytes(typeof raw==='string'?new TextEncoder().encode(raw):raw)!==expectedSha)throw Error('VIDEO_FRAME_MANIFEST_IDENTITY');
 const m=parseCanonicalJson(raw);
 if(!validate(m))throw Error('VIDEO_FRAME_MANIFEST_INVALID');
 const offsets=Array(m.packs.length).fill(0),seen=new Set();let previousPack=0;
 for(const [index,frame]of m.frames.entries()){
  if(frame.index!==index||frame.pts!==index/30||frame.duration!==1/30
   ||!integer(frame.pack,0,m.packs.length-1)||frame.pack<previousPack||frame.pack>previousPack+1
   ||!integer(frame.offset,0,12<<20)||!integer(frame.byteLength,1,12<<20)||frame.offset!==offsets[frame.pack]
   ||frame.offset+frame.byteLength>m.packs[frame.pack].byteLength)throw Error('VIDEO_FRAME_MANIFEST_INVALID');
  previousPack=frame.pack;offsets[frame.pack]+=frame.byteLength;seen.add(frame.pack);
 }
 if(seen.size!==m.packs.length||offsets.some((value,index)=>value!==m.packs[index].byteLength)||m.packs.reduce((sum,pack)=>sum+pack.byteLength,0)>175<<20)throw Error('VIDEO_FRAME_MANIFEST_INVALID');
 return m;
}
/** Slice only a completely verified pack, never a name or range supplied by a film. */
export function videoFrameBytes(manifest,index,pack){
 const frame=manifest.frames[index];if(!frame||frame.index!==index||!(pack instanceof Uint8Array))throw Error('VIDEO_FRAME_UNAVAILABLE');
 const expected=manifest.packs[frame.pack];if(pack.byteLength!==expected.byteLength||sha256Bytes(pack)!==expected.sha256)throw Error('VIDEO_FRAME_PACK_IDENTITY');
 return pack.subarray(frame.offset,frame.offset+frame.byteLength);
}

/** An admitted pack is copied into a private closure, so repeated frame reads do not re-hash it. */
export function openVideoFramePack(manifest,packIndex,pack){
 const expected=manifest.packs[packIndex];
 if(!expected||!(pack instanceof Uint8Array)||pack.byteLength!==expected.byteLength||sha256Bytes(pack)!==expected.sha256)throw Error('VIDEO_FRAME_PACK_IDENTITY');
 const owned=Uint8Array.from(pack),frames=new Map(manifest.frames.filter(frame=>frame.pack===packIndex).map(frame=>[frame.index,{offset:frame.offset,length:frame.byteLength}]));
 return Object.freeze({frame(index){const frame=frames.get(index);if(!frame)throw Error('VIDEO_FRAME_UNAVAILABLE');return owned.slice(frame.offset,frame.offset+frame.length);}});
}
