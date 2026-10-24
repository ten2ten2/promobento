import {spawn} from 'node:child_process';

/** Four authorized I/O operations at most. Preserve order and drain in-flight work before failure. */
export async function mapIO(values,work){
  const results=new Array(values.length);let next=0,failed=false,failure;
  await Promise.all(Array.from({length:Math.min(4,values.length)},async()=>{
    while(!failed){
      const index=next++;if(index>=values.length)break;
      try{results[index]=await work(values[index],index);}
      catch(error){if(!failed){failed=true;failure=error;}}
    }
  }));
  if(failed)throw failure;return results;
}

export async function deadline(work, ms, code, cancel = () => {}) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => { cancel(); reject(Error(code)); }, ms);
    })]);
  } finally { clearTimeout(timer); }
}

/** Trusted executables/argument arrays only. Never accepts shell programs or author modules. */
export function childProcess(command, args, {signal} = {}) {
  const child = spawn(command, args, {stdio: ['pipe', 'pipe', 'pipe'], signal});
  let stdout = [], bytes = 0, stderr = '';
  child.stdout.on('data', chunk => {
    bytes += chunk.length;
    if (bytes > 32 << 20) child.kill('SIGKILL'); else stdout.push(chunk);
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
  // A failed encoder can close stdin between write calls. Completion remains the authoritative error.
  child.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0
      ? resolve({stdout: Buffer.concat(stdout), stderr})
      : reject(Object.assign(Error('MEDIA_PROCESS_FAILED'), {command, code, signal, diagnostic: stderr})));
  });
  done.catch(() => {});
  return {child, done};
}

export async function run(command, args, {input, timeoutMs = 60000, signal} = {}) {
  const process = childProcess(command, args, {signal});
  process.child.stdin.end(input);
  return deadline(process.done, timeoutMs, 'MEDIA_PROCESS_TIMEOUT', () => process.child.kill('SIGKILL'));
}

export async function write(process, bytes, timeoutMs) {
  const written = new Promise((resolve, reject) => process.child.stdin.write(bytes, error => error ? reject(error) : resolve()));
  return deadline(Promise.race([written, process.done.then(() => { throw Error('ENCODER_EXITED_EARLY'); })]),
    timeoutMs, 'ENCODER_WRITE_TIMEOUT', () => process.child.kill('SIGKILL'));
}
