import {realpathSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {canonical} from '../../../packages/contracts/src/canonical.mjs';
import {nativeProjectHash} from '../../../packages/contracts/src/native-project.mjs';
import {fileIdentity} from '../../../packages/native-motion/src/files.mjs';

/** Private diagnostic artifacts only. A blocked MP4 is never a deliverable output. */
export async function persistQualityFailure({task, base, evidence, broker}) {
  const path=realpathSync(join(base,'out','film.mp4')),inside=relative(base,path);
  if(!inside||inside.startsWith('../')||inside.startsWith('/')||!statSync(path).isFile()||statSync(path).size>50_000_000)
    throw Error('NATIVE_QA_EVIDENCE_PATH_INVALID');
  const actual=fileIdentity(path);
  if(evidence?.kind!=='encoded_quality_failure'||evidence.projectHash!==await nativeProjectHash(task.project)
    ||evidence.film?.name!=='film.mp4'||evidence.film.sha256!==actual.sha256
    ||evidence.film.byteLength!==actual.byteLength||evidence.dynamicQuality?.status!=='blocked'
    ||evidence.dynamicQuality.source!=='film.mp4'||!Array.isArray(evidence.dynamicQuality.findings)
    ||!evidence.dynamicQuality.findings.some(item=>item.severity==='block'))
    throw Error('NATIVE_QA_EVIDENCE_INVALID');
  const prefix=`renders/${task.renderId}/attempts/${task.taskId}/failed/`;
  const film=await broker.writeFile(prefix+'film.mp4',path,actual,'video/mp4');
  const report=await broker.write(prefix+'qa.json',Buffer.from(canonical({...evidence,film})),'application/json');
  return {film,report,signals:evidence.dynamicQuality.signals,findings:evidence.dynamicQuality.findings};
}
