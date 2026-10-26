import {filmFixture} from './fixture.mjs';
export const customSource=`PB.scene('product',ctx=>{
 const w=ctx.target.width,h=ctx.target.height,s=ctx.target.safeInsets;
 const safe=document.createElement('div');Object.assign(safe.style,{position:'absolute',left:w*s.left+'px',top:h*s.top+'px',width:w*(1-s.left-s.right)+'px',height:h*(1-s.top-s.bottom)+'px'});ctx.root.append(safe);
 const heading=document.createElement('div'),result=document.createElement('div'),ending=document.createElement('div');
 for(const box of [heading,result,ending]){Object.assign(box.style,{position:'absolute',left:'5%',top:'20%',width:'90%',height:'60%'});safe.append(box);}
 ctx.text('headline').mount(heading,{maxLines:3});ctx.text('product').mount(result,{maxLines:3});ctx.text('cta').mount(ending,{maxLines:3});
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;Object.assign(canvas.style,{position:'absolute',inset:'0',pointerEvents:'none'});ctx.root.append(canvas);const drawing=canvas.getContext('2d');
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),circle=document.createElementNS('http://www.w3.org/2000/svg','circle');svg.setAttribute('width','80');svg.setAttribute('height','80');Object.assign(svg.style,{position:'absolute',left:w*s.left+'px',top:h*(1-s.bottom)-80+'px'});circle.setAttribute('cx','40');circle.setAttribute('cy','40');circle.setAttribute('r','20');circle.setAttribute('fill',ctx.style.palette.accent);svg.append(circle);ctx.root.append(svg);
 const timeline=gsap.timeline({paused:true});
 ctx.OM.clock(timeline,t=>{
  drawing.clearRect(0,0,w,h);drawing.fillStyle=ctx.style.palette.accent;drawing.fillRect(w*.5,h*.85,20+40*Math.min(1,t),4);
  const a=Math.min(1,t/.6),b=Math.min(1,Math.max(0,(t-4)/.8)),c=Math.min(1,Math.max(0,(t-9)/.6));
  heading.style.opacity=String(1-b);heading.style.transform=b===0?'none':'translateY('+(-b*h*.1)+'px)';
  result.style.opacity=String(b*(1-c));result.style.transform=b===1?'none':'translateY('+((1-b)*h*.1)+'px)';
  ending.style.opacity=String(c);ending.style.transform=c===1?'none':'scale('+(.9+.1*c)+')';
 },15);
 return {timeline};
});`;
export function customFixture(){
 const film=filmFixture();film.assets={};
 film.scenes=[{id:'product',kind:'custom',module:'scenes/product/index.js',start:0,end:450,purpose:'Original engineering choreography; no third-party imagery.',brief:'One changing typographic world.',
  params:{hardest:true,textSlots:['headline','product','cta'],assetKeys:[],events:[{name:'request-land',frame:18},{name:'result-land',frame:144},{name:'cta-land',frame:288}],readingHolds:[{start:30,end:105},{start:150,end:255},{start:300,end:450}]}}];
 return{film,sources:{'scenes/product/index.js':customSource}};
}
