// Adapted from huashu-motion@5f2608c samples.js, MIT; see LICENSE.huashu.
// Fixed, reviewed CC0 files only. No cache discovery, decoder subprocess or fallback voice.
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts';
import {sha256Bytes as sha256} from '@promobento/contracts/digest';
import {env,mtof,N} from './dsp.mjs';

const assets=new URL('../samples/',import.meta.url);
const catalog=parseCanonicalJson(readFileSync(new URL('catalog.json',assets)));
const decoded=new Map();
export const sampledVoices=()=>catalog.resources.map(resource=>({...structuredClone(resource),licenseRef:catalog.license.licenseRef}));
export function sampleEvidence(ids) {
  const license=catalog.license;
  if(license.license!=='CC0-1.0'||sha256(readFileSync(new URL(license.evidenceFile,assets)))!==license.evidenceSha256)
    throw Error('SAMPLE_LICENSE_INVALID');
  const resources=ids.map(id=>{const entry=catalog.resources.find(x=>x.id===id);if(!entry)throw Error('SAMPLE_UNKNOWN');return entry;});
  return {...structuredClone(license),sourceHashes:resources.map(x=>x.sha256),resources:structuredClone(resources)};
}

/** Reviewed WAV subset: mono/stereo PCM16/24 at 44.1/48 kHz, at most 30 s. */
export function decodeSampleWav(bytes) {
  if(!(bytes instanceof Uint8Array)||bytes.length<44||bytes.length>8*1024*1024)throw Error('SAMPLE_WAV_INVALID');
  const b=Buffer.from(bytes);if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE'||b.readUInt32LE(4)+8!==b.length)throw Error('SAMPLE_WAV_INVALID');
  let fmt=null,data=null,offset=12;
  while(offset<b.length) {
    if(offset+8>b.length)throw Error('SAMPLE_WAV_INVALID');
    const size=b.readUInt32LE(offset+4),start=offset+8,end=start+size,kind=b.toString('ascii',offset,offset+4);
    if(end>b.length)throw Error('SAMPLE_WAV_INVALID');
    if(kind==='fmt ') {
      if(fmt||size<16||size>40)throw Error('SAMPLE_WAV_INVALID');
      fmt={tag:b.readUInt16LE(start),channels:b.readUInt16LE(start+2),rate:b.readUInt32LE(start+4),stride:b.readUInt16LE(start+12),bits:b.readUInt16LE(start+14)};
    } else if(kind==='data') {if(data)throw Error('SAMPLE_WAV_INVALID');data=b.subarray(start,end);}
    offset=end+size%2;
  }
  if(offset!==b.length||!fmt||!data||fmt.tag!==1||![1,2].includes(fmt.channels)||![44100,48000].includes(fmt.rate)
    ||![16,24].includes(fmt.bits)||fmt.stride!==fmt.channels*fmt.bits/8||data.length%fmt.stride)throw Error('SAMPLE_WAV_UNSUPPORTED');
  const frames=data.length/fmt.stride;if(frames<4||frames>30*fmt.rate)throw Error('SAMPLE_WAV_LIMIT');
  const n=Math.floor(frames*48000/fmt.rate),L=new Float32Array(n),R=new Float32Array(n);
  const read=(i,ch)=>data.readIntLE(i*fmt.stride+Math.min(ch,fmt.channels-1)*fmt.bits/8,fmt.bits/8)/(2**(fmt.bits-1));
  for(let i=0;i<n;i++) {
    const p=i*fmt.rate/48000,j=Math.min(frames-1,Math.floor(p)),k=Math.min(frames-1,j+1),f=p-j;
    L[i]=read(j,0)*(1-f)+read(k,0)*f;R[i]=read(j,1)*(1-f)+read(k,1)*f;
  }
  return {L,R};
}

function load(id) {
  sampleEvidence([id]); // Rights before even a cache hit; a cache cannot change authorization.
  const entry=catalog.resources.find(x=>x.id===id),bytes=readFileSync(new URL(entry.file,assets));
  if(bytes.length!==entry.byteLength||sha256(bytes)!==entry.sha256)throw Error('SAMPLE_IDENTITY_MISMATCH');
  if(!decoded.has(id))decoded.set(id,decodeSampleWav(bytes));
  return {entry,...decoded.get(id)};
}

// Catmull–Rom interpolation, adapted from upstream; no mutable round-robin state.
function resample(x,ratio,n) {
  const o=new Float32Array(n);
  for(let i=0;i<n;i++) {const p=i*ratio,j=Math.floor(p),t=p-j;if(j+2>=x.length)break;
    const a=x[j-1]??x[j],b=x[j],c=x[j+1],d=x[j+2];
    o[i]=b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
  }return o;
}
export function samplerStereo(id) {
  const {entry,L,R}=load(id);
  return (f,sec,velocity=.7)=> {
    const midi=69+12*Math.log2(f/440),[lo,hi]=entry.pitchRangeMidi;
    if(!Number.isFinite(midi)||midi<lo-1e-6||midi>hi+1e-6||!Number.isFinite(sec)||sec<=0||sec>30
      ||!Number.isFinite(velocity)||velocity<0||velocity>1)throw Error('SAMPLE_NOTE_RANGE');
    const ratio=f/mtof(entry.rootMidi),n=Math.max(1,Math.min(N(sec),Math.floor((L.length-3)/ratio)));
    const gain=.55+.45*velocity;
    const side=x=>{const out=resample(x,ratio,n);for(let i=0;i<n;i++)out[i]*=gain;return env(out,.0015,Math.min(.15,n/48000/3));};
    return {L:side(L),R:side(R)};
  };
}
export function sampler(id) {const voice=samplerStereo(id);return(...args)=>{const {L,R}=voice(...args);for(let i=0;i<L.length;i++)L[i]=(L[i]+R[i])/2;return L;};}
