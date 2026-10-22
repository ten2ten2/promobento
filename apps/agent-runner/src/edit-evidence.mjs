import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {digest,parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {sha256} from '../../renderer/src/environment.mjs';
import {presets} from './schema.mjs';
import {targets} from '../../../packages/contracts/index.mjs';

/** Paths originate in an accepted candidate; still reject traversal and symlink substitution. */
export function privateFile(root,path,maxBytes=50000000) {
  if(typeof path!=='string'||isAbsolute(path))throw Error('LOCAL_AGENT_EDIT_EVIDENCE_PATH');
  const base=realpathSync(root),absolute=resolve(base,path),rel=relative(base,absolute);
  if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('LOCAL_AGENT_EDIT_EVIDENCE_PATH');
  let current=base;for(const part of rel.split(sep)){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw Error('LOCAL_AGENT_EDIT_EVIDENCE_PATH');}
  const stat=lstatSync(absolute);
  if(!stat.isFile()||stat.size<=0||stat.size>maxBytes)throw Error('LOCAL_AGENT_EDIT_EVIDENCE_FILE');
  return {path:absolute,bytes:readFileSync(absolute)};
}
function imageFile(store,output,image) {
  if(!image||typeof image.path!=='string'||!image.path.startsWith(resolve(output)+sep))throw Error('LOCAL_AGENT_EDIT_EVIDENCE_PATH');
  const file=privateFile(store.root,relative(store.root,image.path),8*1024*1024);
  if(file.bytes.length<24||sha256(file.bytes)!==image.sha256||!file.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('LOCAL_AGENT_EDIT_EVIDENCE_IMAGE');
  const width=file.bytes.readUInt32BE(16),height=file.bytes.readUInt32BE(20);
  if(width!==image.width||height!==image.height||width<1||height<1||width>4096||height>4096)throw Error('LOCAL_AGENT_EDIT_EVIDENCE_IMAGE');
  return {metadata:{...image,path:relative(store.root,image.path)},dataUrl:'data:image/png;base64,'+file.bytes.toString('base64')};
}
export async function collectEditEvidence({store,project,base,comments,operationId,capture,signal}) {
  const evidence=[],images=[];
  for(const [index,comment]of comments.entries()) {
    signal?.throwIfAborted();
    const target=base.candidate.targets[comment.targetId],layout=targets(presets).find(item=>item.targetId===comment.targetId)?.layout;
    if(!target||!layout||!Number.isSafeInteger(comment.frameIndex)||comment.frameIndex<0||comment.frameIndex>=project.durationSeconds*30)throw Error('LOCAL_AGENT_EDIT_EVIDENCE_IDENTITY');
    // screenshotAssetId is untrusted metadata, never an alternate file selector.
    // The renderer admits 16 MiB of observations and writes a larger, pretty-printed report.
    const report=parseCanonicalJson(privateFile(store.root,target.report,64*1024*1024).bytes);
    if(report.status!=='passed'||report.sourceHash!==target.sourceHash||report.sourceArchiveHash!==target.sourceArchiveHash||report.qaInputHash!==target.qaInputHash||!report.capture?.video?.sha256)
      throw Error('LOCAL_AGENT_EDIT_EVIDENCE_IDENTITY');
    const media=privateFile(store.root,target.media),mediaSha256=sha256(media.bytes);
    if(mediaSha256!==report.capture.video.sha256||(target.mediaSha256&&mediaSha256!==target.mediaSha256))throw Error('LOCAL_AGENT_EDIT_EVIDENCE_IDENTITY');
    const outputDirectory=join(store.root,'operations',operationId,'edit-evidence',String(index));
    const point=comment.normalizedPoint?{x01:comment.normalizedPoint.x,y01:comment.normalizedPoint.y}:undefined;
    const captured=await capture({mediaPath:media.path,expectedMediaSha256:mediaSha256,frameIndex:comment.frameIndex,totalFrames:project.durationSeconds*30,
      width:layout.width,height:layout.height,point,outputDirectory,signal});
    if(captured.version!=='edit-evidence-v1'||captured.frameIndex!==comment.frameIndex||captured.totalFrames!==project.durationSeconds*30||
      captured.width!==layout.width||captured.height!==layout.height||captured.full?.width!==layout.width||captured.full?.height!==layout.height||Boolean(captured.detail)!==Boolean(point))throw Error('LOCAL_AGENT_EDIT_EVIDENCE_IDENTITY');
    const full=imageFile(store,outputDirectory,captured.full),detail=captured.detail?imageFile(store,outputDirectory,captured.detail):null;
    if(detail&&(captured.detail.scale!==2||captured.detail.width!==captured.detail.crop.width*2||captured.detail.height!==captured.detail.crop.height*2))throw Error('LOCAL_AGENT_EDIT_EVIDENCE_IMAGE');
    const binding={projectId:project.id,workspaceId:project.workspaceId,revisionId:base.candidate.id,targetId:comment.targetId,frameIndex:comment.frameIndex,
      commentIndex:index,commentHash:digest(comment),sourceHash:target.sourceHash,sourceArchiveHash:target.sourceArchiveHash,qaInputHash:target.qaInputHash,mediaSha256,
      full:full.metadata,detail:detail?.metadata??null};
    evidence.push(binding);
    images.push({label:`comment ${index}: saved revision ${base.candidate.id}, ${comment.targetId}, frame ${comment.frameIndex}, full frame`,dataUrl:full.dataUrl});
    if(detail)images.push({label:`comment ${index}: same saved frame, 2x detail near normalized point ${point.x01},${point.y01}`,dataUrl:detail.dataUrl});
  }
  store.write('operations/'+operationId+'/edit-evidence.json',{version:'edit-evidence-v1',evidence});
  return {evidence,images};
}
