import {readFileSync} from 'node:fs';

// Both kernel interfaces measure the container's cgroup high-water mark, not controller-only RSS.
const paths=['/sys/fs/cgroup/memory.peak','/sys/fs/cgroup/memory/memory.max_usage_in_bytes','/sys/fs/cgroup/memory.max_usage_in_bytes'];
export function memoryPeak(read = readFileSync) {
 for(const path of paths){
  let raw;
  try{raw=read(path,'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const bytes=Number(raw.trim());if(!Number.isSafeInteger(bytes)||bytes<=0)throw Error('RENDER_MEMORY_METRIC_INVALID');
  return{bytes,mib:Math.ceil(bytes/1048576),path};
 }
 return{bytes:null,mib:null,path:null,unavailableReason:'cgroup_peak_not_exposed'};
}
export function memoryHealth(){
 try{const peak=memoryPeak();return{available:peak.mib!==null,...peak};}
 catch(error){return{available:false,code:error.message,paths};}
}
export function filesystemDiagnostic(error){
 if(!['ENOENT','EACCES','ENOSPC','EROFS'].includes(error.code))return null;
 const path=typeof error.path==='string'&&/^(\/sys\/fs\/cgroup\/|\/proc\/|\/opt\/fonts\/|\/work\/)/.test(error.path)?error.path.slice(0,500):null;
 return{code:error.code,syscall:typeof error.syscall==='string'?error.syscall:null,path};
}
