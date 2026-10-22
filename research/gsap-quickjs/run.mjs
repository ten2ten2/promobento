import {execFile,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {lstatSync,readFileSync,writeFileSync,mkdtempSync,mkdirSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {parseCanonicalJson} from '../../packages/contracts/index.mjs';
import {verifiedAdmissionImage} from '../../apps/renderer/src/admission-image.mjs';
import {summarizeProbe} from './summary.mjs';

const execute=promisify(execFile),memoryBytes=268435456,timeoutMs=60000;
const baseline=parseCanonicalJson(readFileSync(new URL('../m0a/baseline.json',import.meta.url)));
const targets=['/app/research/gsap-quickjs','/probe-input'];

export function probeSandboxArguments({name,imageId,mounts}) {
  if(!/^promobento-gsap-probe-[a-f0-9-]+$/u.test(name)||!/^sha256:[a-f0-9]{64}$/u.test(imageId))throw Error('GSAP_PROBE_SANDBOX_ID');
  if(!Array.isArray(mounts)||mounts.length!==targets.length||mounts.some((mount,index)=>
    typeof mount.source!=='string'||!mount.source.startsWith('/')||mount.source.includes(',')||mount.target!==targets[index]))throw Error('GSAP_PROBE_MOUNT_INVALID');
  return ['create','--name',name,'--platform','linux/amd64','--network','none','--read-only','--user','65532:65532',
    '--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory',String(memoryBytes),'--memory-swap',String(memoryBytes),
    '--cpus','1','--pids-limit','32','--ulimit','nofile=128:128','--ulimit','core=0:0','--ulimit','fsize=1048576:1048576',
    '--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=33554432,mode=1777','--shm-size','1048576','--log-driver','none',
    ...mounts.flatMap(({source,target})=>['--mount',`type=bind,src=${source},dst=${target},readonly`]),
    '--entrypoint','node',imageId,'/app/research/gsap-quickjs/probe.mjs','--isolated'];
}

export function verifyProbeContainer(value,mounts) {
  const h=value?.HostConfig;
  if(h?.NetworkMode!=='none'||!h.ReadonlyRootfs||h.Privileged||h.Memory!==memoryBytes||h.MemorySwap!==memoryBytes
    ||h.NanoCpus!==1e9||h.PidsLimit!==32||value.Config?.User!=='65532:65532'||!h.CapDrop?.includes('ALL')
    ||!h.SecurityOpt?.some(x=>x==='no-new-privileges'||x==='no-new-privileges=true')
    ||!Array.isArray(value.Mounts)||value.Mounts.filter(x=>x.Type==='bind').length!==mounts.length
    ||!h.Tmpfs?.['/tmp']?.includes('size=33554432'))throw Error('GSAP_PROBE_SANDBOX_UNENFORCED');
  for(const expected of mounts)if(!value.Mounts.some(x=>x.Type==='bind'&&x.Source===expected.source&&x.Destination===expected.target&&!x.RW))throw Error('GSAP_PROBE_MOUNT_UNENFORCED');
  return {network:h.NetworkMode,readOnlyRoot:h.ReadonlyRootfs,user:value.Config.User,memoryBytes:h.Memory,cpuCount:1,pids:h.PidsLimit,tmpfs:h.Tmpfs};
}

function copyInput(source,destination) {
  const stat=lstatSync(source);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>1048576)throw Error('GSAP_PROBE_INPUT_INVALID');
  writeFileSync(destination,readFileSync(source),{mode:0o644,flag:'wx'});chmodSync(destination,0o644);
}

/** Only trusted orchestration runs on the host. Library evaluation stays in a fresh, bounded container. */
export async function runProbe({upstreamDirectory,signal}={}) {
  if(!upstreamDirectory)throw Error('GSAP_PROBE_UPSTREAM_REQUIRED');
  if(signal?.aborted)throw Error('GSAP_PROBE_CANCELLED');
  const upstream=resolve(upstreamDirectory),git=args=>execFileSync('git',['-C',upstream,...args],{encoding:'utf8',timeout:30000,maxBuffer:1048576}).trim();
  if(git(['rev-parse','HEAD'])!==baseline.commit||git(['status','--porcelain']).length
    ||git(['ls-files','--others','--ignored','--exclude-standard']).length)throw Error('GSAP_PROBE_UPSTREAM_MISMATCH');
  // Verifies the official Linux/cgroup-v2 host, current source tree and immutable image ID.
  const receipt=verifiedAdmissionImage();
  const scratch=mkdtempSync(join(tmpdir(),'promobento-gsap-probe-')),name='promobento-gsap-probe-'+randomUUID();
  const started=performance.now();let attempted=false,created=false,failure;
  const remaining=()=>{const ms=Math.ceil(timeoutMs-(performance.now()-started));if(ms<=0)throw Error('GSAP_PROBE_TIMEOUT');return ms;};
  const docker=async args=>{
    if(signal?.aborted)throw Error('GSAP_PROBE_CANCELLED');
    try {return (await execute('docker',args,{signal,timeout:remaining(),killSignal:'SIGKILL',maxBuffer:1048576,encoding:'utf8'})).stdout;}
    catch(error){if(signal?.aborted)throw Error('GSAP_PROBE_CANCELLED',{cause:error});if(error.killed)throw Error('GSAP_PROBE_TIMEOUT',{cause:error});throw error;}
  };
  try {
    const harness=join(scratch,'harness'),vendor=join(scratch,'vendor');
    for(const directory of [harness,vendor]){mkdirSync(directory);chmodSync(directory,0o755);}
    for(const file of ['probe.mjs','summary.mjs'])copyInput(new URL('./'+file,import.meta.url),join(harness,file));
    for(const file of ['gsap.min.js','GSAP-LICENSE.html','GSAP-LICENSE.txt'])copyInput(join(upstream,'templates/blank/vendor',file),join(vendor,file));
    const mounts=[{source:harness,target:targets[0]},{source:vendor,target:targets[1]}];
    attempted=true;await docker(probeSandboxArguments({name,imageId:receipt.imageId,mounts}));created=true;
    const isolation=verifyProbeContainer(parseCanonicalJson(await docker(['inspect',name]))[0],mounts);
    const report=parseCanonicalJson(await docker(['start','--attach',name]));
    const [state]=parseCanonicalJson(await docker(['inspect',name]));
    if(state.State?.Running||state.State?.OOMKilled||state.State?.ExitCode!==0)throw Error('GSAP_PROBE_EXECUTION_FAILED');
    const summary=summarizeProbe(report.results);
    if(report.kind!=='gsap_quickjs_probe'||report.research!==true||report.productionDependency!==false||report.sampleDecimalPlaces!==4)throw Error('GSAP_PROBE_RESULT_INVALID');
    remaining();
    return {...report,summary,provenance:{kind:'isolated_reproduction',upstreamCommit:baseline.commit,
      imageId:receipt.imageId,sourceTreeHash:receipt.sourceTreeHash,isolation,containerTimeoutMs:timeoutMs,containerElapsedMs:Math.ceil(performance.now()-started)}};
  } catch(error) {failure=error;throw error;}
  finally {
    try {
      // Never inherit cancellation here: a killed Docker client does not stop its container.
      if(attempted)try {await execute('docker',['rm','--force',name],{timeout:30000,killSignal:'SIGKILL',maxBuffer:1048576});}
      catch(error){if(created||!String(error.stderr).includes('No such container'))throw Error('GSAP_PROBE_CLEANUP_FAILED: '+name,{cause:failure??error});}
    } finally {rmSync(scratch,{recursive:true,force:true});}
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const controller=new AbortController(),cancel=()=>controller.abort();
  process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
  try {
    if(process.argv.length!==4||process.argv[2]!=='--upstream')throw Error('Usage: run.mjs --upstream DIRECTORY');
    const report=await runProbe({upstreamDirectory:process.argv[3],signal:controller.signal});
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  } catch(error){console.error(error.message);process.exitCode=1;}
  finally {process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);}
}
