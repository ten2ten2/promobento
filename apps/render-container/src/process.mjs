import {spawn} from 'node:child_process';

/** Four authorized I/O operations at most. Preserve order and drain in-flight work before failure. */
export async function mapIO(values,work,concurrency=4){
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw Error('IO_CONCURRENCY_INVALID');
  const results=new Array(values.length);let next=0,failed=false,failure;
  await Promise.all(Array.from({length:Math.min(concurrency,values.length)},async()=>{
    while(!failed){
      const index=next++;if(index>=values.length)break;
      try{results[index]=await work(values[index],index);}
      catch(error){if(!failed){failed=true;failure=error;}}
    }
  }));
  if(failed)throw failure;return results;
}

async function deadline(work, ms, code, cancel = () => {}) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { cancel(); reject(Error(code)); }, ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** Trusted executables/argument arrays only. Never accepts shell programs or author modules. */
function childProcess(command, args, {signal, stderrMaxBytes = 16000} = {}) {
  if (!Number.isSafeInteger(stderrMaxBytes) || stderrMaxBytes < 1 || stderrMaxBytes > 1 << 20)
    throw Error('MEDIA_PROCESS_LOG_LIMIT_INVALID');
  const child = spawn(command, args, {stdio: ['pipe', 'pipe', 'pipe'], signal});
  let stdout = [], bytes = 0, stderr = Buffer.alloc(0), stderrTruncated = false;
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 32 << 20) child.kill('SIGKILL'); else stdout.push(chunk);
  });
  child.stderr.on('data', chunk => {
    stderr = Buffer.concat([stderr, chunk]);
    if (stderr.length > stderrMaxBytes) {
      stderr = stderr.subarray(stderr.length - stderrMaxBytes);
      stderrTruncated = true;
    }
  });
  // A failed process can close stdin before input finishes. Completion remains the authoritative error.
  child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0
      ? resolve({stdout: Buffer.concat(stdout), stderr: stderr.toString('utf8'), stderrTruncated})
      : reject(Object.assign(Error('MEDIA_PROCESS_FAILED'), {command, code, signal, diagnostic: stderr.toString('utf8')})));
  });
  done.catch(() => {});
  return {child, done};
}

export async function run(command, args, {input, timeoutMs = 60000, signal, stderrMaxBytes} = {}) {
  const process = childProcess(command, args, {signal, stderrMaxBytes});
  process.child.stdin.end(input);
  return deadline(process.done, timeoutMs, 'MEDIA_PROCESS_TIMEOUT', () => process.child.kill('SIGKILL'));
}
