import {sha256Bytes} from '@promobento/contracts/digest';
import {canonical} from '@promobento/contracts/canonical';
import {filmSourceHash} from '@promobento/contracts/film-source';
import type {PipelineEnv,BlobRef} from './pipeline-types.ts';

export async function checkedBytes(env:PipelineEnv,blob:BlobRef){
 const object=await env.MEDIA.get(blob.key);if(!object||object.size!==blob.byteLength||object.size>50<<20)throw Error('RENDER_OUTPUT_MISSING');
 const bytes=new Uint8Array(await object.arrayBuffer());if(sha256Bytes(bytes)!==blob.sha256)throw Error('RENDER_OUTPUT_IDENTITY_MISMATCH');return bytes;
}

// Source bytes are data here: never evaluate custom code in the Worker.
export async function loadCustomSources(env:PipelineEnv,inputs:BlobRef[]){
 const sources:Record<string,string>={};
 for(const blob of inputs.filter(item=>item.name.startsWith('scenes/'))){
  if(blob.byteLength>65536)throw Error('CUSTOM_SOURCE_SIZE');
  sources[blob.name]=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await checkedBytes(env,blob));
 }
 return sources;
}

export async function verifyRenderSource(env:PipelineEnv,film:unknown,inputs:BlobRef[],expected:string){
 const sources=await loadCustomSources(env,inputs);
 if(filmSourceHash(canonical(film),sources)!==expected)throw Error('SOURCE_IDENTITY_MISMATCH');
 return sources;
}
