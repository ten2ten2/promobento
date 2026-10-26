/** Retry only the caller's read-only operation snapshot, never a write or model dispatch. */
export async function readOperationState(read,{wait,onRetry=()=>{}}){
  for(let retries=0;;retries++){
    try{return await read();}
    catch(error){
      if(error?.cause?.code!=='UND_ERR_SOCKET'||retries>=2)throw error;
      onRetry();await wait();
    }
  }
}
