/** Trusted author helpers adapted from huashu-art-motion clip libraries (MIT).
 * This factory is serialized into the private QuickJS bootstrap, not imported
 * by guest modules. It has no browser/global state or side-effect capabilities.
 * See ../vendor/huashu-motion/NOTICE.md for provenance and bounded adaptations. */
export function createMotionTools(context) {
  const {width:W,height:H,randomAt,measureText}=context;
  const clamp=(value,a=0,b=1)=>Math.max(a,Math.min(b,value)),lerp=(a,b,p)=>a+(b-a)*p;
  const MO={clamp,lerp};
// ---------- 时间片 ----------
MO.seg = (t, a, b) => clamp((t - a) / (b - a));                          // [a,b] → 0..1
MO.at = (t, t0, dur) => clamp((t - t0) / dur);                           // [t0, t0+dur] → 0..1
MO.anim = (lt, start, dur, ease = MO.smooth) => ease(clamp((lt - start) / dur));
// 步进时间：把连续时间量化成 fps 步。拼贴纸片/打字/荧光笔「一拍二」= 12fps；故事型角色 24fps；相机仍按 60fps 平滑。
MO.step = (t, fps = 12) => Math.floor(t * fps + 1e-6) / fps;

// ---------- manim 缓动（3b1b/manim rate_functions.py） ----------
// smooth = 6t⁵−15t⁴+10t³：两端速度、加速度都为 0。讲解类片子的默认缓动。
MO.smooth = t => { t = clamp(t); return t * t * t * (10 - 15 * t + 6 * t * t); };
const sig = x => 1 / (1 + Math.exp(-x));
MO.smoothCE = (t, inflection = 10) => { const e = sig(-inflection / 2); return clamp((sig(inflection * (t - 0.5)) - e) / (1 - 2 * e)); };   // ManimCE 版
MO.thereAndBack = t => MO.smooth(t < 0.5 ? 2 * t : 2 * (1 - t));          // Indicate 用：去了又回
MO.rushInto = t => 2 * MO.smooth(t / 2);                                  // 慢起、冲进终点
MO.rushFrom = t => 2 * MO.smooth(t / 2 + 0.5) - 1;                        // 冲出、慢收
MO.doubleSmooth = t => t < 0.5 ? 0.5 * MO.smooth(2 * t) : 0.5 * (1 + MO.smooth(2 * t - 1));
MO.wiggle = (t, wiggles = 2) => MO.thereAndBack(t) * Math.sin(wiggles * Math.PI * t);
// manim LaggedStart(lag_ratio=r)：n 个子动画里第 i 个在总进度 p 下的局部进度。总长 = 1+(n-1)·r 个单位，第 i 个占 [i·r, i·r+1]。
MO.lagged = (i, n, p, r = 0.05) => clamp(p * (1 + (n - 1) * r) - i * r);

// ---------- 常用解析缓动（AE / CSS 名字） ----------
MO.linear = p => p;
MO.sineInOut = p => -(Math.cos(Math.PI * p) - 1) / 2;
MO.cubicIn = p => p * p * p;
MO.cubicOut = p => 1 - Math.pow(1 - p, 3);
MO.cubicInOut = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
MO.quartOut = p => 1 - Math.pow(1 - p, 4);
MO.quintOut = p => 1 - Math.pow(1 - p, 5);
MO.quintInOut = p => p < .5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2;
MO.expoIn = p => p <= 0 ? 0 : Math.pow(2, 10 * p - 10);
MO.expoOut = p => p >= 1 ? 1 : 1 - Math.pow(2, -10 * p);                // 动效设计最常用的「快出慢停」
MO.expoInOut = p => p <= 0 ? 0 : p >= 1 ? 1 : p < .5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2;
// backOut 过冲：s=1.70158 约 10%；2.2 约 13%；2.6 约 17%；3.5 约 23%
MO.backOut = (p, s = 1.70158) => { const q = p - 1; return 1 + (s + 1) * q * q * q + s * q * q; };
// 弹性落定：overshoot 一次再回（贴纸「啪」地落下）
MO.elasticOut = p => p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI / 3)) + 1;

// ---------- CSS cubic-bezier(x1,y1,x2,y2)：牛顿法由 x 求参数，再取 y ----------
MO.bezier = (x1, y1, x2, y2) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = s => ((ax * s + bx) * s + cx) * s, Y = s => ((ay * s + by) * s + cy) * s, dX = s => (3 * ax * s + 2 * bx) * s + cx;
  return p => {
    if (p <= 0) return 0; if (p >= 1) return 1;
    let s = p; for (let k = 0; k < 8; k++) { const e = X(s) - p, d = dX(s); if (Math.abs(e) < 1e-6 || Math.abs(d) < 1e-6) break; s -= e / d; }
    s = clamp(s); return Y(s);
  };
};
MO.appleOut = MO.bezier(0.25, 0.1, 0.25, 1);        // CSS `ease`：苹果官网/发布会过渡
MO.emphasized = MO.bezier(0.2, 0, 0, 1);            // Material 3 emphasized：长尾减速
MO.k75 = MO.bezier(0.75, 0, 0.25, 1);               // Kurzgesagt「其他动作用 75% influence」（y1 调研 §6.2）
MO.easyEase = MO.bezier(0.333, 0, 0.667, 1);        // AE Easy Ease：循环动作
MO.longTail = MO.bezier(0.33, 0, 0.2, 1);           // Vox「沿线追过去」「拉出揭示」：起步快、长尾落定（y2 调研）

// ---------- 弹簧 ----------
// SwiftUI 参数化（WWDC23 Animate with springs）：stiffness=(2π/duration)²，damping=4π(1-bounce)/duration → ζ=1-bounce，ω=2π/duration。
// 返回 0→1 的位移（可 >1 = 过冲）。t 单位秒。发布会 UI 用它：.smooth(bounce 0) / .snappy(0.15) / .bouncy(0.3)。
MO.spring = (t, { duration = 0.5, bounce = 0, v0 = 0 } = {}) => {
  if (t <= 0) return 0;
  const w = 2 * Math.PI / duration, z = 1 - bounce;
  let x;                                                                 // x = 剩余位移（1→0）
  if (Math.abs(z - 1) < 1e-4) x = Math.exp(-w * t) * (1 + (w - v0) * t);
  else if (z < 1) { const wd = w * Math.sqrt(1 - z * z); x = Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w - v0) / wd) * Math.sin(wd * t)); }
  else { const r = Math.sqrt(z * z - 1), a = -w * (z - r), b = -w * (z + r); const A = (-v0 - b) / (a - b); x = A * Math.exp(a * t) + (1 - A) * Math.exp(b * t); }
  return 1 - x;
};
MO.smoothSpring = t => MO.spring(t, { duration: 0.5, bounce: 0 });
MO.snappy = t => MO.spring(t, { duration: 0.5, bounce: 0.15 });
MO.bouncy = t => MO.spring(t, { duration: 0.5, bounce: 0.3 });
// 频率/衰减参数化的欠阻尼弹簧阶跃响应（动态文字用）：freq Hz、decay 1/s。
//   freq 3 / decay 6 第一次过冲 ≈37%（砸进来的大字）；2.5 / 9 ≈16%（常规弹入）；2.2 / 10 ≈8%（主词落定）
MO.springHz = (t, freq = 2.5, decay = 9) => t <= 0 ? 0 : 1 - Math.exp(-decay * t) * Math.cos(2 * Math.PI * freq * t);
// 到位后的余振（Dan Ebberts 惯性回弹）：amp·sin(2πft)/e^(decay·t)。换姿势的身体挤压、屏幕震动都用它。
MO.settle = (t, amp, freq = 3, decay = 5) => t <= 0 ? 0 : amp * Math.sin(2 * Math.PI * freq * t) / Math.exp(decay * t);

// ---------- 持续微动 ----------
// 漂浮：两频正弦叠加。周期避开 5s 左右（HIG：~0.2Hz 的持续摆动让人不适）
MO.float = (t, amp = 6, period = 4, ph = 0) => amp * (0.75 * Math.sin(2 * Math.PI * t / period + ph) + 0.25 * Math.sin(2 * Math.PI * t / (period * 0.53) + ph * 1.7));

// ---------- 反查与拍号 ----------
// 缓动的反函数（二分）：「线头/计数在什么时刻到达 y」。例：折线按 smooth 画，求画到某个 x 的时刻（t3 镜 2 的事件标注）。
MO.invert = (ease, y, iters = 30) => { iters = Math.max(1, Math.min(64, Math.floor(iters))); let a = 0, b = 1; for (let i = 0; i < iters; i++) { const m = (a + b) / 2; if (ease(m) < y) a = m; else b = m; } return (a + b) / 2; };
// 拍 → 秒
MO.beat = (n, bpm = 120) => n * 60 / bpm;
// 揭开那一帧落在拍上：段起点 = 小节线 − 揭开点 × 转场时长（y5：zoom 揭开点 .55、色带 .6、push 到 90% 位移在 .58）
MO.onBeat = (barTime, revealP, trDur) => barTime - revealP * trDur;
  const normal=cam=>({x:cam.x??W/2,y:cam.y??H/2,z:cam.z??1,r:cam.r??0});
  const matrix=cam=>{const {x,y,z,r}=normal(cam),c=Math.cos(r)*z,s=Math.sin(r)*z;return [c,s,-s,c,W/2-c*x+s*y,H/2-s*x-c*y];};
  const point=(m,x,y)=>({x:m[0]*x+m[2]*y+m[4],y:m[1]*x+m[3]*y+m[5]});
  const multiply=(a,b)=>[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  const camera={matrix,zlerp:(a,b,p)=>a*Math.pow(b/a,p),
    toScreen:(cam,x,y)=>point(matrix(cam),x,y),
    toWorld:(cam,x,y)=>{const k=normal(cam),dx=x-W/2,dy=y-H/2,c=Math.cos(k.r),s=Math.sin(k.r);return {x:k.x+(c*dx+s*dy)/k.z,y:k.y+(-s*dx+c*dy)/k.z};},
    coverZoom:(radius,cx=W/2,cy=H/2)=>Math.max(Math.hypot(cx,cy),Math.hypot(W-cx,cy),Math.hypot(cx,H-cy),Math.hypot(W-cx,H-cy))/radius,
    anchor:(x,y,z,sx,sy)=>({x:x-(sx-W/2)/z,y:y-(sy-H/2)/z,z}),
    at:(keys,t)=>{if(!keys.length||keys.length>256)throw Error('CAMERA_KEYS_INVALID');for(let i=1;i<keys.length;i++)if(keys[i].t<=keys[i-1].t)throw Error('CAMERA_KEYS_INVALID');
      if(t<=keys[0].t)return normal(keys[0]);for(let i=1;i<keys.length;i++)if(t<=keys[i].t){const a=normal(keys[i-1]),b=normal(keys[i]),p=(keys[i].ease??MO.cubicInOut)(MO.seg(t,keys[i-1].t,keys[i].t));return {x:lerp(a.x,b.x,p),y:lerp(a.y,b.y,p),z:camera.zlerp(a.z,b.z,p),r:lerp(a.r,b.r,p)};}return normal(keys.at(-1));},
    parallax:(cam,depth)=>{const k=normal(cam);return {x:lerp(W/2,k.x,depth),y:lerp(H/2,k.y,depth),z:Math.pow(k.z,depth),r:k.r*depth};},
    drift:(t,amp=6,seed=0)=>[amp*Math.sin(t*0.9+seed)+amp*0.4*Math.sin(t*2.3+seed*2),amp*0.7*Math.sin(t*1.1+seed*3)],
    apply:(commands,cam)=>commands.map(command=>({...command,transform:command.transform?multiply(matrix(cam),command.transform):matrix(cam)})),
    region:(region,cam)=>{const m=matrix(cam),p=[[region.x,region.y],[region.x+region.width,region.y],[region.x,region.y+region.height],[region.x+region.width,region.y+region.height]].map(([x,y])=>point(m,x,y));
      const x=clamp(Math.min(...p.map(v=>v.x)),0,W),y=clamp(Math.min(...p.map(v=>v.y)),0,H),right=clamp(Math.max(...p.map(v=>v.x)),0,W),bottom=clamp(Math.max(...p.map(v=>v.y)),0,H);return {id:region.id,x,y,width:right-x,height:bottom-y};}
  };
  camera.pushTo=(base,x,y,z,p,k=p,to={x:W/2,y:H/2})=>{const a=camera.toScreen(base,x,y);return camera.anchor(x,y,camera.zlerp(normal(base).z,z,p),lerp(a.x,to.x,k),lerp(a.y,to.y,k));};
  const path={
    cumulative:pts=>{if(pts.length<2||pts.length>256)throw Error('PATH_POINTS_INVALID');const out=[0];for(let i=1;i<pts.length;i++)out.push(out[i-1]+Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y));return out;},
    pointAt:(pts,p)=>{const lengths=path.cumulative(pts),distance=clamp(p)*lengths.at(-1);for(let i=1;i<pts.length;i++)if(distance<=lengths[i]){const q=(distance-lengths[i-1])/(lengths[i]-lengths[i-1]||1);return {x:lerp(pts[i-1].x,pts[i].x,q),y:lerp(pts[i-1].y,pts[i].y,q)};}return {...pts.at(-1)};},
    partial:(pts,p)=>{const lengths=path.cumulative(pts),distance=clamp(p)*lengths.at(-1),result=[pts[0]];for(let i=1;i<pts.length;i++){if(lengths[i]<distance)result.push(pts[i]);else {result.push(path.pointAt(pts,p));break;}}return result;},
    cubic:(a,b,c,d,count=24)=>{count=Math.max(2,Math.min(128,Math.floor(count)));return Array.from({length:count+1},(_,i)=>{const t=i/count,u=1-t;return {x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y};});},
    arc:(cx,cy,rx,ry,a0,a1,count=32)=>{count=Math.max(2,Math.min(128,Math.floor(count)));return Array.from({length:count+1},(_,i)=>({x:cx+Math.cos(lerp(a0,a1,i/count))*rx,y:cy+Math.sin(lerp(a0,a1,i/count))*ry}));},
    morph:(a,b,p)=>{if(a.length!==b.length||a.length>256)throw Error('MORPH_TOPOLOGY_MISMATCH');return a.map((point,i)=>({x:lerp(point.x,b[i].x,p),y:lerp(point.y,b[i].y,p)}));},
    hand:(pts,key='hand',amp=2)=>pts.map((p,i)=>({x:p.x+(randomAt(key+':x:'+i)-0.5)*amp*2,y:p.y+(randomAt(key+':y:'+i)-0.5)*amp*2})),
    line:(pts,color='#24352b',width=3,p=1)=>({op:'path',segments:path.partial(pts,p).map((point,i)=>({kind:i?'line':'move',...point})),color,opacity:1,fill:false,stroke:{color,width,cap:'round',join:'round'}})
  };
  path.densify=(points,per=6)=>{
    if(points.length<2||!Number.isInteger(per)||per<1||(points.length-1)*per+1>256)throw Error('PATH_POINTS_INVALID');
    const out=[],at=i=>points[Math.max(0,Math.min(points.length-1,i))];
    for(let i=0;i<points.length-1;i++)for(let k=0;k<per;k++) {
      const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2),t=k/per,t2=t*t,t3=t2*t;
      const value=key=>0.5*(2*p1[key]+(-p0[key]+p2[key])*t+(2*p0[key]-5*p1[key]+4*p2[key]-p3[key])*t2+(-p0[key]+3*p1[key]-3*p2[key]+p3[key])*t3);
      out.push({x:value('x'),y:value('y')});
    }
    out.push({...points.at(-1)});return out;
  };
  path.resample=(points,count=32)=>{
    if(!Number.isInteger(count)||count<2||count>128)throw Error('PATH_POINTS_INVALID');
    return Array.from({length:count},(_,i)=>path.pointAt(points,i/(count-1)));
  };
  path.ribbon=(points,width=8,color='#24352b')=>{
    if(points.length<2||points.length>64)throw Error('PATH_POINTS_INVALID');const left=[],right=[];
    for(let i=0;i<points.length;i++){const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],length=Math.hypot(b.x-a.x,b.y-a.y)||1,dx=(b.x-a.x)/length,dy=(b.y-a.y)/length,half=(typeof width==='function'?width(i/(points.length-1),i):width)/2;
      left.push({x:points[i].x-dy*half,y:points[i].y+dx*half});right.push({x:points[i].x+dy*half,y:points[i].y-dx*half});}
    return {op:'path',segments:[...left,...right.reverse()].map((point,i)=>({kind:i?'line':'move',...point})).concat([{kind:'close'}]),color,opacity:1};
  };
  MO.count=(time,start,duration,a,b,ease=MO.expoOut)=>lerp(a,b,ease(MO.at(time,start,duration)));
  MO.formatNumber=(value,decimals=0)=>{if(!Number.isInteger(decimals)||decimals<0||decimals>6)throw Error('NUMBER_FORMAT_INVALID');const [a,b]=Math.abs(value).toFixed(decimals).split('.');return (value<0?'-':'')+a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(b?'.'+b:'');};
  const paint={
    rect:(x,y,width,height,color,radius=0)=>({op:'rect',x,y,width,height,color,opacity:1,...(radius?{radius}: {})}),
    circle:(x,y,radius,color)=>({op:'circle',x,y,radius,color,opacity:1}),
    texture:(style,x,y,width,height,{color='#f5f1e8',accent='#81735a',seed=1,scale=1,opacity=1}={})=>({op:'texture',style,x,y,width,height,color,accent,seed,scale,opacity}),
    wipe:(commands,p,{x=0,y=0,width=W,height=H,direction='right'}={})=>commands.map(command=>({...command,clip:{x:direction==='left'?x+width*(1-clamp(p)):x,y,width:width*clamp(p),height}})),
    transform:(commands,{x=0,y=0,scale=1,rotation=0,originX=0,originY=0}={})=>{const c=Math.cos(rotation)*scale,s=Math.sin(rotation)*scale,m=[c,s,-s,c,x+originX-c*originX+s*originY,y+originY-s*originX-c*originY];return commands.map(command=>({...command,transform:command.transform?multiply(m,command.transform):m}));},
    lightSweep:(x,y,width,height,p,color='#ffffff')=>({op:'rect',x:x-width+width*3*clamp(p),y,width:width*0.2,height,color,opacity:0.2,clip:{x,y,width,height},transform:[1,0,-0.25,1,height*0.125,0]}),
    text:(id,text,x,y,width,{fontId='geist-sans-fixture',fontSize=32,weight=600,color='#24352b',wrap='word-cjk',align='left',lineHeight,padding=fontSize*0.12}={})=>{
      if(!measureText)throw Error('MEDIA_PROFILE_REQUIRED');const layout={wrap,align,padding,...(lineHeight?{lineHeight}: {})};
      const metrics=measureText(fontId,text,fontSize,weight,{...layout,width});
      return {op:'text',id,text,x,y,width,height:metrics.height,fontId,fontSize,weight,color,opacity:1,layout};
    }
  };
  paint.tornPaper=(x,y,width,height,{key='paper',color='#fffaf0',amplitude=4}={})=>{
    const points=[];
    for(let side=0;side<4;side++)for(let i=0;i<8;i++) {
      const q=i/8,j=(randomAt(key+':'+side+':'+i)-0.5)*amplitude*2;
      points.push(side===0?{x:x+width*q,y:y+j}:side===1?{x:x+width+j,y:y+height*q}:side===2?{x:x+width*(1-q),y:y+height+j}:{x:x+j,y:y+height*(1-q)});
    }
    return {op:'polygon',points,color,opacity:1};
  };
  const theme={ink:'#24352b',muted:'#788778',paper:'#f5f1e8',accent:'#f2783d',blue:'#437fba'};
  const bounds=options=>({x:options.x??W*0.12,y:options.y??H*0.25,width:options.width??W*0.72,height:options.height??H*0.4});
  const label=(o,id,value,x,y,width,size=26,color=theme.ink)=>paint.text(o.id+':'+id,String(value),x,y,width,{fontId:o.fontId??'geist-sans-fixture',weight:o.weight??600,fontSize:size,color});
  const components={
    /** Product UI: stable screen chrome, navigation, metric cards, chart and pointer. */
    ui(o={}) {
      o={id:'ui',...o};const {x,y,width:w,height:h}=bounds(o),p=clamp(o.progress??1),c=[paint.rect(x,y,w,h,'#ffffff',18),paint.rect(x,y,w,48,theme.ink,12)];
      for(let i=0;i<3;i++)c.push(paint.circle(x+20+i*18,y+23,5,['#f2783d','#e6c75a','#92b291'][i]));
      c.push(label(o,'title',o.title??'Workspace',x+90,y+11,w-110,20,'#ffffff'),paint.rect(x,y+48,w*0.18,h-48,'#dfe5db'));
      for(const [i,item] of (o.navigation??['Home','Projects','Reports']).slice(0,5).entries())c.push(label(o,'nav-'+i,item,x+14,y+76+i*43,w*0.15,Math.min(18,w*0.025)));
      const cards=o.cards??[{label:'Created',value:'24'},{label:'Reviewed',value:'18'},{label:'Ready',value:'12'}],left=x+w*0.23,cardW=w*0.21;
      for(const [i,item] of cards.slice(0,3).entries()){const cy=y+76+(1-MO.lagged(i,3,p))*18;c.push(paint.rect(left+i*cardW*1.15,cy,cardW,h*0.24,theme.paper,8),label(o,'card-label-'+i,item.label,left+12+i*cardW*1.15,cy+10,cardW-24,Math.min(18,w*0.025)),label(o,'card-value-'+i,item.value,left+12+i*cardW*1.15,cy+38,cardW-24,Math.min(34,w*0.05)));}
      if(o.resourceId)c.push({op:'image',resourceId:o.resourceId,x:left,y:y+h*0.5,width:w*0.7,height:h*0.4,opacity:1,crop:o.crop??{x:0,y:0,width:1,height:1}});
      else {const points=Array.from({length:16},(_,i)=>({x:left+i*w*0.043,y:y+h*0.85-Math.pow(i/15,0.7)*h*0.27+Math.sin(i*1.7)*h*0.025}));c.push(path.line(points,theme.blue,4,p));}
      const cx=left+w*0.4*p,cy=y+h*0.65;c.push({op:'polygon',points:[{x:cx,y:cy},{x:cx+4,y:cy+26},{x:cx+10,y:cy+18},{x:cx+22,y:cy+16}],color:theme.accent,opacity:1});return c;
    },
    /** Mechanism diagram: trimmed curved edges, moving signal and token formula. */
    mechanism(o={}) {
      o={id:'mechanism',...o};const {x,y,width:w,height:h}=bounds(o),p=clamp(o.progress??1),nodes=(o.nodes??[{label:'Input'},{label:'Process'},{label:'Result'}]).slice(0,12),c=[];
      const positions=nodes.map((node,i)=>({x:x+(node.x??(i+0.5)/nodes.length)*w,y:y+(node.y??0.45)*h})),r=Math.min(52,w/nodes.length*0.28);
      const edges=o.edges??nodes.slice(1).map((_,i)=>[i,i+1]);
      for(const [i,[from,to]] of edges.slice(0,32).entries()) {
        const a=positions[from],b=positions[to];if(!a||!b)throw Error('DIAGRAM_EDGE_INVALID');const angle=Math.atan2(b.y-a.y,b.x-a.x),start={x:a.x+Math.cos(angle)*r,y:a.y+Math.sin(angle)*r},end={x:b.x-Math.cos(angle)*r,y:b.y-Math.sin(angle)*r};
        const points=path.cubic(start,{x:lerp(start.x,end.x,0.35),y:start.y-20},{x:lerp(start.x,end.x,0.65),y:end.y-20},end);c.push(path.line(points,theme.blue,3,p));
        const tip=path.pointAt(points,p);c.push(paint.circle(tip.x,tip.y,6,theme.accent));
      }
      for(const [i,node] of nodes.entries()){const at=positions[i];c.push({...paint.circle(at.x,at.y,r,node.color??theme.ink),stroke:{color:'#ffffff',width:3}},label(o,'node-'+i,node.label,at.x-r*1.5,at.y+r+16,r*3,Math.min(24,w/nodes.length*0.1)));}
      if(o.formula)c.push(label(o,'formula',o.formula,x,y+h*0.85,w,Math.min(38,w*0.05)));return c;
    },
    /** Data charts preserve values and labels; animation changes only reveal. */
    chart(o={}) {
      o={id:'chart',...o};const {x,y,width:w,height:h}=bounds(o),p=clamp(o.progress??1),data=(o.data??[{label:'A',value:24},{label:'B',value:48},{label:'C',value:72},{label:'D',value:88}]).slice(0,24),c=[];
      if(!data.length||data.some(d=>!Number.isFinite(d.value)))throw Error('CHART_DATA_INVALID');
      const low=Math.min(0,...data.map(d=>d.value)),high=Math.max(1,...data.map(d=>d.value)),plot={x:x+55,y:y+45,width:w-70,height:h-100},sy=v=>plot.y+plot.height*(1-(v-low)/(high-low)),baseline=sy(0);
      for(let i=0;i<=4;i++){const value=lerp(low,high,i/4),yy=sy(value);c.push(path.line([{x:plot.x,y:yy},{x:plot.x+plot.width,y:yy}],'#c3cbc0',1),label(o,'tick-'+i,value.toFixed(0),x,yy-12,48,18));}
      if(o.title)c.push(label(o,'title',o.title,x,y,w,26));
      const points=[];
      for(const [i,item] of data.entries()){const xx=plot.x+(i+0.5)*plot.width/data.length,yy=sy(item.value*MO.lagged(i,data.length,p,0.12));points.push({x:xx,y:yy});
        if(o.kind!=='line')c.push(paint.rect(xx-plot.width/data.length*0.3,Math.min(yy,baseline),plot.width/data.length*0.6,Math.abs(baseline-yy),item.color??theme.blue));
        c.push(label(o,'x-'+i,item.label,xx-plot.width/data.length*0.4,plot.y+plot.height+12,plot.width/data.length*0.8,Math.min(18,plot.width/data.length*0.25)));
      }
      if(o.kind==='line'&&points.length>1){c.push(path.line(points,theme.accent,4,p));for(const point of points)c.push(paint.circle(point.x,point.y,5,theme.accent));}
      return c;
    },
    /** Flat-world infographic: orbital hierarchy and captioned system nodes. */
    flatWorld(o={}) {
      o={id:'world',...o};const {x,y,width:w,height:h}=bounds(o),time=o.time??0,cx=x+w/2,cy=y+h/2,r=Math.min(w,h)*0.2,c=[];
      c.push({...paint.circle(cx,cy,r*1.55,'#173c54'),gradient:{kind:'radial',x0:cx,y0:cy,x1:cx,y1:cy,r0:r*0.5,r1:r*1.55,stops:[{offset:0,color:'#6bbcb1'},{offset:1,color:'#173c54'}]}},paint.circle(cx,cy,r,o.color??'#4b9a83'));
      c.push({op:'polygon',points:[{x:cx-r*0.8,y:cy-r*0.2},{x:cx-r*0.2,y:cy-r*0.75},{x:cx+r*0.4,y:cy-r*0.3},{x:cx+r*0.1,y:cy+r*0.3},{x:cx-r*0.5,y:cy+r*0.6}],color:'#b5d58c',opacity:1});
      c.push({...paint.circle(cx,cy,r*1.8,'#436e80'),fill:false,stroke:{color:'#436e80',width:2,dash:[5,9]}});
      for(const [i,node] of (o.nodes??['Discover','Connect','Grow']).slice(0,8).entries()){const count=(o.nodes??['Discover','Connect','Grow']).length,a=i/count*Math.PI*2+time*0.06,nx=cx+Math.cos(a)*r*1.8,ny=cy+Math.sin(a)*r*1.8;c.push(paint.circle(nx,ny,16,[theme.accent,'#e6c75a','#6bbcb1'][i%3]),label(o,'orbit-'+i,node,nx-55,ny+24,110,18,'#f5f1e8'));}
      return c;
    },
    /** Evidence collage: torn paper, tape, pins and connecting string. No bundled photos. */
    collage(o={}) {
      o={id:'collage',...o};const {x,y,width:w,height:h}=bounds(o),cards=(o.cards??[{title:'Observation',text:'A concrete detail.'},{title:'Evidence',text:'A source worth checking.'}]).slice(0,4),c=[];
      for(const [i,card] of cards.entries()) {
        const cw=w/cards.length*0.88,ch=h*0.72,cx=x+i*w/cards.length,cy=y+h*0.12,angle=(randomAt(o.id+':angle:'+i)-0.5)*0.08;
        const local=[paint.rect(cx+6,cy+9,cw,ch,'#c5bba5'),paint.tornPaper(cx,cy,cw,ch,{key:o.id+':paper:'+i}),paint.texture('paper',cx+6,cy+6,cw-12,ch-12,{seed:i+1,color:'#fffaf0',accent:'#b4a58b'}),label(o,'title-'+i,card.title,cx+18,cy+28,cw-36,26),label(o,'body-'+i,card.text??'',cx+18,cy+82,cw-36,21)];
        if(card.resourceId)local.push({op:'image',resourceId:card.resourceId,x:cx+18,y:cy+ch*0.45,width:cw-36,height:ch*0.43,opacity:1,effect:{style:'halftone',cell:4,seed:i}});
        local.push(paint.rect(cx+cw*0.25,cy-8,cw*0.5,20,'#d8c9a4'),paint.circle(cx+cw*0.5,cy+10,7,'#bd4d43'));
        c.push(...paint.transform(local,{rotation:angle,originX:cx+cw/2,originY:cy+ch/2}));
      }
      if(cards.length>1)c.push({op:'path',segments:[{kind:'move',x:x+w*0.2,y:y+h*0.08},{kind:'quadratic',cx:x+w*0.5,cy:y+h*0.23,x:x+w*0.8,y:y+h*0.08}],color:'#bd4d43',opacity:1,fill:false,stroke:{color:'#bd4d43',width:3}});return c;
    },
    /** Whiteboard paths reveal by arc length; the pen follows the visible endpoint. */
    whiteboard(o={}) {
      o={id:'board',...o};const {x,y,width:w,height:h}=bounds(o),p=clamp(o.progress??1),c=[];
      const points=o.points??[{x:x+w*0.08,y:y+h*0.7},{x:x+w*0.25,y:y+h*0.48},{x:x+w*0.45,y:y+h*0.58},{x:x+w*0.7,y:y+h*0.2},{x:x+w*0.92,y:y+h*0.3}],hand=path.hand(points,o.id,2);
      c.push(path.line(hand,theme.ink,5,p));
      const tip=path.pointAt(hand,p);c.push({op:'polygon',points:[{x:tip.x,y:tip.y},{x:tip.x+12,y:tip.y-3},{x:tip.x+4,y:tip.y-13}],color:theme.accent,opacity:1},paint.rect(tip.x+7,tip.y-42,11,34,theme.ink,3));
      if(o.title)c.push(label(o,'title',o.title,x,y,w,34));
      if(o.annotation)c.push(label(o,'annotation',o.annotation,x+w*0.1,y+h*0.82,w*0.8,24),{...paint.rect(x+w*0.08,y+h*0.81,w*0.84*MO.expoOut(p),42,'#e6c75a'),opacity:0.18});return c;
    },
    /** Whole-word kinetic typography retains complete, stable text IDs. */
    kineticType(o={}) {
      o={id:'type',...o};const {x,y,width:w,height:h}=bounds(o),words=(o.words??['MAKE','IT','MOVE']).slice(0,8),p=clamp(o.progress??1),size=o.fontSize??Math.min(80,h/(words.length*1.5)),c=[];
      for(const [i,word] of words.entries()) {const q=MO.lagged(i,words.length,p,0.18),dy=(1-MO.expoOut(q))*18,yy=y+i*size*1.45+dy;
        if(i===(o.highlight??words.length-1))c.push(paint.rect(x-8,yy,w,Math.min(size*1.3,h),'#e6c75a',4));
        const text=label(o,'word-'+i,word,x,yy,w-16,size,o.color??theme.ink);text.opacity=q;c.push(text);
      }return c;
    }
  };
  return {motion:MO,camera,path,paint,components};
}
