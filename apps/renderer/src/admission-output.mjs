/** A completed write, not a queued write: at most one frame is buffered by this caller. */
export function createAdmissionOutput(stream,{maxBytes,maxLineBytes}) {
  let bytes=0,failure;
  // Writable emits error even when its write callback receives the same error.
  stream.on('error',error=>{failure=error;});
  return async value=>{
    if(failure||stream.destroyed)throw Error('ADMISSION_TRANSPORT_CLOSED',{cause:failure});
    const line=JSON.stringify(value)+'\n',length=Buffer.byteLength(line);
    if(length>maxLineBytes)throw Error('ADMISSION_OUTPUT_LINE_LIMIT');
    if(bytes+length>maxBytes) {
      const error=Error('ADMISSION_TRANSPORT_LIMIT');
      error.details={transportBytes:bytes,nextLineBytes:length,maxTransportBytes:maxBytes};
      throw error;
    }
    await new Promise((resolve,reject)=>{
      const closed=()=>reject(Error('ADMISSION_TRANSPORT_CLOSED',{cause:failure}));
      stream.once('close',closed);
      stream.write(line,error=>{
        stream.removeListener('close',closed);
        if(error)reject(Error('ADMISSION_TRANSPORT_CLOSED',{cause:error}));else resolve();
      });
    });
    bytes+=length;
  };
}
