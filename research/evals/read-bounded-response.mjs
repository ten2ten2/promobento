// Bound curator downloads while streaming: checking size after arrayBuffer()
// already allocates the entire (possibly untrusted) response.
export async function readBoundedResponse(response,limit,code){
 const declared=response.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit)){
  try{void response.body?.cancel().catch(()=>{});}catch{/* preserve the size error */}
  throw Error(code);
 }
 const reader=response.body?.getReader();if(!reader)throw Error(code);
 const chunks=[];let length=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)return Buffer.concat(chunks,length);
   if(!(value instanceof Uint8Array))throw Error(code);
   length+=value.byteLength;if(length>limit)throw Error(code);
   chunks.push(Buffer.from(value));
  }
 }finally{
  try{void reader.cancel().catch(()=>{});}catch{/* preserve the read or validation error */}
  try{reader.releaseLock();}catch{/* no other reader needs this response */}
 }
}
