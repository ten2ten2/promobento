import type {Box} from '../../../contracts/film-runtime.d.ts';

const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const ease=(value:number)=>{const t=clamp(value);return t*t*(3-2*t);};
const mix=(a:number,b:number,p:number)=>a+(b-a)*p;
const blend=(a:Box,b:Box,p:number):Box=>({x:mix(a.x,b.x,p),y:mix(a.y,b.y,p),width:mix(a.width,b.width,p),height:mix(a.height,b.height,p)});

export function relayLandings(count:number,beat:number):number[]{
  if(!Number.isInteger(count)||count<2||count>4||!Number.isInteger(beat)||beat<6||beat>60)throw Error('RELAY_TIMING_INVALID');
  return Array.from({length:count-1},(_,index)=>(5+index*3)*beat);
}

/** Fit the actual image without cropping; all coordinates are in target pixels. */
export function relayFit(bounds:Box,width:number,height:number):Box{
  const scale=Math.min(bounds.width/width,bounds.height/height),w=width*scale,h=height*scale;
  return {x:bounds.x+(bounds.width-w)/2,y:bounds.y+(bounds.height-h)/2,width:w,height:h};
}

/** The extracted copy starts at exactly the source rectangle, in the same geometry as its parent. */
export function componentPose(frame:number,beat:number,parent:Box,roi:Box,bounds:Box){
  const lift=ease((frame-beat)/beat);
  const lowered={x:parent.x+parent.width*.09,y:parent.y+parent.height*.14,width:parent.width*.82,height:parent.height*.82};
  const page=blend(parent,lowered,lift);
  const origin={x:page.x+roi.x*page.width,y:page.y+roi.y*page.height,width:roi.width*page.width,height:roi.height*page.height};
  const scale=Math.min(bounds.width*.58/origin.width,bounds.height*.30/origin.height,3);
  const width=origin.width*scale,height=origin.height*scale;
  const destination={x:bounds.x+(bounds.width-width)/2,y:bounds.y+bounds.height*.08,width,height};
  return {page,component:blend(origin,destination,lift),lift};
}

/** Continuous page travel; the outgoing and incoming images never morph or crossfade. */
export function relayPageOffset(frame:number,index:number,count:number,beat:number,travel:number){
  const landings=relayLandings(count,beat);
  if(index>0){const entry=ease((frame-(landings[index-1]!-beat))/beat);if(entry<1)return (1-entry)*travel;}
  if(index<count-1){const exit=ease((frame-(landings[index]!-beat))/beat);if(exit>0)return -exit*travel;}
  return 0;
}

export function relayVisible(frame:number,index:number,count:number,beat:number){
  const landings=relayLandings(count,beat);
  return (index===0||frame>=landings[index-1]!-beat)&&(index===count-1||frame<landings[index]!);
}
