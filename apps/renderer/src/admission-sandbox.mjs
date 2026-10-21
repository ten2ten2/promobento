import {spawn,execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {parseCanonicalJson} from '@promobento/contracts';
import {admissionPolicy} from './admission-image.mjs';

export function sandboxArguments({name,imageId,kind='engine',mounts=[]}) {
  if(!['engine','capture'].includes(kind)||!/^promobento-admission-[a-f0-9-]+$/u.test(name)||!/^sha256:[a-f0-9]{64}$/u.test(imageId))throw Error('ADMISSION_SANDBOX_ID');
  const limits=kind==='capture'?admissionPolicy.captureContainer:admissionPolicy.engineContainer;
  return ['create','--name',name,'--platform','linux/amd64','--interactive','--network','none','--read-only',
    '--user','65532:65532','--cap-drop','ALL','--security-opt','no-new-privileges=true',
    '--memory',String(limits.memoryBytes),'--memory-swap',String(limits.memoryBytes),'--cpus',String(limits.cpus),
    '--pids-limit',String(limits.pids),'--ulimit','nofile=256:256','--ulimit','core=0:0',
    // Only the data-only compositor executes its verified, privately extracted browser here.
    '--tmpfs',`/tmp:rw,nosuid,nodev,${kind==='engine'?'noexec':'exec'},size=${limits.tmpBytes},mode=1777`,
    '--shm-size','67108864','--log-driver','none',...mounts.flatMap(({source,target,readonly=true})=>{
      if(!source.startsWith('/')||source.includes(',')||!['/input','/output'].includes(target))throw Error('ADMISSION_MOUNT_INVALID');
      return ['--mount',`type=bind,src=${source},dst=${target}${readonly?',readonly':''}`];
    }),imageId];
}

export function verifySandboxConfiguration(container,{kind='engine',mounts=[]}={}) {
  const h=container.HostConfig,limits=kind==='capture'?admissionPolicy.captureContainer:admissionPolicy.engineContainer;
  if(!h||h.NetworkMode!=='none'||!h.ReadonlyRootfs||h.Privileged||h.Memory!==limits.memoryBytes
    ||h.MemorySwap!==limits.memoryBytes||h.NanoCpus!==limits.cpus*1e9||h.PidsLimit!==limits.pids
    ||container.Config.User!=='65532:65532'||!h.CapDrop?.includes('ALL')
    ||!h.SecurityOpt?.some(value=>value==='no-new-privileges=true'||value==='no-new-privileges')
    ||(container.Mounts??[]).filter(m=>m.Type==='bind').length!==mounts.length)
    throw Error('ADMISSION_SANDBOX_UNENFORCED');
  for(const expected of mounts) {
    const actual=container.Mounts.find(m=>m.Type==='bind'&&m.Destination===expected.target);
    if(!actual||actual.Source!==expected.source||actual.RW===(expected.readonly!==false))throw Error('ADMISSION_SANDBOX_MOUNT');
  }
  const tmpOptions=h.Tmpfs?.['/tmp'];
  if(typeof tmpOptions!=='string'||!tmpOptions.includes('size='+limits.tmpBytes)||!tmpOptions.includes('nodev')
    ||!tmpOptions.includes('nosuid')||(kind==='engine'&&!tmpOptions.includes('noexec')))
    throw Error('ADMISSION_SANDBOX_TMPFS');
  return {network:h.NetworkMode,readOnlyRoot:h.ReadonlyRootfs,user:container.Config.User,
    memoryBytes:h.Memory,memoryAndSwapBytes:h.MemorySwap,nanoCpus:h.NanoCpus,pids:h.PidsLimit,
    tmpfs:h.Tmpfs,capDrop:h.CapDrop,securityOpt:h.SecurityOpt};
}

/** Only this invocation's random container is removed; killing a Docker client alone is insufficient. */
export async function runAdmissionSandbox({image,mode,input,kind='engine',mounts=[],signal,timeoutMs=admissionPolicy.taskTimeoutMs,
  onLine,onCreated,maxOutputBytes=admissionPolicy.maxTransportBytes}) {
  const name='promobento-admission-'+randomUUID();
  const deadline=performance.now()+timeoutMs;
  const remaining=()=>{const value=Math.ceil(deadline-performance.now());if(value<=0)throw Error('ADMISSION_TASK_TIMEOUT');return value;};
  let child,timer,created=false,attempted=false,total=0,pending='',stderr='',failure,resourceReceipt;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  const kill=()=>{child?.kill('SIGKILL');};
  try {
    if(signal?.aborted)throw Error('ADMISSION_CANCELLED');
    attempted=true;
    onCreated?.(name);
    execFileSync('docker',[...sandboxArguments({name,imageId:image.imageId,kind,mounts}),mode],{timeout:Math.min(30000,remaining()),stdio:['ignore','pipe','pipe']});
    created=true;
    const [inspection]=parseCanonicalJson(execFileSync('docker',['inspect',name],{timeout:Math.min(30000,remaining()),maxBuffer:4*1024*1024}));
    resourceReceipt=verifySandboxConfiguration(inspection,{kind,mounts});
    if(signal?.aborted)throw Error('ADMISSION_CANCELLED');
    await new Promise((resolve,reject)=>{
      const fail=error=>{failure??=error;kill();};
      const abort=()=>fail(Error('ADMISSION_CANCELLED'));
      child=spawn('docker',['start','--attach','--interactive',name],{stdio:['pipe','pipe','pipe']});
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>fail(Error('ADMISSION_TASK_TIMEOUT')),remaining());
      child.stdout.on('data',chunk=>{
        try {
          total+=chunk.length;
          if(total>maxOutputBytes)throw Error('ADMISSION_OUTPUT_LIMIT');
          pending+=decoder.decode(chunk,{stream:true});
          let at;
          while((at=pending.indexOf('\n'))>=0) {
            const line=pending.slice(0,at);pending=pending.slice(at+1);
            if(Buffer.byteLength(line)>admissionPolicy.engine.maxOutputBytes+4096)throw Error('ADMISSION_OUTPUT_LINE_LIMIT');
            if(line)onLine?.(parseCanonicalJson(line));
          }
          if(Buffer.byteLength(pending)>admissionPolicy.engine.maxOutputBytes+4096)throw Error('ADMISSION_OUTPUT_LINE_LIMIT');
        } catch(error){fail(error);}
      });
      child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-4096);});
      child.stdin.on('error',()=>{});
      child.once('error',error=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(error);});
      child.once('close',code=>{
        clearTimeout(timer);signal?.removeEventListener('abort',abort);
        try {pending+=decoder.decode();}catch(error){failure??=error;}
        if(failure)reject(failure);
        else if(code!==0)reject(Error('ADMISSION_SANDBOX_FAILED: '+stderr.trim()));
        else if(pending.trim())reject(Error('ADMISSION_OUTPUT_TRUNCATED'));
        else resolve();
      });
      child.stdin.end(JSON.stringify(input)+'\n');
    });
    return {name,...resourceReceipt,transportBytes:total};
  } catch(error) {
    if(created) {
      try {
        const [inspection]=parseCanonicalJson(execFileSync('docker',['inspect',name],{timeout:5000,maxBuffer:4*1024*1024}));
        error.sandboxState={status:inspection.State.Status,exitCode:inspection.State.ExitCode,oomKilled:inspection.State.OOMKilled};
      } catch { /* Cleanup below remains mandatory even when diagnostics are unavailable. */ }
    }
    throw error;
  } finally {
    clearTimeout(timer);kill();
    if(attempted) {
      try {execFileSync('docker',['rm','--force',name],{timeout:30000,stdio:['ignore','pipe','pipe']});}
      catch(error){if(created||!String(error.stderr).includes('No such container'))throw Error('ADMISSION_CLEANUP_FAILED: '+name,{cause:error});}
    }
  }
}
