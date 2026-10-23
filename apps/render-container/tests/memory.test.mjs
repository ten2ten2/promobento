import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryPeak} from '../src/memory.mjs';
import {validate} from '@promobento/contracts/validators/render-job';

test('peak memory is measured or explicitly unavailable; only absent cgroup interfaces permit null',()=>{
 const missing=()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});};
 const unavailable=memoryPeak(missing);
 assert.deepEqual(unavailable,{bytes:null,mib:null,path:null,unavailableReason:'cgroup_peak_not_exposed'});
 const measured=memoryPeak(path=>path.endsWith('memory.peak')?missing():'1048577\n');
 assert.equal(measured.bytes,1048577);assert.equal(measured.mib,2);
 assert.equal(measured.path,'/sys/fs/cgroup/memory/memory.max_usage_in_bytes');
 for(const raw of ['', '0', '-1', 'garbage', '1.5'])assert.throws(()=>memoryPeak(()=>raw),/RENDER_MEMORY_METRIC_INVALID/);
 const denied=Object.assign(Error('denied'),{code:'EACCES'});
 assert.throws(()=>memoryPeak(()=>{throw denied;}),error=>error===denied);

 const sha='a'.repeat(64),receipt={schemaVersion:'3.0.0',kind:'shard_receipt',renderId:'test-render',shardIndex:0,start:0,end:150,
  imageDigest:'sha256:'+sha,chromiumVersion:'151.0.7922.34',cpuModel:'fixture',cpuFlagsHash:sha,
  sandbox:{seccomp:true,nestedPidNamespace:true,separateUserNamespace:true,chromiumUid:10002},captureFormat:'jpeg92',
  timings:{readyMs:1,handshakeMs:1,renderMs:1,encodeDrainMs:1},peakMemoryMiB:measured.mib,
  outputs:{shard:sha,frameDigests:sha,seamFrames:[sha],observations:sha}};
 assert.equal(validate(receipt),true,JSON.stringify(validate.errors));
 const nullable={...receipt,peakMemoryMiB:null,peakMemoryUnavailableReason:unavailable.unavailableReason};
 assert.equal(validate(nullable),true,JSON.stringify(validate.errors));
 for(const invalid of [
  {...receipt,peakMemoryMiB:null},
  {...nullable,peakMemoryUnavailableReason:'unknown'},
  {...nullable,peakMemoryMiB:0},
  {...receipt,peakMemoryMiB:-1},
  {...receipt,peakMemoryMiB:undefined}
 ])assert.equal(validate(invalid),false);
});
