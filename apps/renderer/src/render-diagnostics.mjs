import {readFileSync} from 'node:fs';
import {availableParallelism,cpus,totalmem} from 'node:os';
import {dirname,join} from 'node:path';

const hostMetrics=['seekMs','screenshotMs','frameFileWriteMs','pngDecodeMs','pixelHashMs','opticalQaMs','textQaMs','encoderWriteMs'];
const browserMetrics=['drawMs','resourceWaitMs','regionChecksMs','settleMs'];
const finiteMs=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const rounded=value=>Math.round(value*1000)/1000;
const summary=values=>{
  const sorted=[...values].sort((a,b)=>a-b);
  return {count:sorted.length,totalMs:rounded(values.reduce((total,value)=>total+value,0)),
    p50Ms:rounded(sorted[Math.ceil(sorted.length*0.5)-1]),p95Ms:rounded(sorted[Math.ceil(sorted.length*0.95)-1]),
    maxMs:rounded(sorted.at(-1))};
};

/** Keep overlapping browser details separate from the host's sequential work. */
export function createRenderDiagnostics(frameCount) {
  if(!Number.isSafeInteger(frameCount)||frameCount<1||frameCount>900)throw Error('DIAGNOSTIC_FRAME_COUNT_INVALID');
  const host=Object.fromEntries(hostMetrics.map(key=>[key,[]])),browser=Object.fromEntries(browserMetrics.map(key=>[key,[]]));
  let frames=0,encoderFinishMs=null;
  return {
    frame(index,measurement) {
      if(index!==frames||frames>=frameCount)throw Error('DIAGNOSTIC_FRAME_ORDER_INVALID');
      if(!measurement||hostMetrics.some(key=>!finiteMs(measurement[key]))
        ||browserMetrics.some(key=>!finiteMs(measurement.browser?.[key]))
        ||measurement.browser.resourceWaitMs>measurement.browser.drawMs+0.001)
        throw Error('DIAGNOSTIC_MEASUREMENT_INVALID');
      for(const key of hostMetrics)host[key].push(measurement[key]);
      for(const key of browserMetrics)browser[key].push(measurement.browser[key]);
      frames++;
    },
    finishEncoder(ms) {
      if(!finiteMs(ms)||encoderFinishMs!==null)throw Error('DIAGNOSTIC_ENCODER_FINISH_INVALID');
      encoderFinishMs=ms;
    },
    report() {
      if(frames!==frameCount||encoderFinishMs===null)throw Error('DIAGNOSTIC_COVERAGE_INCOMPLETE');
      return {scope:'forward_capture_only',frames,
        host:Object.fromEntries(Object.entries(host).map(([key,values])=>[key,summary(values)])),
        browserWithinSeek:Object.fromEntries(Object.entries(browser).map(([key,values])=>[key,summary(values)])),
        encoderFinishMs:rounded(encoderFinishMs),
        accounting:{browser:'Browser durations are nested inside host seekMs. resourceWaitMs is the union of videoFrames.get calls inside drawMs; prepare/font loading is excluded.',
          encoder:'encoderWriteMs is host pipe/backpressure wait; encoding overlaps capture. encoderFinishMs is final host wait, not total encoder CPU.',
          scope:'Forward frames only; excludes prepare, repeated/reverse/cold checks and clip encoding. Uninstrumented overhead remains in captureEncodeMs.',
          percentiles:'Per-frame observations in one fixture run, not production task p95.'}};
    }
  };
}

const readText=path=>{try{return readFileSync(path,'utf8').trim();}catch{return null;}};

/** Record visible limits; an unavailable measurement remains null, never an assumed runner size. */
export function inspectExecutionResources() {
  const root='/sys/fs/cgroup',membership=readText('/proc/self/cgroup')?.split('\n').find(line=>line.startsWith('0::'))?.slice(3);
  const paths=new Set([root]);
  if(membership?.startsWith('/')&&!membership.split('/').includes('..')) {
    let current=join(root,membership);
    while(current.startsWith(root+'/')) {paths.add(current);current=dirname(current);}
  }
  const limits=[...paths].map(path=>({path,cpuMax:readText(join(path,'cpu.max')),memoryMax:readText(join(path,'memory.max'))}))
    .filter(item=>item.cpuMax!==null||item.memoryMax!==null);
  const quotas=limits.flatMap(({cpuMax})=>{
    const parts=cpuMax?.split(/\s+/);
    return parts?.length===2&&/^\d+$/.test(parts[0])&&/^\d+$/.test(parts[1])&&Number(parts[1])>0
      ?[Number(parts[0])/Number(parts[1])]:[];
  });
  const memoryLimits=limits.flatMap(({memoryMax})=>/^\d+$/.test(memoryMax??'')?[Number(memoryMax)]:[]);
  const processors=cpus(),constrained=process.constrainedMemory();
  return {cpu:{model:processors[0]?.model??null,logicalCount:processors.length,availableParallelism:availableParallelism(),
      visibleQuotaCores:quotas.length?Math.min(...quotas):null},
    memory:{hostTotalBytes:totalmem(),processConstrainedBytes:constrained>0?constrained:null,
      visibleCgroupLimitBytes:memoryLimits.length?Math.min(...memoryLimits):null},
    cgroupV2:limits,
    cache:{browserArchive:'verified local archive; install/download excluded',browserProcess:'new process',
      decodedFrames:'empty at preparation; bounded cache reused within this run'},
    scope:'Observed local resources. Missing or unexposed quotas are not inferred from standard render profile.'};
}
