import {writeFileSync} from 'node:fs';
import {canonical} from '@promobento/contracts/canonical';
import {compareSeam} from '@promobento/contracts/seams';
import {renderPageTiming} from '@promobento/contracts/render';

/** New WebGL coverage only. No model calls, soundtrack regeneration or repeat of the 2D engineering movie. */
export async function probeWebgl({json,call,request,rules,policy,directory}){
 const frames=[0,12,45,375],aspects={},operationId=request.job.operationId;
 const report={status:'running',scope:'webgl_studio_four_aspect_seek_not_full_G1_or_film_performance',aspects,peakMemory:{status:'unverified',reason:'studio_probe_does_not_collect_post_render_peak'}};
 const save=()=>writeFileSync(directory+'/webgl-report.json',canonical(report));
 const open=async(aspect,suffix)=>{
  const layout=rules.aspectLayouts[aspect],taskId='gl-'+operationId+'-'+aspect+'-'+suffix;
  return json('studio',{method:'POST',body:{schemaVersion:'3.0.0',kind:'render_task',mode:'studio',instance:'standard-3',taskId,
   job:{...request.job,renderId:taskId,aspectId:aspect,quality:'still',frames},
   options:{...request.options,target:{aspect,width:layout.width,height:layout.height,safeInsets:layout.safeInsets,fps:30,totalFrames:450},
    ...renderPageTiming({scenes:[{kind:'block',block:'device-3d@1'}]},policy.render)},inputs:request.inputs}});
 };
 const capture=async frame=>new Uint8Array(await(await call('operations/'+operationId+'/frames/'+frame)).arrayBuffer());
 const close=()=>call('operations/'+operationId+'/studio/close',{method:'POST'});
 try{for(const aspect of Object.keys(rules.aspectLayouts)){
  const comparisons=[],baseline=new Map(),started=Date.now(),session=await open(aspect,'warm');
  const timings=[];aspects[aspect]={status:'running',webgl:session.webgl??null,environmentHealth:session.environmentHealth??null,timings,comparisons};
  try{
   if(!session.webgl?.length||!session.webgl.every(value=>/SwiftShader/i.test(value.renderer)&&/WebGL 2/.test(value.version)))throw Error('WEBGL_RENDERER_UNVERIFIED');
   for(const frame of frames){const before=Date.now(),bytes=await capture(frame);timings.push({frame,captureRequestMs:Date.now()-before});baseline.set(frame,bytes);writeFileSync(`${directory}/webgl-${aspect}-${frame}.png`,bytes);}
   for(const frame of [...frames].reverse()){
    const bytes=await capture(frame),comparison=compareSeam(baseline.get(frame),bytes);
    comparisons.push({frame,mode:'reverse',...comparison});
    if(comparison.verdict==='RENDER_SEAM_BLOCK'){writeFileSync(`${directory}/webgl-${aspect}-${frame}-reverse.png`,bytes);throw Error('WEBGL_REVERSE_SEEK_BLOCK');}
   }
   aspects[aspect].elapsedMs=Date.now()-started;
  }finally{await close();save();}
  await open(aspect,'cold');
  try{
   const bytes=await capture(45),comparison=compareSeam(baseline.get(45),bytes);comparisons.push({frame:45,mode:'cold',...comparison});
   writeFileSync(`${directory}/webgl-${aspect}-45-cold.png`,bytes);
   if(comparison.verdict==='RENDER_SEAM_BLOCK')throw Error('WEBGL_COLD_SEEK_BLOCK');
   aspects[aspect].status='passed';
  }finally{await close();save();}
 }
 const leases=await json('capacity');if(leases.length)throw Error('WEBGL_LEASE_NOT_RETURNED');
 report.status='passed';report.leases=leases;save();return report;
 }catch(error){report.status='failed';report.error=String(error.stack??error);save();throw error;}
}
