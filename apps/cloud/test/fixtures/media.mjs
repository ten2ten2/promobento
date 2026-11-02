/** Private immutable R2 subset. Input identity checks are exercised against the stored bytes. */
import {sha256Bytes} from '@promobento/contracts/digest';
import {fixedLengthOf} from './fixed-length.mjs';
export function memoryMedia(){
 const objects=new Map();
 const MEDIA={async head(key){const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:value.customMetadata}:null;},
  async get(key){const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:value.customMetadata,arrayBuffer:async()=>value.bytes.slice().buffer}:null;},
  async put(key,input,options){if(objects.has(key)&&options?.onlyIf?.get('If-None-Match')==='*')return null;
   if(input instanceof ReadableStream&&options?.sha256&&fixedLengthOf(input)===undefined)throw Error('R2_UNKNOWN_STREAM_LENGTH');
   const bytes=input instanceof ReadableStream?new Uint8Array(await new Response(input).arrayBuffer())
     :typeof input==='string'?new TextEncoder().encode(input):new Uint8Array(input);
   if(options?.sha256&&sha256Bytes(bytes)!==options.sha256)throw Error('R2_CHECKSUM_MISMATCH');
   objects.set(key,{bytes,customMetadata:options?.customMetadata});return{};}};
 return{objects,MEDIA};
}
