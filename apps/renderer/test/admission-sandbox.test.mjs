import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import {admissionPolicy} from '../src/admission-image.mjs';
import {runAdmissionSandbox} from '../src/admission-sandbox.mjs';

const image={imageId:'sha256:'+'a'.repeat(64)};
const complete='{"kind":"complete"}\n';

// Stub only Docker's control plane: no container, engine or composition is executed.
function sandboxControl(t,{stdout=complete,exitCode=0,removeError,state={Status:'exited',ExitCode:exitCode,OOMKilled:false}}={}) {
  const limits=admissionPolicy.engineContainer,calls=[],kills=[];
  const inspection={HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,Memory:limits.memoryBytes,
    MemorySwap:limits.memoryBytes,NanoCpus:limits.cpus*1e9,PidsLimit:limits.pids,CapDrop:['ALL'],
    SecurityOpt:['no-new-privileges=true'],Tmpfs:{'/tmp':`rw,nosuid,nodev,noexec,size=${limits.tmpBytes}`}},
  Config:{User:'65532:65532'},Mounts:[],State:state};
  let now=0,emission;
  // Keep the wall-clock timer from racing the deterministic close/deadline ordering under test.
  t.mock.timers.enable({apis:['setTimeout']});
  t.mock.method(performance,'now',()=>now);
  t.mock.method(childProcess,'execFileSync',(command,args)=>{
    assert.equal(command,'docker');calls.push(args);
    if(args[0]==='inspect')return Buffer.from(JSON.stringify([inspection]));
    if(args[0]==='rm'&&removeError)throw removeError;
    assert(['create','rm'].includes(args[0]));return Buffer.alloc(0);
  });
  t.mock.method(childProcess,'spawn',(command,args)=>{
    assert.equal(command,'docker');assert.equal(args[0],'start');calls.push(args);
    const child=new EventEmitter();
    child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();
    child.stdin.end=()=>{};child.kill=signal=>{kills.push(signal);return true;};
    emission=setImmediate(()=>{child.stdout.emit('data',Buffer.from(stdout));child.emit('close',exitCode);});
    return child;
  });
  syncBuiltinESMExports();
  t.after(()=>{clearImmediate(emission);t.mock.timers.reset();t.mock.restoreAll();syncBuiltinESMExports();});
  return {calls,kills,setNow(value){now=value;}};
}

test('successful process close still enforces the deadline after the final synchronous line handler',{concurrency:false},async t=>{
  const control=sandboxControl(t);
  await assert.rejects(runAdmissionSandbox({image,mode:'evaluate',input:{},timeoutMs:20,
    timeoutCode:'ADMISSION_ENGINE_BUDGET_EXHAUSTED',onLine(){control.setNow(40);}}),error=>{
    assert.equal(error.message,'ADMISSION_ENGINE_BUDGET_EXHAUSTED');
    assert.equal(error.sandbox.transportBytes,Buffer.byteLength(complete));assert.equal(error.sandbox.timeoutMs,20);
    assert.deepEqual(error.sandboxState,{status:'exited',exitCode:0,oomKilled:false});return true;
  });
  assert.equal(control.calls.filter(args=>args[0]==='rm').length,1);assert(control.kills.includes('SIGKILL'));
});

test('timely successful close returns the resource receipt and received frame count',{concurrency:false},async t=>{
  const stdout='{"kind":"draw","frameIndex":0}\n'+complete;
  const control=sandboxControl(t,{stdout}),messages=[];
  const result=await runAdmissionSandbox({image,mode:'evaluate',input:{},timeoutMs:20,onLine(message){
    messages.push(message);control.setNow(message.kind==='draw'?1:19.5);
  }});
  assert.equal(result.framesReceived,1);assert.equal(result.transportBytes,Buffer.byteLength(stdout));
  assert.equal(result.memoryBytes,admissionPolicy.engineContainer.memoryBytes);assert.equal(result.network,'none');
  assert.deepEqual(messages,[{kind:'draw',frameIndex:0},{kind:'complete'}]);
  const removals=control.calls.filter(args=>args[0]==='rm');
  assert.deepEqual(removals,[['rm','--force',result.name]]);
});

test('cancellation during the final line cannot become a successful close',{concurrency:false},async t=>{
  const control=sandboxControl(t),controller=new AbortController();
  await assert.rejects(runAdmissionSandbox({image,mode:'evaluate',input:{},timeoutMs:20,signal:controller.signal,
    onLine(){controller.abort();}}),/ADMISSION_CANCELLED/);
  assert.equal(control.calls.filter(args=>args[0]==='rm').length,1);assert(control.kills.includes('SIGKILL'));
});

test('cancellation after one draw discards later lines coalesced in the same stdout chunk',{concurrency:false},async t=>{
  const stdout='{"kind":"draw","frameIndex":0}\n{"kind":"draw","frameIndex":1}\n';
  const control=sandboxControl(t,{stdout}),controller=new AbortController(),messages=[];
  await assert.rejects(runAdmissionSandbox({image,mode:'evaluate',input:{},timeoutMs:20,signal:controller.signal,
    onLine(message){messages.push(message);controller.abort();}}),error=>{
    assert.equal(error.message,'ADMISSION_CANCELLED');assert.equal(error.sandbox.framesReceived,1);
    assert.equal(error.sandbox.transportBytes,Buffer.byteLength(stdout));return true;
  });
  assert.deepEqual(messages,[{kind:'draw',frameIndex:0}]);
  assert.equal(control.calls.filter(args=>args[0]==='rm').length,1);
});

test('an existing line failure keeps precedence when its handler also crosses the deadline',{concurrency:false},async t=>{
  const control=sandboxControl(t),original=Error('ADMISSION_DRAW_INVALID');
  await assert.rejects(runAdmissionSandbox({image,mode:'evaluate',input:{},timeoutMs:20,onLine(){
    control.setNow(40);throw original;
  }}),error=>{assert.equal(error,original);assert.equal(error.message,'ADMISSION_DRAW_INVALID');return true;});
  assert.equal(control.calls.filter(args=>args[0]==='rm').length,1);
});

test('container removal failure retains the original error and its sandbox diagnostics',{concurrency:false},async t=>{
  const original=Error('ADMISSION_TRANSPORT_LIMIT');
  original.details={transportBytes:64,nextLineBytes:9,maxTransportBytes:64};
  const control=sandboxControl(t,{removeError:Error('docker rm failed'),state:{Status:'exited',ExitCode:137,OOMKilled:false}});
  await assert.rejects(runAdmissionSandbox({image,mode:'evaluate',input:{},timeoutMs:20,onLine(){throw original;}}),error=>{
    assert.match(error.message,/^ADMISSION_CLEANUP_FAILED: promobento-admission-/u);
    assert.equal(error.cause,original);assert.deepEqual(error.cause.details,original.details);
    assert.deepEqual(error.sandboxState,{status:'exited',exitCode:137,oomKilled:false});
    assert.equal(error.sandbox,original.sandbox);assert.equal(error.sandbox.mode,'evaluate');
    assert.equal(error.sandbox.transportBytes,Buffer.byteLength(complete));return true;
  });
  assert.equal(control.calls.filter(args=>args[0]==='rm').length,1);
});
