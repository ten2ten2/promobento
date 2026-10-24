// Trusted studio tools. The controller serializes calls and checks the task/frame scope first.
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './process.mjs';

export function assertStudioFrame(task,input,ready){
 if(!ready||task?.mode!=='studio'||input.taskId!==task.taskId||!Number.isInteger(input.frameIndex)||!task.job.frames.includes(input.frameIndex))throw Error('STUDIO_SCOPE_INVALID');
}

export async function checkStudio(session,task,frameIndex){
 const start=performance.now();await session.frame(frameIndex,{format:'png'});const captureEnd=performance.now();
 const observation=await session.observe(task.job.renderId,frameIndex);
 return{scope:'actual_frame_reading_observation_not_full_dynamic_Q1',frameIndex,captureMs:captureEnd-start,
  observeMs:performance.now()-captureEnd,totalMs:performance.now()-start,observation};
}

/** PNG reference vs independently decoded JPEG RGB pixels. Fixed formats/quality, no arbitrary command input. */
export async function benchmarkCapture(session,frameIndex,directory,signal){
 const temporary=mkdtempSync(join(directory,'capture-')),samples=[];
 try{
  for(const [format,quality]of [['png',92],['jpeg',90],['jpeg',92],['jpeg',95]]){
   const started=performance.now(),bytes=await session.frame(frameIndex,{format,quality});
   const captureMs=performance.now()-started,path=join(temporary,format==='png'?'reference.png':'quality-'+quality+'.jpg');
   writeFileSync(path,bytes);
   const sample={format:format==='png'?'png':'jpeg'+quality,captureMs,byteLength:bytes.length};
   if(format==='png')sample.reference=true;
   else{
    const {stderr}=await run('ffmpeg',['-v','info','-i',path,'-i',join(temporary,'reference.png'),'-filter_complex',
     '[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]ssim','-frames:v','1','-f','null','-'],{timeoutMs:15000,signal});
    const match=/All:([0-9.]+)/.exec(stderr),ssim=match?Number(match[1]):NaN;
    if(!Number.isFinite(ssim)||ssim<0||ssim>1)throw Error('CAPTURE_SSIM_UNAVAILABLE');sample.ssim=ssim;
   }
   samples.push(sample);
  }
  return{frameIndex,pixelComparison:'decoded_planar_rgb8_full_frame_ssim',samples};
 }finally{rmSync(temporary,{recursive:true,force:true});}
}
