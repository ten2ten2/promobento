import {featureLandings} from './brand-relay.ts';
/** The same local-frame landmarks are consumed by blocks and the immutable AudioPlan. */
export function blockEvents(id, frames, params) {
  const duration = frames.end - frames.start;
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
    if (scene.kind !== 'block') throw Error('CUSTOM_SCENES_NOT_IMPLEMENTED');
    return blockEvents(scene.block.split('@')[0], {start: scene.start, end: scene.end}, scene.params).map(event => ({...event, sceneId: scene.id}));
  });
}

/** Global settled reading holds, independent of how compute partitions the film. */
export function filmObservationFrames(spec,quality){
 const stride=quality==='review'?2:1;
 return [...new Set(spec.scenes.flatMap(scene=>{
  if(scene.kind!=='block')throw Error('CUSTOM_SCENES_NOT_IMPLEMENTED');
  const settled=scene.start+Math.max(45,...blockEvents(scene.block.split('@')[0],{start:scene.start,end:scene.end},scene.params).map(event=>event.frame+6));
  const hold=Math.min(scene.end-1,settled),middle=Math.floor((scene.start+scene.end)/2);
  return[hold,...(middle>=settled?[middle]:[])].map(frame=>Math.floor(frame/stride)*stride);
 }))].sort((a,b)=>a-b);
}
