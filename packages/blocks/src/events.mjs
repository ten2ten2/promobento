import {featureLandings} from './brand-relay.ts';
import {journeyLandings} from './journey-motion.ts';
import {customScenePlan} from '@promobento/contracts/custom-source';
/** The same local-frame landmarks are consumed by blocks and the immutable AudioPlan. */
export function blockEvents(id, frames, params) {
  const duration = frames.end - frames.start;
  if(id==='ui-journey'&&params.beatFrames!==undefined){
    const landings=journeyLandings(params.items.length,params.beatFrames);
    if(landings.at(-1)+params.beatFrames>duration)throw Error('JOURNEY_READING_HOLD_MISSING');
    return landings.map((frame,index)=>({name:index===params.items.length-1?'product-land':'product-step-'+(index+1),frame}));
  }
  if(id==='feature-grid'&&params.beatFrames!==undefined){
    const landings=featureLandings(params.items.length,params.beatFrames);
    if(landings.at(-1)>=duration)throw Error('FEATURE_BEAT_AFTER_SCENE');
    return landings.map((frame,index)=>({name:index===params.items.length-1?'feature-land':'feature-step-'+(index+1),frame}));
  }
  const fixed = {'hook-title': ['title-land', 18], 'ui-showcase': ['product-land', 21], 'cta-endcard': ['cta-land', 15],
    metric: ['metric-land', 36], 'talking-head': ['speaker-land', 15], 'device-3d':['product-land',24]};
  let event = fixed[id];
  if (id === 'feature-grid' || id === 'curriculum') event = [id === 'curriculum' ? 'module-land' : 'feature-land', Math.round(((params.items.length - 1) * .12 + .5) * 30)];
  if (id === 'ui-journey') event = ['product-land', Math.max(0, duration - 24)];
  if (id === 'captions') event = ['caption-land', params.cues[0].start];
  if (!event) throw Error('BLOCK_UNKNOWN');
  return [{name: event[0], frame: Math.min(duration - 1, event[1])}];
}
export function filmBlockEvents(spec) {
  return spec.scenes.flatMap(scene => {
    if(scene.kind==='custom')return customScenePlan(scene).events.map(event=>({...event,sceneId:scene.id}));
    return blockEvents(scene.block.split('@')[0], {start: scene.start, end: scene.end}, scene.params).map(event => ({...event, sceneId: scene.id}));
  });
}

/** Global settled reading holds, independent of how compute partitions the film. */
export function filmObservationFrames(spec,quality){
 const stride=quality==='review'?2:1;
 return [...new Set(spec.scenes.flatMap(scene=>{
  if(scene.kind==='custom')return customScenePlan(scene).readingHolds.map(hold=>Math.floor((scene.start+Math.floor((hold.start+hold.end-1)/2))/stride)*stride);
  if(scene.block==='ui-journey@1'&&scene.params.beatFrames!==undefined)
   return blockEvents('ui-journey',scene,scene.params).map(event=>Math.floor((scene.start+event.frame+Math.floor(scene.params.beatFrames/2))/stride)*stride);
  const settled=scene.start+Math.max(45,...blockEvents(scene.block.split('@')[0],{start:scene.start,end:scene.end},scene.params).map(event=>event.frame+6));
  const hold=Math.min(scene.end-1,settled),middle=Math.floor((scene.start+scene.end)/2);
  return[hold,...(middle>=settled?[middle]:[])].map(frame=>Math.floor(frame/stride)*stride);
 }))].sort((a,b)=>a-b);
}

/** Actual choreography poses for visual review, separate from settled text QA. */
export function filmMotionFrames(spec,quality,{eventNeighborhoods=true}={}){
 const stride=quality==='review'?2:1;
 return [...new Set(spec.scenes.flatMap(scene=>{
  if(scene.kind==='custom'){
   const events=[...customScenePlan(scene).events].sort((a,b)=>a.frame-b.frame),around=[...events.map(event=>scene.start+event.frame),
    ...(eventNeighborhoods?events.slice(0,2).flatMap(event=>[-6,6].map(offset=>Math.max(scene.start,Math.min(scene.end-1,scene.start+event.frame+offset)))):[])];
   const handoff=(eventNeighborhoods?[scene.start-2,scene.start,scene.start+6,scene.end-6,scene.end-1,scene.end]:[scene.start,scene.end-1])
    .filter(frame=>frame>=0&&(spec.totalFrames===undefined||frame<spec.totalFrames));
   return [...new Set([...handoff,...around,...Array.from({length:Math.ceil((scene.end-scene.start)/30)},(_,i)=>scene.start+i*30)])]
    .map(frame=>Math.floor(frame/stride)*stride);
  }
  if(scene.block==='ui-journey@1'&&scene.params.beatFrames!==undefined)
   return blockEvents('ui-journey',scene,scene.params).flatMap(event=>[event.frame-Math.ceil(scene.params.beatFrames/2),event.frame])
    .map(frame=>Math.floor((scene.start+frame)/stride)*stride);
  if(scene.block!=='feature-grid@1'||!scene.params.logoKey||scene.params.beatFrames===undefined)return[];
  const landings=blockEvents('feature-grid',scene,scene.params).map(event=>scene.start+event.frame);
  return landings.flatMap((frame,index)=>index?[Math.floor((landings[index-1]+frame)/2),frame]:[frame])
   .map(frame=>Math.floor(frame/stride)*stride);
 }))].sort((a,b)=>a-b);
}
