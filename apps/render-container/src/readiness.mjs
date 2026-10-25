/** Poll the runtime's data flags from the trusted controller, not a page-injected RAF/eval poller. */
export async function waitForRuntimeReady({read,timeoutMs,pageError=()=>null,signal}){
 const until=performance.now()+timeoutMs;
 for(;;){
  signal?.throwIfAborted();
  if(performance.now()>=until)throw Error('INIT_TIMEOUT');
  const state=await read();signal?.throwIfAborted();
  if(performance.now()>=until)throw Error('INIT_TIMEOUT');
  const failure=state.failure||pageError();
  if(failure)throw Error(failure);
  if(state.ready===true)return;
  const remaining=until-performance.now();if(remaining<=0)throw Error('INIT_TIMEOUT');
  await new Promise(resolve=>setTimeout(resolve,Math.min(25,remaining)));
 }
}
