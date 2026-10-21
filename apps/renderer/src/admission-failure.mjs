import {parseCanonicalJson} from '@promobento/contracts';

const code=error=>String(error.message).match(/^[A-Z][A-Z0-9_]+(?=:|$)/u)?.[0]??'ADMISSION_SANDBOX_FAILED';

/** Keep machine-readable causes when the sandbox is gone and only failure.json remains. */
export function admissionFailure(error) {
  return {errorCode:code(error),
    error:String(error.message).slice(0,2048),details:error.details??null,
    sandboxState:error.sandboxState??null,sandbox:error.sandbox??null,
    cause:error.cause?{errorCode:code(error.cause),error:String(error.cause.message).slice(0,2048)}:null};
}

/** Only the trusted worker can write stderr; guest code has no process or console. */
export function admissionWorkerFailure(stderr,exitCode) {
  try {
    const record=parseCanonicalJson(stderr.trim().split('\n').at(-1));
    if(record.kind==='admission_failure'&&typeof record.error==='string'&&record.error.length<=2048
      &&record.errorCode===code({message:record.error})) {
      const error=Error(record.error);
      if(record.details&&typeof record.details==='object'&&!Array.isArray(record.details)
        &&Object.keys(record.details).every(key=>['transportBytes','nextLineBytes','maxTransportBytes'].includes(key))
        &&Object.values(record.details).every(value=>Number.isSafeInteger(value)&&value>=0))error.details=record.details;
      return error;
    }
  } catch { /* Docker/OS failures may not contain a worker record. */ }
  return Error('ADMISSION_SANDBOX_FAILED: exitCode='+exitCode+(stderr.trim()?'; '+stderr.trim():''));
}
