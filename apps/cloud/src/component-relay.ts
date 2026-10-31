import type {Json} from './pipeline-types.ts';

/** A coordinate is a model observation, not independently verified pixel geometry. */
export function relayObservationIssues(film:Json,insights:Json[],resources:Json[],{requireBehavior=false}:{requireBehavior?:boolean}={}){
  const issues:Array<{code:string;path:string}>=[];
  const observedRegion=(key:string,focus:string)=>{
    const slot=film.assets[key],resource=resources.find(item=>item.resourceId===slot?.resourceId),roi=slot?.roi?.[Number(String(focus).slice(4))];
    return roi&&insights.find(item=>item.sha256===resource?.sha256)?.regions?.find((region:Json)=>['x','y','width','height'].every(field=>region.box?.[field]===roi[field]));
  };
  for(const [index,scene] of film.scenes.entries()){
    if(scene.kind==='block'&&scene.block==='vox-clip@1'){
      for(const [itemIndex,item]of (scene.params.items??[]).entries())if(item.focus&&!observedRegion(item.assetKey,item.focus))
        issues.push({code:'VOX_ROI_NOT_OBSERVED',path:`/scenes/${index}/params/items/${itemIndex}/focus`});
    }
    if(scene.kind!=='block'||scene.block!=='component-relay@1')continue;
    if(requireBehavior&&!scene.params.componentBehavior)
      issues.push({code:'RELAY_COMPONENT_BEHAVIOR_REQUIRED',path:`/scenes/${index}/params/componentBehavior`});
    const key=scene.params.items?.[0]?.assetKey,observed=observedRegion(key,scene.params.focus);
    if(!observed)
      issues.push({code:'RELAY_ROI_NOT_OBSERVED',path:`/scenes/${index}/params/focus`});
    if(requireBehavior&&scene.params.componentBehavior==='carry'&&observed){
      const label=(value:unknown)=>typeof value==='string'?value.trim().replace(/\s+/g,' ').toLowerCase():'';
      const same=scene.params.items.slice(1).every((item:Json)=>{
        const other=resources.find(value=>value.resourceId===film.assets[item.assetKey]?.resourceId);
        const observation=insights.find(value=>value.sha256===other?.sha256);
        return label(observed.label)&&observation?.regions?.some((region:Json)=>label(region.label)===label(observed.label));
      });
      if(!same)issues.push({code:'RELAY_CARRY_RELATION_UNOBSERVED',path:`/scenes/${index}/params/componentBehavior`});
    }
  }
  return issues;
}
