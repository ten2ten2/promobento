/** Canvas affine coordinates; all returned bounds are in platform screen pixels. */
export function transformPoint(transform,x,y) {
  const [a,b,c,d,e,f]=transform??[1,0,0,1,0,0];return {x:a*x+c*y+e,y:b*x+d*y+f};
}
export function transformedBox(transform,{x,y,width,height}) {
  const corners=[[x,y],[x+width,y],[x,y+height],[x+width,y+height]].map(([x,y])=>transformPoint(transform,x,y));
  const left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y));
  const right=Math.max(...corners.map(p=>p.x)),bottom=Math.max(...corners.map(p=>p.y));
  return {x:left,y:top,width:right-left,height:bottom-top};
}
export function clipContainsBox(clip,box,tolerance=0) {
  if(!clip)return true;
  const r=clip.radius??0;
  return [[box.x,box.y],[box.x+box.width,box.y],[box.x,box.y+box.height],[box.x+box.width,box.y+box.height]].every(([x,y])=>{
    if(x<clip.x-tolerance||x>clip.x+clip.width+tolerance||y<clip.y-tolerance||y>clip.y+clip.height+tolerance)return false;
    const cx=Math.max(clip.x+r,Math.min(clip.x+clip.width-r,x)),cy=Math.max(clip.y+r,Math.min(clip.y+clip.height-r,y));
    return Math.hypot(x-cx,y-cy)<=r+tolerance;
  });
}
