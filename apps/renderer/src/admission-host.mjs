import {execFileSync} from 'node:child_process';
import {parseCanonicalJson} from '@promobento/contracts';

export function assertAdmissionHost(info) {
  if(info.OSType!=='linux')throw Error('ADMISSION_LINUX_DAEMON_REQUIRED');
  if(String(info.CgroupVersion)!=='2')throw Error('ADMISSION_CGROUP_V2_REQUIRED: Docker daemon must enforce cgroup v2 limits');
  return {os:info.OSType,cgroupVersion:String(info.CgroupVersion)};
}

/** Inspect the daemon, not the macOS/Windows client hosting Docker Desktop. */
export function verifyAdmissionHost() {
  let info;
  try {info=parseCanonicalJson(execFileSync('docker',['info','--format','{{json .}}'],{timeout:30000,maxBuffer:1048576}));}
  catch(cause){throw Error('ADMISSION_DOCKER_UNAVAILABLE: start Docker Engine or Docker Desktop',{cause});}
  return assertAdmissionHost(info);
}
