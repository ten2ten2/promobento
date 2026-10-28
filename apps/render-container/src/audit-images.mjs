import {mkdirSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {run} from './process.mjs';

// Advisory images use only pixels from the validated output. They are not pointer tracking.
export function selectAuditWindows(audit){
  if(audit.status!=='measured')return {windows:[],omitted:0};
  const {fps,frames}=audit, candidates=[];
  if(audit.firstFrame.empty)candidates.push({kind:'opening',center:0});
  for(const pop of audit.pops)candidates.push({kind:'flash',center:Math.round(pop.at*fps)});
  // End cards are often deliberately still. Examine content holds before those, without removing either from the report.
  const endCardStart=frames/fps-3;
  for(const span of [...audit.dead].sort((a,b)=>Number(a.from>=endCardStart)-Number(b.from>=endCardStart)||b.seconds-a.seconds))
    candidates.push({kind:'low_motion',center:Math.round((span.from+(span.to-span.from)*.75)*fps)});
  const chosen=candidates.slice(0,2);
  return {windows:chosen.map(({kind,center})=>{
    const start=Math.max(0,Math.min(frames-Math.min(6,frames),center-(kind==='opening'?0:2)));
    const indices=Array.from({length:Math.min(6,frames)},(_,i)=>start+i);
    return {kind,indices,frames:indices.map(index=>Math.round(index*30/fps))};
  }),omitted:Math.max(0,candidates.length-chosen.length)};
}

/** Largest changing quarter on a higher-resolution diagnostic grid; it may still miss a small cursor. */
export function changingDetail(bytes,count){
  const w=320,h=180,size=w*h;if(bytes.length!==size*count)throw Error('AUDIT_IMAGE_FRAME_COUNT_MISMATCH');
  const totals=Array(16).fill(0);
  for(let f=1;f<count;f++)for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const p=y*w+x,cell=Math.floor(y*4/h)*4+Math.floor(x*4/w);
    totals[cell]+=Math.abs(bytes[f*size+p]-bytes[(f-1)*size+p]);
  }
  const maximum=Math.max(...totals);if(!maximum)return null;
  const cell=totals.indexOf(maximum),clamp=value=>Math.max(0,Math.min(.5,value));
  return {x:clamp((cell%4+.5)/4-.25),y:clamp((Math.floor(cell/4)+.5)/4-.25),width:.5,height:.5,
    selection:'largest_difference_on_320x180_grid_not_pointer_tracking'};
}

export async function auditImages(path,audit,{directory,signal}){
  const selection=selectAuditWindows(audit),dir=join(directory,'audit-frames');
  if(!selection.windows.length)return {status:'no_suspicious_windows',omitted:selection.omitted,sheets:[]};
  mkdirSync(dir,{recursive:true});const sheets=[];
  try{
    for(const [group,window] of selection.windows.entries()){
      const select=window.indices.map(index=>`eq(n\\,${index})`).join('+');
      const {stdout}=await run('ffmpeg',['-v','error','-i',path,'-vf',`select=${select},scale=320:180,format=gray`,'-fps_mode','vfr','-f','rawvideo','-'],{signal,timeoutMs:15000});
      const crop=changingDetail(stdout,window.indices.length);
      for(const [view,region] of [['overview',null],...(crop?[['detail',crop]]:[])]){
        const name=`audit-frames/${group}-${view}.jpg`,file=join(directory,name);
        const cropFilter=region?`,crop=iw/2:ih/2:iw*${region.x}:ih*${region.y}`:'';
        await run('ffmpeg',['-v','error','-y','-i',path,'-vf',`select=${select}${cropFilter},scale=320:-2,tile=3x2:padding=4:margin=4:color=0x28323d`,
          '-frames:v','1','-q:v','8','-update','1',file],{signal,timeoutMs:15000});
        if(!statSync(file).size||statSync(file).size>1<<20)throw Error('AUDIT_IMAGE_SIZE_INVALID');
        sheets.push({path:name,kind:window.kind,view,frames:window.frames,...(region?{crop:region}:{})});
      }
    }
    return {status:'available',fps:audit.fps,frameTimelineFps:30,omitted:selection.omitted,sheets};
  }catch(error){
    rmSync(dir,{recursive:true,force:true});
    if(signal?.aborted)throw error;
    if(!['MEDIA_PROCESS_FAILED','MEDIA_PROCESS_TIMEOUT','AUDIT_IMAGE_FRAME_COUNT_MISMATCH','AUDIT_IMAGE_SIZE_INVALID'].includes(error.message))throw error;
    return {status:'unavailable',reason:error.message,omitted:selection.omitted,sheets:[]};
  }
}
