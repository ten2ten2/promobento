import {copyFileSync,readFileSync,writeFileSync,lstatSync,mkdirSync,mkdtempSync,readdirSync,chmodSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {canonical,parseCanonicalJson} from '@promobento/contracts';
import {PNG} from 'pngjs';
import {verifiedAdmissionImage} from './admission-image.mjs';
import {runAdmissionSandbox} from './admission-sandbox.mjs';
import {sha256File} from './environment.mjs';

export function editEvidencePlan({frameIndex,width,height,totalFrames,point}) {
  if(!Number.isInteger(frameIndex)||![450,900].includes(totalFrames)||frameIndex<0||frameIndex>=totalFrames
    ||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>1920||height>1920)
    throw Error('EDIT_EVIDENCE_FRAME_INVALID');
  let detail=null;
  if(point!==undefined) {
    if(!point||Object.keys(point).sort().join(',')!=='x01,y01'
      ||![point.x01,point.y01].every(x=>Number.isFinite(x)&&x>=0&&x<=1))throw Error('EDIT_EVIDENCE_POINT_INVALID');
    const cw=Math.ceil(width/2),ch=Math.ceil(height/2);
    detail={crop:{x:Math.min(width-cw,Math.max(0,Math.round(point.x01*width-cw/2))),
      y:Math.min(height-ch,Math.max(0,Math.round(point.y01*height-ch/2))),width:cw,height:ch},scale:2};
  }
  return {version:'edit-evidence-v1',frameIndex,totalFrames,width,height,detail};
}

/** Trusted worker entry point: no source execution, URLs or caller-provided filter strings. */
export function writeEditEvidence({mediaPath,outputDirectory,...input}) {
  const plan=editEvidencePlan(input),out=resolve(outputDirectory);
  const probe=parseCanonicalJson(execFileSync('/usr/bin/ffprobe',['-v','error','-count_frames','-show_streams','-of','json',mediaPath],
    {timeout:30000,killSignal:'SIGKILL',maxBuffer:1024*1024}));
  const videos=probe.streams.filter(stream=>stream.codec_type==='video');
  if(videos.length!==1||videos[0].width!==plan.width||videos[0].height!==plan.height
    ||Number(videos[0].nb_read_frames)!==plan.totalFrames||videos[0].avg_frame_rate!=='30/1')throw Error('EDIT_EVIDENCE_MEDIA_MISMATCH');
  const extract=(name,filter,width,height)=>{
    const path=join(out,name);
    execFileSync('/usr/bin/ffmpeg',['-v','error','-nostdin','-threads','1','-i',mediaPath,'-map','0:v:0',
      '-filter_threads','1','-vf',filter,'-frames:v','1','-threads','1','-n',path],{timeout:30000,killSignal:'SIGKILL',maxBuffer:65536});
    const png=PNG.sync.read(readFileSync(path));
    if(png.width!==width||png.height!==height)throw Error('EDIT_EVIDENCE_IMAGE_MISMATCH');
    return {path:name,sha256:sha256File(path),width,height};
  };
  const select=`select=eq(n\\,${plan.frameIndex})`;
  const full=extract('full.png',select,plan.width,plan.height);
  let detail=null;
  if(plan.detail) {
    const {crop,scale}=plan.detail;
    detail={...extract('detail.png',`${select},format=rgb24,crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1,scale=${crop.width*scale}:${crop.height*scale}:flags=neighbor`,
      crop.width*scale,crop.height*scale),crop,scale};
  }
  const evidence={...plan,full,detail};
  writeFileSync(join(out,'evidence.json'),canonical(evidence)+'\n',{flag:'wx'});
  return evidence;
}

/** Decode the saved delivery in the pinned offline container, never guest code on the host. */
export async function captureEditEvidence({mediaPath,outputDirectory,signal,onCreated,expectedMediaSha256,...input}) {
  const plan=editEvidencePlan(input),stat=lstatSync(mediaPath);
  if(expectedMediaSha256!==undefined&&(typeof expectedMediaSha256!=='string'||!/^[a-f0-9]{64}$/u.test(expectedMediaSha256)))throw Error('EDIT_EVIDENCE_MEDIA_IDENTITY');
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>50000000)throw Error('EDIT_EVIDENCE_MEDIA_INVALID');
  const image=verifiedAdmissionImage(),out=resolve(outputDirectory);
  mkdirSync(out,{recursive:true});if(readdirSync(out).length)throw Error('EDIT_EVIDENCE_OUTPUT_NOT_EMPTY');
  const temporary=mkdtempSync(join(tmpdir(),'promobento-edit-evidence-'));
  const data=join(temporary,'input'),result=join(temporary,'output');
  try {
    mkdirSync(data,{mode:0o755});mkdirSync(result,{mode:0o777});chmodSync(result,0o777);
    copyFileSync(mediaPath,join(data,'video.mp4'));
    if(expectedMediaSha256!==undefined&&sha256File(join(data,'video.mp4'))!==expectedMediaSha256)throw Error('EDIT_EVIDENCE_MEDIA_IDENTITY');
    writeFileSync(join(data,'job.json'),canonical(input),{mode:0o644});
    let complete=false;
    await runAdmissionSandbox({image,mode:'edit-evidence',kind:'capture',input:{},signal,onCreated,timeoutMs:120000,
      mounts:[{source:data,target:'/input'},{source:result,target:'/output',readonly:false}],
      onLine(message){if(complete||message.kind!=='edit-evidence-complete'||message.frameIndex!==plan.frameIndex)throw Error('EDIT_EVIDENCE_RECEIPT');complete=true;}});
    if(!complete)throw Error('EDIT_EVIDENCE_INCOMPLETE');
    const evidence=parseCanonicalJson(readFileSync(join(result,'evidence.json')));
    const {full,detail,...identity}=evidence,{detail:expectedDetail,...expectedIdentity}=plan;
    if(canonical(identity)!==canonical(expectedIdentity)||full?.path!=='full.png'||full.width!==plan.width||full.height!==plan.height
      ||!(/^[a-f0-9]{64}$/u.test(full.sha256))||(expectedDetail?detail?.path!=='detail.png'
        ||canonical(detail.crop)!==canonical(expectedDetail.crop)||detail.scale!==2
        ||detail.width!==expectedDetail.crop.width*2||detail.height!==expectedDetail.crop.height*2
        ||!(/^[a-f0-9]{64}$/u.test(detail.sha256)):detail!==null))throw Error('EDIT_EVIDENCE_IDENTITY');
    const names=['evidence.json','full.png',...(plan.detail?['detail.png']:[])];
    if(canonical(readdirSync(result).sort())!==canonical(names.sort()))throw Error('EDIT_EVIDENCE_INVENTORY');
    for(const name of names) {
      const path=join(result,name),info=lstatSync(path);
      if(!info.isFile()||info.isSymbolicLink()||info.size>20000000)throw Error('EDIT_EVIDENCE_OUTPUT_INVALID');
      copyFileSync(path,join(out,name));
    }
    for(const item of [evidence.full,evidence.detail].filter(Boolean))item.path=join(out,item.path);
    return evidence;
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
