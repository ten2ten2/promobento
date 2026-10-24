/** Private immutable R2 subset. Input identity checks are exercised against the stored bytes. */
export function memoryMedia(){
 const objects=new Map();
 const MEDIA={async head(key){const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:value.customMetadata}:null;},
  async get(key){const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:value.customMetadata,arrayBuffer:async()=>value.bytes.slice().buffer}:null;},
  async put(key,input,options){if(objects.has(key)&&options?.onlyIf?.get('If-None-Match')==='*')return null;
   objects.set(key,{bytes:typeof input==='string'?new TextEncoder().encode(input):new Uint8Array(input),customMetadata:options?.customMetadata});return{};}};
 return{objects,MEDIA};
}
