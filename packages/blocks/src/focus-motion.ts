/** A framing track moves over one real source; coordinates are normalized to that source. */
export type FocusPoint = {frame:number;x:number;y:number;zoom:number};
export function focusPose(frame:number,track:readonly FocusPoint[]){
  if(!track.length)return {x:.5,y:.5,zoom:1};
  const next=track.findIndex(point=>point.frame>frame);
  if(next<0)return track[track.length-1]!;
  if(next===0)return track[0]!;
  const a=track[next-1]!,b=track[next]!,p=Math.max(0,Math.min(1,(frame-a.frame)/(b.frame-a.frame)));
  const smooth=p*p*(3-2*p),mix=(x:number,y:number)=>x+(y-x)*smooth;
  return {x:mix(a.x,b.x),y:mix(a.y,b.y),zoom:mix(a.zoom,b.zoom)};
}

/** Cover the viewport without stretching or exposing space outside the source. */
export function focusViewport(source:{width:number;height:number},viewport:{width:number;height:number},pose:{x:number;y:number;zoom:number}){
  const scale=Math.max(viewport.width/source.width,viewport.height/source.height)*pose.zoom;
  const width=source.width*scale,height=source.height*scale;
  return {width,height,left:Math.max(viewport.width-width,Math.min(0,viewport.width/2-pose.x*width)),
    top:Math.max(viewport.height-height,Math.min(0,viewport.height/2-pose.y*height))};
}
