import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,readdirSync,lstatSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseCanonicalJson,digest,sourceFileDigests} from '../../packages/contracts/index.mjs';
import {sha256File} from '../../apps/renderer/src/browser-bundle.mjs';
import {verifyAdmissionHost} from '../../apps/renderer/src/admission-host.mjs';

export const baseline=parseCanonicalJson(readFileSync(new URL('./baseline.json',import.meta.url)));
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const command=(args,options={})=>execFileSync('docker',args,{timeout:30000,maxBuffer:4*1024*1024,...options});

function tree(directory,{maxBytes=64*1024*1024,maxFiles=4096}={}) {
  const files=[];let bytes=0;
  const walk=(current,prefix='')=>{
    for(const item of readdirSync(current,{withFileTypes:true})) {
      const name=prefix+item.name,path=join(current,item.name),stat=lstatSync(path);
      if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory()))throw Error('BASELINE_SOURCE_ENTRY_INVALID');
      if(stat.isDirectory())walk(path,name+'/');
      else {
        if((bytes+=stat.size)>maxBytes||files.length>=maxFiles)throw Error('BASELINE_SOURCE_LIMIT');
        files.push({path:name,bytes:readFileSync(path)});
      }
    }
  };
  if(!lstatSync(directory).isDirectory()||lstatSync(directory).isSymbolicLink())throw Error('BASELINE_SOURCE_DIRECTORY');
  walk(directory);return {files,sourceHash:digest({files:sourceFileDigests(files)})};
}

export function baselineSandboxArguments({name,imageId,mounts}) {
  if(!/^promobento-baseline-[a-f0-9-]+$/u.test(name)||!/^sha256:[0-9a-f]{64}$/u.test(imageId))throw Error('BASELINE_SANDBOX_ID');
  return ['create','--name',name,'--platform','linux/amd64','--interactive','--network','none','--read-only','--user','65532:65532',
    '--cap-drop','ALL','--security-opt','no-new-privileges=true','--memory','3221225472','--memory-swap','3221225472',
    '--cpus','2','--pids-limit','256','--ulimit','nofile=1024:1024','--ulimit','core=0:0','--ulimit','fsize=536870912:536870912',
    '--tmpfs','/tmp:rw,nosuid,nodev,exec,size=2147483648,mode=1777','--shm-size','67108864','--log-driver','none',
    ...mounts.flatMap(({source,target})=>{
      if(!source.startsWith('/')||source.includes(',')||!['/upstream','/project','/harness'].includes(target))throw Error('BASELINE_MOUNT_INVALID');
      return ['--mount',`type=bind,src=${source},dst=${target},readonly`];
    }),'--entrypoint','node',imageId,'/harness/baseline-worker.mjs'];
}

function verifyContainer(value,mounts) {
  const h=value.HostConfig;
  if(h?.NetworkMode!=='none'||!h.ReadonlyRootfs||h.Privileged||h.Memory!==3221225472||h.MemorySwap!==3221225472
    ||h.NanoCpus!==2e9||h.PidsLimit!==256||value.Config.User!=='65532:65532'||!h.CapDrop?.includes('ALL')
    ||!h.SecurityOpt?.some(x=>x==='no-new-privileges'||x==='no-new-privileges=true')
    ||value.Mounts.filter(x=>x.Type==='bind').length!==mounts.length)throw Error('BASELINE_SANDBOX_UNENFORCED');
  for(const expected of mounts)if(!value.Mounts.some(x=>x.Type==='bind'&&x.Source===expected.source&&x.Destination===expected.target&&!x.RW))throw Error('BASELINE_MOUNT_UNENFORCED');
  if(!h.Tmpfs?.['/tmp']?.includes('size=2147483648'))throw Error('BASELINE_DISK_UNBOUNDED');
  return {network:h.NetworkMode,readOnlyRoot:h.ReadonlyRootfs,user:value.Config.User,memoryBytes:h.Memory,cpuCount:2,pids:h.PidsLimit,tmpfs:h.Tmpfs};
}

/** Fixed upstream code is never imported on the host. No Docker socket or writable host path enters the container. */
export async function runHuashuBaseline({upstreamDirectory,projectDirectory,outputDirectory,durationSeconds,imageReceipt,signal,timeoutMs=600000}) {
  if(![15,30].includes(durationSeconds)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error('BASELINE_ARGUMENT_INVALID');
  verifyAdmissionHost();
  const git=args=>execFileSync('git',['-C',upstreamDirectory,...args],{encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024}).trim();
  if(git(['rev-parse','HEAD'])!==baseline.commit||git(['status','--porcelain']).length||git(['ls-files','--others','--ignored','--exclude-standard']).length)throw Error('BASELINE_UPSTREAM_MISMATCH');
  const receipt=imageReceipt??parseCanonicalJson(readFileSync(join(root,'artifacts/admission-image.json')));
  if(!/^sha256:[0-9a-f]{64}$/u.test(receipt.imageId)||!/^\w{64}$/u.test(receipt.sourceTreeHash))throw Error('BASELINE_IMAGE_RECEIPT');
  const [image]=parseCanonicalJson(command(['image','inspect',receipt.imageId]));
  if(image.Id!==receipt.imageId||image.Os!=='linux'||image.Architecture!=='amd64'||image.Config.Labels?.['com.promobento.admission.source-tree']!==receipt.sourceTreeHash)throw Error('BASELINE_IMAGE_MISMATCH');
  const scratch=mkdtempSync(join(tmpdir(),'promobento-baseline-')),name='promobento-baseline-'+randomUUID(),nonce=randomUUID();
  let attempted=false,created=false,child,timer,failure;
  const started=performance.now();
  const remaining=()=>{const ms=Math.ceil(timeoutMs-(performance.now()-started));if(ms<=0)throw Error('BASELINE_TIMEOUT');return ms;};
  try {
    const upstream=join(scratch,'upstream'),project=join(scratch,'project'),harness=join(scratch,'harness');
    mkdirSync(upstream);mkdirSync(harness);
    // Minimal runtime: no examples, likeness, fonts, samples, models, Git metadata or user credentials.
    for(const file of ['cli','package.json','LICENSE','THIRD_PARTY.md','runtime/om.js','runtime/om-engine.js','templates/blank/vendor']) {
      mkdirSync(dirname(join(upstream,file)),{recursive:true});cpSync(join(upstreamDirectory,file),join(upstream,file),{recursive:true});
    }
    tree(upstream,{maxBytes:32*1024*1024});
    const source=tree(resolve(projectDirectory));
    for(const {path,bytes} of source.files) {mkdirSync(dirname(join(project,path)),{recursive:true});writeFileSync(join(project,path),bytes);}
    if(!source.files.some(x=>x.path==='index.html'))throw Error('BASELINE_ENTRY_REQUIRED');
    copyFileSync(new URL('./baseline-worker.mjs',import.meta.url),join(harness,'baseline-worker.mjs'));
    const mounts=[{source:upstream,target:'/upstream'},{source:project,target:'/project'},{source:harness,target:'/harness'}];
    if(signal?.aborted)throw Error('BASELINE_CANCELLED');
    attempted=true;
    command([...baselineSandboxArguments({name,imageId:receipt.imageId,mounts}),String(durationSeconds),nonce],{timeout:Math.min(30000,remaining())});created=true;
    const isolation=verifyContainer(parseCanonicalJson(command(['inspect',name]))[0],mounts);
    let log='';
    await new Promise((resolve,reject)=>{
      const stop=error=>{failure??=error;child?.kill('SIGKILL');};
      const abort=()=>stop(Error('BASELINE_CANCELLED'));
      child=spawn('docker',['start','--attach','--interactive',name],{stdio:['pipe','pipe','pipe']});
      timer=setTimeout(()=>stop(Error('BASELINE_TIMEOUT')),remaining());
      signal?.addEventListener('abort',abort,{once:true});
      let output='';
      child.stdout.on('data',chunk=>{
        output+=chunk.toString('utf8');
        if(output.length>4096){stop(Error('BASELINE_HANDSHAKE_LIMIT'));return;}
        if(output==='BASELINE_RESULT_READY '+nonce+'\n') {
          try {if(failure)throw failure;if(signal?.aborted)throw Error('BASELINE_CANCELLED');remaining();resolve();}catch(error){reject(error);}
        }
      });
      child.stdin.on('error',()=>{});
      child.stderr.on('data',chunk=>{log=(log+chunk.toString('utf8')).slice(-32768);});
      child.once('error',reject);
      child.once('close',code=>{
        clearTimeout(timer);signal?.removeEventListener('abort',abort);
        try {
          if(failure)throw failure;if(signal?.aborted)throw Error('BASELINE_CANCELLED');remaining();
          const marker=log.split('\n').find(line=>line.startsWith('BASELINE_ERROR '+nonce+' '));
          const contentCode=marker?.slice(('BASELINE_ERROR '+nonce+' ').length);
          const known=new Set(['BASELINE_OUTPUT_COUNT','BASELINE_OUTPUT_SPEC','BASELINE_NONDETERMINISTIC','BASELINE_COLD_NONDETERMINISTIC','BASELINE_PAGE_ERRORS','BASELINE_AUDIO_MUST_USE_FROZEN_TRACK']);
          throw Object.assign(Error(known.has(contentCode)?contentCode:'BASELINE_EXECUTION_FAILED'),{details:{exitCode:code,stderr:log.slice(-16384)}});
        }catch(error){reject(error);}
      });
    });
    const output=resolve(outputDirectory);mkdirSync(output,{recursive:true});
    for(const file of ['sample.mp4','report.json']) {
      const destination=join(output,file);
      // docker cp does not expose this daemon's tmpfs mount. Read a fixed file
      // through Docker exec while the isolated worker keeps the mount alive.
      const limit=file.endsWith('.mp4')?50000000:4*1024*1024;
      const bytes=command(['exec',name,'node','-e',
        'const f=require("node:fs");const p=process.argv[1],s=f.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.size>Number(process.argv[2]))process.exit(2);process.stdout.write(f.readFileSync(p));',
        '/tmp/result/'+file,String(limit)],{timeout:Math.min(30000,remaining()),maxBuffer:limit});
      writeFileSync(destination,bytes,{flag:'wx'});
      const stat=lstatSync(destination);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>(file.endsWith('.mp4')?50000000:4*1024*1024))throw Error('BASELINE_ARTIFACT_INVALID');
    }
    const report=parseCanonicalJson(readFileSync(join(output,'report.json')));
    if(failure)throw failure;if(signal?.aborted)throw Error('BASELINE_CANCELLED');remaining();
    if(report.artifactSha256!==sha256File(join(output,'sample.mp4')))throw Error('BASELINE_ARTIFACT_MISMATCH');
    const result={...report,status:'passed',baseline,image:{imageId:receipt.imageId,sourceTreeHash:receipt.sourceTreeHash},sourceHash:source.sourceHash,
      isolation,hostTotalMs:Math.ceil(performance.now()-started),log};
    writeFileSync(join(output,'report.json'),JSON.stringify(result,null,2)+'\n');return result;
  } catch(error) {
    failure=error;
    if(created)try {const [container]=parseCanonicalJson(command(['inspect',name]));error.sandboxState=container.State;}catch{}
    throw error;
  } finally {
    clearTimeout(timer);child?.kill('SIGKILL');
    try {if(attempted)command(['rm','--force',name]);}
    catch(error){if(created||!String(error.stderr).includes('No such container'))throw Error('BASELINE_CLEANUP_FAILED: '+name,{cause:failure??error});}
    finally {rmSync(scratch,{recursive:true,force:true});}
  }
}
