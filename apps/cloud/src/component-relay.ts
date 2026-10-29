import type {Json} from './pipeline-types.ts';

/** A coordinate is a model observation, not independently verified pixel geometry. */
export function relayObservationIssues(film:Json,insights:Json[],resources:Json[]){
  const issues:Array<{code:string;path:string}>=[];
  for(const [index,scene] of film.scenes.entries()){
    if(scene.kind!=='block'||scene.block!=='component-relay@1')continue;
    const key=scene.params.items?.[0]?.assetKey,slot=film.assets[key],resource=resources.find(item=>item.resourceId===slot?.resourceId);
    const roi=slot?.roi?.[Number(String(scene.params.focus).slice(4))];
    const insight=insights.find(item=>item.sha256===resource?.sha256);
    if(!roi||!insight?.regions?.some((region:Json)=>['x','y','width','height'].every(field=>region.box?.[field]===roi[field])))
      issues.push({code:'RELAY_ROI_NOT_OBSERVED',path:`/scenes/${index}/params/focus`});
  }
  return issues;
}
