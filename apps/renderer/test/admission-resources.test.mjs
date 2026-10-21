import test from 'node:test';
import assert from 'node:assert/strict';
import {Writable} from 'node:stream';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {createAdmissionOutput} from '../src/admission-output.mjs';
import {admissionEngineBudget} from '../src/admission-budget.mjs';
import {assertAdmissionHost} from '../src/admission-host.mjs';
import {admissionFailure,admissionWorkerFailure} from '../src/admission-failure.mjs';

const line=value=>JSON.stringify(value)+'\n';
const collectingStream=()=>{
  const chunks=[];
  return {chunks,stream:new Writable({write(chunk,encoding,callback){chunks.push(chunk.toString('utf8'));callback();}})};
};
async function settles(promise) {
  let timer;
  try {
    return await Promise.race([promise,new Promise((resolve,reject)=>{
      timer=setTimeout(()=>reject(Error('WRITE_DID_NOT_SETTLE_AFTER_CLOSE')),500);
    })]);
  } finally {clearTimeout(timer);}
}

test('slow writable backpressure allows only one serialized frame to remain queued',async t=>{
  const values=Array.from({length:40},(_,sequence)=>({sequence,data:'几何😀'.repeat(512)}));
  const chunks=[];let firstWrite,started=0,completed=0,maximumQueuedBytes=0;
  const stream=new Writable({highWaterMark:1,write(chunk,encoding,callback){
    chunks.push(chunk.toString('utf8'));
    maximumQueuedBytes=Math.max(maximumQueuedBytes,this.writableLength);
    const finish=()=>{completed++;callback();};
    if(chunks.length===1)firstWrite=finish;else setTimeout(finish,1);
  }});
  t.after(()=>stream.destroy());
  const output=createAdmissionOutput(stream,{maxBytes:1024*1024,maxLineBytes:16384});
  const writing=(async()=>{
    for(const value of values) {
      assert.equal(started,completed,'The producer must await completion before creating its next write');
      started++;await output(value);
    }
  })();
  await nextTurn();
  assert.equal(started,1);assert.equal(completed,0);assert.equal(chunks.length,1);
  assert.equal(stream.writableNeedDrain,true);
  assert.equal(stream.writableLength,Buffer.byteLength(line(values[0])));
  firstWrite();await writing;
  assert.deepEqual(chunks,values.map(line));
  assert.equal(completed,values.length);assert.equal(stream.writableLength,0);
  assert.equal(maximumQueuedBytes,Math.max(...values.map(value=>Buffer.byteLength(line(value)))));
});

test('transport budget counts exact UTF-8 JSON lines including newlines and permits the exact limit',async t=>{
  const {stream,chunks}=collectingStream();t.after(()=>stream.destroy());
  const values=[{text:'中文😀'},{text:'é'}],sizes=values.map(value=>Buffer.byteLength(line(value)));
  const maxBytes=sizes[0]+sizes[1];
  assert(sizes[0]>line(values[0]).length,'Fixture must distinguish UTF-8 bytes from JS code units');
  const output=createAdmissionOutput(stream,{maxBytes,maxLineBytes:64});
  for(const value of values)await output(value);
  const next={kind:'complete'};
  await assert.rejects(output(next),error=>{
    assert.equal(error.message,'ADMISSION_TRANSPORT_LIMIT');
    assert.deepEqual(error.details,{transportBytes:maxBytes,nextLineBytes:Buffer.byteLength(line(next)),maxTransportBytes:maxBytes});
    return true;
  });
  assert.deepEqual(chunks,values.map(line),'Rejected data must not enter the pipe');
});

test('line limit includes newline bytes and rejects before consuming the cumulative budget',async t=>{
  const {stream,chunks}=collectingStream();t.after(()=>stream.destroy());
  const value={text:'字'},length=Buffer.byteLength(line(value));
  const output=createAdmissionOutput(stream,{maxBytes:2*length,maxLineBytes:length});
  await output(value);
  await assert.rejects(output({text:'字a'}),/ADMISSION_OUTPUT_LINE_LIMIT/);
  await output(value);
  assert.deepEqual(chunks,[line(value),line(value)]);
  await assert.rejects(output(value),/ADMISSION_TRANSPORT_LIMIT/);
});

test('write failures reject with the transport code and subsequent writes remain closed',async t=>{
  const cause=Object.assign(Error('broken pipe'),{code:'EPIPE'});
  const stream=new Writable({write(chunk,encoding,callback){setImmediate(()=>callback(cause));}});
  t.after(()=>stream.destroy());
  const output=createAdmissionOutput(stream,{maxBytes:1024,maxLineBytes:512});
  await assert.rejects(output({frame:0}),error=>{
    assert.equal(error.message,'ADMISSION_TRANSPORT_CLOSED');assert.equal(error.cause,cause);return true;
  });
  await assert.rejects(output({frame:1}),/ADMISSION_TRANSPORT_CLOSED/);
});

test('an already destroyed stream rejects without attempting a write',async()=>{
  let writes=0;
  const stream=new Writable({write(chunk,encoding,callback){writes++;callback();}});
  stream.destroy();
  const output=createAdmissionOutput(stream,{maxBytes:1024,maxLineBytes:512});
  await assert.rejects(output({frame:0}),/ADMISSION_TRANSPORT_CLOSED/);
  assert.equal(writes,0);
});

test('a stream closing during an unfinished write rejects rather than leaving the worker waiting',async t=>{
  let started=false;
  const stream=new Writable({write(){started=true;}});
  t.after(()=>stream.destroy());
  const output=createAdmissionOutput(stream,{maxBytes:1024,maxLineBytes:512});
  const writing=output({frame:0});
  assert.equal(started,true);stream.destroy();
  await assert.rejects(settles(writing),/ADMISSION_TRANSPORT_CLOSED/);
  await assert.rejects(output({frame:1}),/ADMISSION_TRANSPORT_CLOSED/);
});

test('admission checks the Linux daemon cgroup version before starting containers',()=>{
  for(const CgroupVersion of [2,'2'])
    assert.deepEqual(assertAdmissionHost({OSType:'linux',CgroupVersion}),{os:'linux',cgroupVersion:'2'});
  for(const OSType of ['windows','darwin',undefined])
    assert.throws(()=>assertAdmissionHost({OSType,CgroupVersion:2}),/ADMISSION_LINUX_DAEMON_REQUIRED/);
  for(const CgroupVersion of [1,'1',undefined,''])
    assert.throws(()=>assertAdmissionHost({OSType:'linux',CgroupVersion}),/ADMISSION_CGROUP_V2_REQUIRED/);
});

test('forward and cold engine invocations consume one monotonic deadline without resetting it',()=>{
  let now=500;
  const remaining=admissionEngineBudget(90,()=>now);
  assert.equal(remaining(),90);
  now=520.4;assert.equal(remaining(),70);
  now=580;assert.equal(remaining(),10,'Cold verification receives only the remaining budget');
  now=589.7;assert.equal(remaining(),1,'Positive fractional milliseconds round up for the subprocess timeout');
  now=590;assert.throws(remaining,/ADMISSION_ENGINE_BUDGET_EXHAUSTED/);
  now=600;assert.throws(remaining,/ADMISSION_ENGINE_BUDGET_EXHAUSTED/);
});

test('failure reports retain the stable code, byte budget and sandbox OOM or cancellation diagnostics',()=>{
  for(const [message,exitCode,oomKilled] of [['ADMISSION_TRANSPORT_LIMIT',1,false],['ADMISSION_SANDBOX_FAILED: killed',137,true],
    ['ADMISSION_CANCELLED',137,false],['ADMISSION_ENGINE_BUDGET_EXHAUSTED',137,false]]) {
    const error=Error(message);
    error.details={transportBytes:64,nextLineBytes:9,maxTransportBytes:64};
    error.sandboxState={status:'exited',exitCode,oomKilled};
    error.sandbox={name:'promobento-admission-example',transportBytes:64};
    assert.deepEqual(admissionFailure(error),{errorCode:message.split(':')[0],error:message,details:error.details,
      sandboxState:error.sandboxState,sandbox:error.sandbox,cause:null});
  }
  const unknown=admissionFailure(Error('unexpected '+'.'.repeat(3000)));
  assert.equal(unknown.errorCode,'ADMISSION_SANDBOX_FAILED');assert.equal(unknown.error.length,2048);
  assert.equal(unknown.details,null);assert.equal(unknown.sandboxState,null);assert.equal(unknown.sandbox,null);
  assert.equal(unknown.cause,null);
});

test('cleanup failure reports preserve the original failure code and message',()=>{
  const cause=Error('ADMISSION_CANCELLED');
  const error=Error('ADMISSION_CLEANUP_FAILED: promobento-admission-example',{cause});
  assert.equal(admissionFailure(error).errorCode,'ADMISSION_CLEANUP_FAILED');
  assert.deepEqual(admissionFailure(error).cause,{errorCode:'ADMISSION_CANCELLED',error:'ADMISSION_CANCELLED'});
});

test('worker failure decoding preserves the last structured error and validated byte diagnostics',()=>{
  const details={transportBytes:64,nextLineBytes:9,maxTransportBytes:64};
  const record={kind:'admission_failure',errorCode:'ADMISSION_TRANSPORT_LIMIT',error:'ADMISSION_TRANSPORT_LIMIT',details};
  const error=admissionWorkerFailure('worker startup message\n'+JSON.stringify(record)+'\n',1);
  assert.equal(error.message,'ADMISSION_TRANSPORT_LIMIT');assert.deepEqual(error.details,details);
  assert.equal(admissionFailure(error).errorCode,'ADMISSION_TRANSPORT_LIMIT');
  for(const details of [{transportBytes:-1},{nextLineBytes:1.5},{maxTransportBytes:'64'},
    {transportBytes:Number.MAX_SAFE_INTEGER+1},{transportBytes:64,other:1},[64]]) {
    const error=admissionWorkerFailure(JSON.stringify({...record,details}),1);
    assert.equal(error.message,'ADMISSION_TRANSPORT_LIMIT');assert.equal(error.details,undefined);
  }
});

test('non-worker or invalid stderr cannot override the sandbox exit failure',()=>{
  const record={kind:'admission_failure',errorCode:'ADMISSION_TRANSPORT_LIMIT',error:'ADMISSION_TRANSPORT_LIMIT'};
  for(const stderr of ['', 'Killed', '{}', 'null',JSON.stringify({...record,kind:'draw'}),
    JSON.stringify({...record,errorCode:'ADMISSION_CANCELLED'}),JSON.stringify({...record,error:17}),
    JSON.stringify({...record,error:'A'.repeat(2049)}),
    '{"kind":"admission_failure","errorCode":"ADMISSION_TRANSPORT_LIMIT","error":"ADMISSION_TRANSPORT_LIMIT","error":"ADMISSION_CANCELLED"}']) {
    const error=admissionWorkerFailure(stderr,137);
    assert.match(error.message,/^ADMISSION_SANDBOX_FAILED: exitCode=137/u);
    assert.equal(admissionFailure(error).errorCode,'ADMISSION_SANDBOX_FAILED');
    assert.equal(error.details,undefined);
  }
});
