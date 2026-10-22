import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '../../packages/contracts/index.mjs';
import {summarizeProbe} from '../../research/gsap-quickjs/summary.mjs';
import {probeSandboxArguments,verifyProbeContainer,runProbe} from '../../research/gsap-quickjs/run.mjs';

// Supplied observations are inert JSON. These tests never evaluate GSAP or QuickJS.
const record=parseCanonicalJson(readFileSync(new URL('../../research/gsap-quickjs/result.json',import.meta.url)));
const observations=()=>structuredClone(record.results);

test('probe summary reproduces the supplied rounded observations without evaluating guest code',()=>{
  assert.deepEqual(summarizeProbe(observations()),record.summary);
});

test('probe summary refuses missing, duplicate and unexpected cases',()=>{
  for(const change of [x=>x.pop(),x=>x.push(x[0]),x=>{x[5]=x[0];},x=>{x[0].name='unknown';}]) {
    const results=observations();change(results);assert.throws(()=>summarizeProbe(results),/GSAP_PROBE_CASES_INVALID/);
  }
  assert.throws(()=>summarizeProbe(undefined),/GSAP_PROBE_CASES_INVALID/);
});

test('probe summary cannot treat failed cases as equal undefined samples',()=>{
  for(const name of ['absolute-values-timeline-position','relative-property-forward','relative-property-late-first-seek']) {
    const results=observations(),item=results.find(x=>x.name===name);item.status='error';item.error='load failed';delete item.samples;
    assert.throws(()=>summarizeProbe(results),/GSAP_PROBE_CASE_FAILED/);
  }
  const both=observations();for(const item of both.filter(x=>x.name.startsWith('relative-property-'))) {item.status='error';item.error='load failed';delete item.samples;}
  assert.throws(()=>summarizeProbe(both),/GSAP_PROBE_CASE_FAILED/);
});

test('probe summary refuses malformed sample counts, times, values and status',()=>{
  const changes=[x=>delete x.samples,x=>x.samples.pop(),x=>x.samples[0].pop(),x=>{x.samples[0][0]=42;},
    x=>{x.samples[0][1]=NaN;},x=>{x.samples[0][1]=Infinity;},x=>{x.samples[0][1]='0';},
    x=>{x.samples[0][4]=0.5;},x=>{x.samples[0][4]=-1;},x=>{x.status='pending';},
    x=>{x.order=[0];},x=>{x.shimmed=false;}];
  for(const change of changes){const results=observations();change(results[1]);assert.throws(()=>summarizeProbe(results),/GSAP_PROBE_(SAMPLES|STATUS|CASE)_INVALID/);}
});

test('probe summary distinguishes the known Date failure from an unrelated initialization error',()=>{
  const results=observations();results[0].error='out of memory';
  assert.throws(()=>summarizeProbe(results),/GSAP_PROBE_CASE_FAILED: unshimmed-load/);
  results[0]={...results[0],status:'ok',samples:[[0,0,0,0,0]]};delete results[0].error;
  assert.equal(summarizeProbe(results).unshimmedLoadFails,false);
});

test('relative-property summary compares every aligned sample, not just t=1',()=>{
  const results=observations();results[3].samples.find(x=>x[0]===0.5)[1]=76;
  assert.equal(summarizeProbe(results).relativePropertyOrderDependent,true);
});

test('repeat equality and callback conclusions respond to changed observations',()=>{
  const results=observations();results[1].samples[4][1]+=0.0001;
  results[4].samples[1][4]=1;results[5].samples[2][4]=1;
  const summary=summarizeProbe(results);
  assert.equal(summary.absoluteRepeatEqual,false);
  assert.equal(summary.seekSuppressesOnUpdate,false);
  assert.equal(summary.unsuppressedOnUpdateAccumulates,false);
});

const mounts=[{source:'/tmp/probe/harness',target:'/app/research/gsap-quickjs'},{source:'/tmp/probe/vendor',target:'/probe-input'}];
const options={name:'promobento-gsap-probe-00000000-0000-4000-8000-000000000000',imageId:'sha256:'+'a'.repeat(64),mounts};
const inspected=()=>({Config:{User:'65532:65532'},HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,
  Memory:268435456,MemorySwap:268435456,NanoCpus:1e9,PidsLimit:32,CapDrop:['ALL'],SecurityOpt:['no-new-privileges=true'],
  Tmpfs:{'/tmp':'rw,nosuid,nodev,noexec,size=33554432,mode=1777'}},
  Mounts:mounts.map(x=>({Type:'bind',Source:x.source,Destination:x.target,RW:false}))});

test('probe runner fixes the immutable image, read-only mounts and bounded offline non-root container',()=>{
  const args=probeSandboxArguments(options),value=flag=>args[args.indexOf(flag)+1];
  assert.equal(value('--network'),'none');assert.ok(args.includes('--read-only'));assert.equal(value('--user'),'65532:65532');
  assert.equal(value('--memory'),'268435456');assert.equal(value('--memory-swap'),'268435456');
  assert.equal(value('--cpus'),'1');assert.equal(value('--pids-limit'),'32');assert.equal(value('--cap-drop'),'ALL');
  assert.equal(value('--security-opt'),'no-new-privileges=true');assert.equal(value('--log-driver'),'none');
  assert.ok(value('--tmpfs').includes('size=33554432'));assert.ok(!args.includes('--env'));assert.ok(!args.includes('--privileged'));
  assert.deepEqual(args.filter(x=>x.startsWith('type=bind,')),mounts.map(x=>`type=bind,src=${x.source},dst=${x.target},readonly`));
  assert.deepEqual(args.slice(-5),['--entrypoint','node',options.imageId,'/app/research/gsap-quickjs/probe.mjs','--isolated']);
});

test('probe runner rejects changed image identity, duplicate mounts and arbitrary mount targets',()=>{
  for(const change of [{name:'other'}, {imageId:'latest'}, {mounts:[]},
    {mounts:[mounts[0],mounts[0]]},{mounts:[{...mounts[0],target:'/app'},mounts[1]]},
    {mounts:[{...mounts[0],source:'relative'},mounts[1]]},{mounts:[{...mounts[0],source:'/tmp/a,readonly=false'},mounts[1]]}])
    assert.throws(()=>probeSandboxArguments({...options,...change}),/GSAP_PROBE_(SANDBOX_ID|MOUNT_INVALID)/);
});

test('probe runner checks enforced isolation before starting guest code',()=>{
  assert.equal(verifyProbeContainer(inspected(),mounts).memoryBytes,268435456);
  for(const change of [x=>{x.HostConfig.NetworkMode='bridge';},x=>{x.HostConfig.Memory=0;},x=>{x.HostConfig.MemorySwap=-1;},
    x=>{x.HostConfig.NanoCpus=0;},x=>{x.HostConfig.PidsLimit=0;},x=>{x.HostConfig.ReadonlyRootfs=false;},
    x=>{x.HostConfig.Privileged=true;},x=>{x.Config.User='root';},x=>{x.HostConfig.CapDrop=[];},
    x=>{x.HostConfig.SecurityOpt=[];},x=>{x.HostConfig.Tmpfs={};},x=>{x.Mounts[0].RW=true;},
    x=>{x.Mounts[0].Source='/private';},x=>x.Mounts.push({Type:'bind',Source:'/private',Destination:'/private',RW:false})]) {
    const value=inspected();change(value);assert.throws(()=>verifyProbeContainer(value,mounts),/GSAP_PROBE_(SANDBOX|MOUNT)_UNENFORCED/);
  }
});

test('probe runner rejects already-cancelled work before external commands',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(runProbe({upstreamDirectory:'/not-used',signal:controller.signal}),/GSAP_PROBE_CANCELLED/);
});
