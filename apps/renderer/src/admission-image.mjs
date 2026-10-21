import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {parseCanonicalJson,digest,sourceFileDigests} from '@promobento/contracts';
import {repositoryFiles} from '../../../scripts/repo-documentation.mjs';

export const repository=fileURLToPath(new URL('../../../',import.meta.url));
export const imageReceiptPath=join(repository,'artifacts/admission-image.json');
export const admissionPolicy=parseCanonicalJson(readFileSync(new URL('../admission.policy.json',import.meta.url)));
export const admissionEnvironment=parseCanonicalJson(readFileSync(new URL('../admission.environment.json',import.meta.url)));
const allowed=path=>/^(apps\/renderer\/|packages\/|contracts\/|config\/|scripts\/|tests\/fixtures\/(render|admission)\/)/u.test(path)
  || ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml'].includes(path);

/** The actual executable image identity, not a hash supplied by the candidate. */
export function imageSources() {
  const files=repositoryFiles(repository).map(path=>({path:relative(repository,path).split('\\').join('/'),absolute:path}))
    .filter(file=>allowed(file.path)).map(({path,absolute})=>({path,bytes:readFileSync(absolute)}));
  return {files,sourceTreeHash:digest({files:sourceFileDigests(files)})};
}

export function buildAdmissionImage() {
  const {files,sourceTreeHash}=imageSources(),context=mkdtempSync(join(tmpdir(),'promobento-image-'));
  try {
    for(const {path,bytes} of files) {mkdirSync(dirname(join(context,path)),{recursive:true});writeFileSync(join(context,path),bytes);}
    const tag='promobento-admission:'+sourceTreeHash.slice(0,16);
    execFileSync('docker',['build','--platform',admissionEnvironment.platform,'--build-arg','SOURCE_TREE_HASH='+sourceTreeHash,
      '--tag',tag,'--file',join(context,'apps/renderer/docker/Dockerfile'),context],{stdio:'inherit',timeout:1200000});
    const [image]=parseCanonicalJson(execFileSync('docker',['image','inspect',tag],{timeout:30000,maxBuffer:4*1024*1024}));
    const receipt={kind:'admission_image',imageId:image.Id,sourceTreeHash,platform:admissionEnvironment.platform,
      environment:admissionEnvironment,createdAt:new Date().toISOString()};
    mkdirSync(dirname(imageReceiptPath),{recursive:true});writeFileSync(imageReceiptPath,JSON.stringify(receipt,null,2)+'\n');
    return receipt;
  } finally {rmSync(context,{recursive:true,force:true});}
}

export function verifiedAdmissionImage() {
  let receipt;
  try {receipt=parseCanonicalJson(readFileSync(imageReceiptPath));} catch {throw Error('ADMISSION_IMAGE_REQUIRED: run build:admission');}
  if(!/^sha256:[0-9a-f]{64}$/u.test(receipt.imageId)||receipt.sourceTreeHash!==imageSources().sourceTreeHash)
    throw Error('ADMISSION_IMAGE_STALE: run build:admission');
  const [image]=parseCanonicalJson(execFileSync('docker',['image','inspect',receipt.imageId],{timeout:30000,maxBuffer:4*1024*1024}));
  if(image.Id!==receipt.imageId||image.Os!=='linux'||image.Architecture!=='amd64'
    ||image.Config.Labels?.['com.promobento.admission.source-tree']!==receipt.sourceTreeHash)
    throw Error('ADMISSION_IMAGE_MISMATCH');
  return receipt;
}
