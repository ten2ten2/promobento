import type {Box} from '../../../contracts/film-runtime.d.ts';

type Point={x:number;y:number};
type Pixels={width:number;height:number;data:Uint8ClampedArray};
export const PANEL_PERSPECTIVE=1800;

export function panelProjection(box:Box,translationX:number,translationZ:number,angle:number,zoom=1,translationY=0){
  const cosine=Math.cos(angle),sine=Math.sin(angle),cx=box.width/2,cy=box.height/2;
  return(x:number,y:number):Point=>{const centered=(x-cx)*zoom,scale=PANEL_PERSPECTIVE/(PANEL_PERSPECTIVE-translationZ+sine*centered);
    return{x:box.x+cx+(cosine*centered+translationX)*scale,y:box.y+cy+((y-cy)*zoom+translationY)*scale};};
}

function panelColumns(box:Box,translationX:number,translationZ:number,angle:number,zoom=1){
  const cosine=Math.cos(angle)*zoom,sine=Math.sin(angle)*zoom,cx=box.width/2,depth=PANEL_PERSPECTIVE-translationZ;
  return(x:number)=>{
    const q=(x-box.x-cx)/PANEL_PERSPECTIVE,dx=(q*(PANEL_PERSPECTIVE-translationZ)-translationX)/(cosine-q*sine);
    return{x:dx+cx,stepY:(depth+sine*dx)/(PANEL_PERSPECTIVE*zoom),
      stepX:(depth*cosine-translationX*sine)/(PANEL_PERSPECTIVE*(cosine-q*sine)**2)};
  };
}

export function panelUnprojection(box:Box,translationX:number,translationZ:number,angle:number,zoom=1,translationY=0){
  const columns=panelColumns(box,translationX,translationZ,angle,zoom),cy=box.height/2;
  return(x:number,y:number):Point=>{const column=columns(x);return{x:column.x,y:(y-box.y-cy)*column.stepY+cy-translationY/zoom};};
}

// Read the source once, at native resolution. Build the minification levels with
// integer pixel averages, not history-dependent browser image scaling caches.
export function mediaPyramid(source:Pixels):Pixels[]{
  const levels=[source];
  while(source.width>1&&source.height>1){
    const width=Math.ceil(source.width/2),height=Math.ceil(source.height/2),data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let alpha=0,red=0,green=0,blue=0,count=0;
      for(let yy=y*2;yy<Math.min(source.height,y*2+2);yy++)for(let xx=x*2;xx<Math.min(source.width,x*2+2);xx++){
        const at=(yy*source.width+xx)*4,a=source.data[at+3]!;alpha+=a;count++;
        red+=source.data[at]!*a;green+=source.data[at+1]!*a;blue+=source.data[at+2]!*a;
      }
      const at=(y*width+x)*4;data[at+3]=alpha/count;
      if(alpha){data[at]=red/alpha;data[at+1]=green/alpha;data[at+2]=blue/alpha;}
    }
    source={width,height,data};levels.push(source);
  }
  return levels;
}

/** Reuses a working pyramid; only changed pixels are blended, in premultiplied alpha. */
export function blendPyramids(from:Pixels[],to:Pixels[]){
  if(from.length!==to.length||from.some((level,i)=>level.width!==to[i]!.width||level.height!==to[i]!.height))
    throw Error('PIXEL_BLEND_SIZE_MISMATCH');
  const levels=from.map(level=>({...level,data:new Uint8ClampedArray(level.data)}));
  const changed=from.map((level,index)=>{
    const other=to[index]!.data,indices:number[]=[];
    for(let at=0;at<level.data.length;at+=4)
      if(level.data[at]!==other[at]||level.data[at+1]!==other[at+1]||level.data[at+2]!==other[at+2]||level.data[at+3]!==other[at+3])indices.push(at);
    return indices;
  });
  return{render(progress:number){
    for(let index=0;index<levels.length;index++){
      const a=from[index]!.data,b=to[index]!.data,out=levels[index]!.data;
      for(const at of changed[index]!){
        if(progress===0||progress===1){const endpoint=progress===0?a:b;for(let channel=0;channel<4;channel++)out[at+channel]=endpoint[at+channel]!;continue;}
        const first=a[at+3]!*(1-progress),second=b[at+3]!*progress,alpha=first+second;
        for(let channel=0;channel<3;channel++)out[at+channel]=alpha?(a[at+channel]!*first+b[at+channel]!*second)/alpha:0;
        out[at+3]=alpha;
      }
    }
    return levels;
  }};
}

// One inverse-projected image, blended directly into the fixed logical stage.
// No tiled Canvas drawImage calls: their antialiased clips left visible cracks,
// and their source sampling still differed between warm and cold captures.
export function paintProjectedMedia(output:Pixels,levels:Pixels[],screen:Box,box:Box,
  translationX:number,translationZ:number,angle:number,opacity:number,
  {zoom=1,translationY=0,radius:cornerRadius=22,clip=box}:{zoom?:number;translationY?:number;radius?:number;clip?:Box}={}){
  if(opacity===0)return;
  const source=levels[0]!,columns=panelColumns(box,translationX,translationZ,angle,zoom);
  const cy=box.height/2,globalY=box.y+cy;
  const fit=Math.min(screen.width/source.width,screen.height/source.height);
  const width=source.width*fit,height=source.height*fit,left=screen.x+(screen.width-width)/2,top=screen.y+(screen.height-height)/2;
  const project=panelProjection(box,translationX,translationZ,angle,zoom,translationY);
  const corners=[project(left,top),project(left+width,top),project(left+width,top+height),project(left,top+height)];
  const minX=Math.max(0,Math.ceil(clip.x-.5),Math.floor(Math.min(...corners.map(p=>p.x))-1));
  const maxX=Math.min(output.width,Math.ceil(clip.x+clip.width-.5),Math.ceil(Math.max(...corners.map(p=>p.x))+1));
  const minY=Math.max(0,Math.ceil(clip.y-.5),Math.floor(Math.min(...corners.map(p=>p.y))-1));
  const maxY=Math.min(output.height,Math.ceil(clip.y+clip.height-.5),Math.ceil(Math.max(...corners.map(p=>p.y))+1));
  const radius=Math.min(cornerRadius,screen.width/2,screen.height/2),screenX=screen.x+screen.width/2,screenY=screen.y+screen.height/2;
  for(let x=minX;x<maxX;x++){
    const {x:lx,stepX,stepY}=columns(x+.5),edge=Math.max(stepX,stepY);
    const level=levels[Math.min(levels.length-1,Math.max(0,Math.floor(Math.log2(edge/fit))))]!;
    const u=Math.max(0,Math.min(level.width-1,(lx-left)/width*level.width-.5)),ix=Math.floor(u),fx=u-ix;
    const right=Math.min(ix+1,level.width-1),clipX=Math.max(left-lx,lx-left-width);
    if(clipX>edge/2)continue;
    const roundX=Math.max(0,Math.abs(lx-screenX)-screen.width/2+radius);
    for(let y=minY;y<maxY;y++){
      const ly=(y+.5-globalY)*stepY+cy-translationY/zoom,roundY=Math.max(0,Math.abs(ly-screenY)-screen.height/2+radius);
      const distance=Math.max(clipX,top-ly,ly-top-height,radius?(roundX||roundY?Math.hypot(roundX,roundY):0)-radius:-Infinity);
      const coverage=Math.max(0,Math.min(1,.5-distance/edge));if(!coverage)continue;
      const v=Math.max(0,Math.min(level.height-1,(ly-top)/height*level.height-.5)),iy=Math.floor(v),fy=v-iy;
      const a=(iy*level.width+ix)*4,b=(iy*level.width+right)*4,c=(Math.min(iy+1,level.height-1)*level.width+ix)*4,d=c+(right-ix)*4;
      const p=level.data,w0=(1-fx)*(1-fy)*p[a+3]!,w1=fx*(1-fy)*p[b+3]!,w2=(1-fx)*fy*p[c+3]!,w3=fx*fy*p[d+3]!;
      const alpha=w0+w1+w2+w3;if(!alpha)continue;
      const out=(y*output.width+x)*4,old=output.data,newAlpha=alpha/255*opacity*coverage;
      const remaining=old[out+3]!/255*(1-newAlpha),combined=newAlpha+remaining;
      for(let channel=0;channel<3;channel++){
        const color=(p[a+channel]!*w0+p[b+channel]!*w1+p[c+channel]!*w2+p[d+channel]!*w3)/alpha;
        old[out+channel]=(color*newAlpha+old[out+channel]!*remaining)/combined;
      }
      old[out+3]=combined*255;
    }
  }
}
