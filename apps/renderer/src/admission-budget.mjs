/** One monotonic deadline shared by every engine invocation, including cold verification. */
export function admissionEngineBudget(timeoutMs,now=()=>performance.now()) {
  const deadline=now()+timeoutMs;
  return ()=>{
    const remaining=Math.ceil(deadline-now());
    if(remaining<=0)throw Error('ADMISSION_ENGINE_BUDGET_EXHAUSTED');
    return remaining;
  };
}
