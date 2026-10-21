// Original CC0 engineering example; the application and copy are fictional.
import {fontDeclarations,videoUses} from './media-spec.mjs';

const fontId='geist-sans-fixture',monoId='geist-mono-fixture';
const markers=[
  {id:'sound_open',frame:30,label:'Open',audioEventId:'cue_open'},
  {id:'sound_focus',frame:300,label:'Focus',audioEventId:'cue_focus'},
  {id:'sound_finish',frame:600,label:'Finish',audioEventId:'cue_finish'}
];
const beaconColors=['#20ff60','#ff20e0','#20e0ff'];

export default {
  apiVersion:'2.7.0',
  editables:[
    {id:'headline',label:'Headline',type:'text'},
    {id:'accent',label:'Accent',type:'color'},
    {id:'progress',label:'Progress',type:'number',min:0,max:1,step:0.01},
    {id:'showCaption',label:'Caption',type:'boolean'},
    {id:'theme',label:'Theme',type:'enum',choices:['paper','forest']}
  ],
  markers,
  regions:[
    {id:'headline',label:'Headline',sourcePath:'tests/fixtures/render/media.mjs'},
    {id:'screen',label:'Application demo',sourcePath:'tests/fixtures/render/media.mjs'},
    {id:'caption',label:'Caption',sourcePath:'tests/fixtures/render/media.mjs'}
  ],
  videoUses,fonts:fontDeclarations,
  async prepare({surface,width,height,values,fonts,videoFrames}) {
    await fonts.ready;
    const {headline,accent,progress,showCaption,theme}=values;
    const paper=theme==='paper',background=paper?'#f4f0e7':'#1d372e',ink=paper?'#223d31':'#f4f0e7';
    const bodyFamily=fonts.family(fontId),monoFamily=fonts.family(monoId);
    const nodes=[];
    const element=(tag,style,text,qaId)=>{
      const node=document.createElement(tag);
      Object.assign(node.style,{position:'absolute',margin:'0',fontFamily:bodyFamily,fontWeight:'600',color:ink,...style});
      if(text!==undefined) node.textContent=text;
      if(qaId) node.dataset.qaText=qaId;
      surface.root.append(node);nodes.push(node);return node;
    };
    // Cmap coverage is checked independently of the browser's font load barrier.
    for(const text of [headline,'PAPERPLANE / FICTIONAL DEMO','Your next idea, in motion.','Fewer tabs. More focus.',
      'A clearer view of every project.','Make time for what matters.'])
      fonts.assertText(fontId,text,600);
    fonts.assertText(monoId,'PREVIEW / 30 SECONDS',400);
    const backdrop=element('div',{inset:'0',background});
    element('div',{left:'104px',top:'220px',width:'784px',fontSize:'23px',letterSpacing:'2px'},
      'PAPERPLANE / FICTIONAL DEMO','brand');
    const title=element('h1',{left:'104px',top:'300px',width:'784px',height:'242px',fontSize:'88px',lineHeight:'1.05',
      whiteSpace:'pre-line',overflow:'hidden',letterSpacing:'-4px'},headline,'headline');
    const subtitle=element('div',{left:'108px',top:'565px',width:'770px',fontSize:'29px',lineHeight:'1.25'},
      'Your next idea, in motion.','subtitle');
    const shadow=element('div',{left:'96px',top:'676px',width:'800px',height:'457px',borderRadius:'32px',background:accent,opacity:'0.45'});
    const canvas=surface.createCanvas();nodes.push(canvas);
    Object.assign(canvas.style,{position:'absolute',inset:'0'});
    const drawing=canvas.getContext('2d');
    if(!drawing) throw new Error('CANVAS_2D_UNAVAILABLE');
    const caption=element('div',{left:'108px',top:'1190px',width:'770px',height:'96px',fontSize:'42px',lineHeight:'1.14',
      overflow:'hidden',display:showCaption?'block':'none'},'', 'caption');
    element('div',{left:'108px',top:'1330px',width:'724px',height:'10px',borderRadius:'5px',background:ink,opacity:'0.12'});
    const bar=element('div',{left:'108px',top:'1330px',width:'0',height:'10px',borderRadius:'5px',background:accent});
    // Distinct optical pulses provide observed, rather than declared, A/V landmarks.
    const beacon=element('div',{left:'856px',top:'1324px',width:'28px',height:'28px',background:'#819187'});
    element('div',{left:'108px',top:'1410px',width:'760px',fontFamily:monoFamily,fontWeight:'400',fontSize:'20px'},
      'PREVIEW / 30 SECONDS','footer');
    for(const [index,color] of ['#ff0000','#00ff00','#0000ff','#808080'].entries())
      element('div',{left:40+index*38+'px',top:height-60+'px',width:'24px',height:'24px',background:color});
    return {
      async draw(time) {
        const seconds=time.numerator/time.denominator,frame=seconds*30;
        const video=await videoFrames.get('screen-demo',time);
        drawing.reset();drawing.scale(surface.pixelScale,surface.pixelScale);
        drawing.save();drawing.beginPath();drawing.roundRect(104,660,784,441,24);drawing.clip();
        drawing.drawImage(video.image,104,660,784,441);drawing.restore();
        shadow.style.transform=`translateY(${(4*Math.sin(seconds*0.65)).toFixed(6)}px)`;
        title.style.transform=`translateY(${(5*Math.sin(seconds*0.4)).toFixed(6)}px)`;
        subtitle.style.opacity=(0.8+0.2*Math.cos(seconds*0.3)**2).toFixed(6);
        caption.textContent=seconds<10?'Fewer tabs. More focus.':seconds<20?'A clearer view of every project.':'Make time for what matters.';
        bar.style.width=(724*progress*(0.3+0.7*seconds/30)).toFixed(6)+'px';
        const active=markers.findIndex(marker=>frame>=marker.frame && frame<marker.frame+6);
        beacon.style.background=active<0?'#819187':beaconColors[active];
        return {regions:[
          {id:'headline',x:104,y:300+5*Math.sin(seconds*0.4),width:784,height:242},
          {id:'screen',x:104,y:660,width:784,height:441},
          ...(showCaption?[{id:'caption',x:108,y:1190,width:770,height:96}]:[])
        ]};
      },
      dispose(){for(const node of nodes) node.remove();}
    };
  }
};
