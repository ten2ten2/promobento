import type {Box} from '../../../contracts/film-runtime.d.ts';

type Point={x:number;y:number};
type Project=(x:number,y:number)=>Point;
export const PANEL_PERSPECTIVE=1800;

// Original CPU perspective rasterization. The output surface stays at the fixed logical
// stage size; only these pixel coordinates move, not a compositor-scaled image layer.
export function panelProjection(box:Box,translationX:number,translationZ:number,angle:number):Project{
  const cosine=Math.cos(angle),sine=Math.sin(angle),cx=box.width/2,cy=box.height/2;
  return(x,y)=>{const centered=x-cx,scale=PANEL_PERSPECTIVE/(PANEL_PERSPECTIVE-translationZ+sine*centered);
    return{x:box.x+cx+(cosine*centered+translationX)*scale,y:box.y+cy+(y-cy)*scale};};
}

function triangle(context:CanvasRenderingContext2D,image:CanvasImageSource,source:Point[],target:Point[]){
  const [a,b,c]=source as[Point,Point,Point], [p,q,r]=target as[Point,Point,Point];
  const det=a.x*(b.y-c.y)+b.x*(c.y-a.y)+c.x*(a.y-b.y);
  const coefficients=(u:number,v:number,w:number)=>[
    (u*(b.y-c.y)+v*(c.y-a.y)+w*(a.y-b.y))/det,
    (u*(c.x-b.x)+v*(a.x-c.x)+w*(b.x-a.x))/det,
    (u*(b.x*c.y-c.x*b.y)+v*(c.x*a.y-a.x*c.y)+w*(a.x*b.y-b.x*a.y))/det
  ];
  const x=coefficients(p.x,q.x,r.x),y=coefficients(p.y,q.y,r.y);
  // Offset clip edges slightly to avoid antialiased cracks between adjacent triangles.
  // Copy compositing replaces overlap instead of double-blending source alpha.
  const area=(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x),sign=area>=0?1:-1;
  const expanded=target.map((point,index)=>{
    const before=target[(index+2)%3]!,after=target[(index+1)%3]!;
    const u={x:point.x-before.x,y:point.y-before.y},v={x:after.x-point.x,y:after.y-point.y};
    const ul=Math.hypot(u.x,u.y),vl=Math.hypot(v.x,v.y);
    const n={x:sign*u.y/ul,y:-sign*u.x/ul},m={x:sign*v.y/vl,y:-sign*v.x/vl};
    const amount=.7/(1+n.x*m.x+n.y*m.y);
    return{x:point.x+(n.x+m.x)*amount,y:point.y+(n.y+m.y)*amount};
  });
  context.save();context.beginPath();context.moveTo(expanded[0]!.x,expanded[0]!.y);
  for(const point of expanded.slice(1))context.lineTo(point.x,point.y);
  context.closePath();context.clip();context.setTransform(x[0]!,y[0]!,x[1]!,y[1]!,x[2]!,y[2]!);
  context.drawImage(image,0,0);context.restore();
}

export function paintProjectedMedia(context:CanvasRenderingContext2D,image:CanvasImageSource,
  width:number,height:number,screen:Box,project:Project){
  context.save();context.setTransform(1,0,0,1,0,0);context.globalAlpha=1;context.globalCompositeOperation='copy';
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
  const radius=Math.min(22,screen.width/2,screen.height/2);
  const corners=[{x:screen.x+screen.width-radius,y:screen.y+radius,start:-Math.PI/2},
    {x:screen.x+screen.width-radius,y:screen.y+screen.height-radius,start:0},
    {x:screen.x+radius,y:screen.y+screen.height-radius,start:Math.PI/2},
    {x:screen.x+radius,y:screen.y+radius,start:Math.PI}];
  context.beginPath();let first=true;
  for(const corner of corners)for(let step=0;step<=8;step++){
    const angle=corner.start+step*Math.PI/16,point=project(corner.x+Math.cos(angle)*radius,corner.y+Math.sin(angle)*radius);
    if(first){context.moveTo(point.x,point.y);first=false;}else context.lineTo(point.x,point.y);
  }
  context.closePath();context.clip();
  const scale=Math.min(screen.width/width,screen.height/height),left=screen.x+(screen.width-width*scale)/2,top=screen.y+(screen.height-height*scale)/2;
  const columns=24;
  for(let column=0;column<columns;column++){
    const u=width*column/columns,v=width*(column+1)/columns;
    const a={x:u,y:0},b={x:v,y:0},c={x:v,y:height},d={x:u,y:height};
    const mapped=(point:Point)=>project(left+point.x*scale,top+point.y*scale);
    triangle(context,image,[a,b,c],[mapped(a),mapped(b),mapped(c)]);
    triangle(context,image,[a,c,d],[mapped(a),mapped(c),mapped(d)]);
  }
  context.restore();
}
