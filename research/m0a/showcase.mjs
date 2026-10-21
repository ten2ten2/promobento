import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {canonical,sourceValuesBytes} from '../../packages/contracts/index.mjs';
import {mediaDeclarations} from '../../apps/renderer/src/admission-media.mjs';

/** Original engineering studies. Sources stay inert until the admission container runs them. */
export function showcaseCandidate(topic,{durationSeconds=30,revision='initial'}={}) {
  if(!['deepseek','duolingo-math'].includes(topic)||![15,30].includes(durationSeconds)||!['initial','edited'].includes(revision))
    throw Error('SHOWCASE_INPUT_INVALID');
  const math=topic==='duolingo-math',totalFrames=durationSeconds*30;
  const declarations={schemaVersion:'2.7.0',kind:'runtime_declarations',
    editables:[{id:'headline',label:'Opening headline',type:'text'}],
    markers:[{id:'opening',frame:0,label:'Opening'},{id:'feature',frame:Math.floor(totalFrames*0.3),label:'Feature demonstration'},
      {id:'close',frame:Math.floor(totalFrames*0.76),label:'Closing invitation'}],regions:[],
    fonts:mediaDeclarations({durationSeconds}).fonts,videoUses:[]};
  const resources={schemaVersion:'2.7.0',kind:'admission_resources',
    resourceIds:['geist-sans-fixture','geist-mono-fixture','original-score'],audioEvents:[{
      eventId:'score',kind:'music',sourceId:'original-score',frameStart:0,frameEndExclusive:totalFrames,
      sourceOffsetFrames:0,gainDb:-4,fadeInFrames:15,fadeOutFrames:30}]};
  const values={headline:math?(revision==='edited'?'A little math.':'Make room for math.'):(revision==='edited'?'Ideas, connected.':'Text meets image.')};
  const {schemaVersion,kind,...runtimeDeclarations}=declarations;
  const source=`export default {apiVersion:'2.7.0',...${canonical(runtimeDeclarations)},prepare(context) {
    const w=context.width,h=context.height,math=${math},ink=math?'#222e37':'#f1f2e8',paper=math?'#f4ede0':'#14291e',accent=math?'#c65030':'#d1ed64';
    const clamp=x=>Math.max(0,Math.min(1,x));
    const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
    const rect=(x,y,width,height,color,radius=0,opacity=1)=>({op:'rect',x,y,width,height,color,radius,opacity});
    const circle=(x,y,radius,color,opacity=1)=>({op:'circle',x,y,radius,color,opacity});
    const text=(id,value,x,y,size,color=ink,maxWidth=w-200,opacity=1,mono=false)=>{
      const fontId=mono?'geist-mono-fixture':'geist-sans-fixture',weight=mono?400:600;
      const measured=context.measureText(fontId,value,size,weight);
      const fontSize=measured.width>maxWidth?size*maxWidth/measured.width:size;
      return {op:'text',id,text:value,fontId,weight,fontSize,x,y,width:maxWidth,height:fontSize*1.4,color,opacity};
    };
    return {draw(time) {
      const p=time.numerator/(context.totalFrames-1),phase=p<0.3?0:p<0.76?1:2;
      const phaseStart=phase===0?0:phase===1?0.3:0.76;
      const enter=smooth((p-phaseStart)*16),rise=(1-enter)*35;
      const commands=[rect(0,0,w,h,paper),text('index',math?'FIELD NOTES / 02':'FIELD NOTES / 01',100,150,25,ink,w-200,1,true),
        rect(100,215,w-200,2,math?'#c9c1b5':'#526449'),
        text('product',math?'Duolingo Math':'DeepSeek-V4.1-Flash',100,255,38),
        text('study','UNOFFICIAL MOTION STUDY',100,h-160,20,ink,w-200,1,true),
        rect(100,h-100,(w-200)*p,5,accent)];
      if(phase===0) {
        commands.push(text('opening',context.values.headline,100,410,92),
          text('opening-two',math?'Every day.':'One model.',100,530,92),
          text('opening-detail',math?'Explore a different way to practice.':'A model with native visual understanding.',100,700,30));
        if(math) {
          for(let i=0;i<4;i++)commands.push(rect(100+i*220,900+Math.sin(p*7+i)*16,190,330,i<3?accent:'#d9d2c6',24));
          commands.push(text('fraction','3 / 4',100,1300,120),text('fraction-detail','A fraction. A fresh perspective.',100,1480,31));
        } else {
          const cx=w/2,cy=1110;
          for(let i=0;i<6;i++) {
            const angle=i*Math.PI/3+p*2;
            commands.push(circle(cx+Math.cos(angle)*230,cy+Math.sin(angle)*230,70,accent,0.28+0.1*i));
          }
          commands.push(circle(cx,cy,132,accent),text('core','V4.1',cx-100,cy-45,66,paper,200),
            text('understanding','Different inputs. Connected ideas.',100,1480,32));
        }
      } else if(phase===1) {
        commands.push(text('feature-title',math?'Find the pattern.':'Read. See. Build.',100,410+rise,85));
        if(math) {
          for(let row=0;row<5;row++)for(let col=0;col<5;col++) {
            const t=smooth((p-0.3)*4),filled=col<row+1;
            commands.push(circle(170+col*180,700+row*140,42,filled?accent:'#d9d2c6',filled?0.5+0.5*t:1));
          }
          commands.push(text('math-topic','Algebra. Geometry. Statistics.',100,1450,39),
            text('math-body','Choose a topic and keep practicing.',100,1530,31));
        } else {
          commands.push(rect(100,700,w-200,280,'#d1ed64',28),text('text-label','TEXT',145,745,24,paper,w-290,1,true),
            text('text-example','What could this become?',145,840,44,paper,w-290),
            rect(100,1020,w-200,310,'#edf0dc',28),text('image-label','IMAGE',145,1060,24,paper,w-290,1,true));
          for(let i=0;i<8;i++)commands.push(rect(145+i*87,1250-50*Math.sin(i*0.8+p*4),60,60+50*Math.sin(i*0.8+p*4),paper,8));
          commands.push(text('feature-detail','Native multimodal input.',100,1450,43),
            text('feature-body','Available through the DeepSeek API.',100,1530,31));
        }
      } else {
        commands.push(circle(w-180,590,180,accent),
          text('closing-title',math?'Small practice.':'Start with an idea.',100,850+rise,88),
          text('closing-two',math?'More curiosity.':'Explore what is next.',100,970+rise,72),
          rect(100,1280,w-200,150,accent,24),
          text('cta',math?'EXPLORE DUOLINGO MATH':'EXPLORE THE DEEPSEEK API',140,1325,34,paper,w-280),
          text('url',math?'duolingo.com':'deepseek.com',100,1530,32));
      }
      // Compose the editorial content inside the portrait preset's text-safe area.
      // The background stays full bleed; shapes and their labels move together.
      const safeCommands=commands.map((command,i)=>{
        if(i===0)return command;
        const placed={...command,x:104+(command.x-100)*0.9,y:212+(command.y-150)*0.76};
        if(command.op==='text')return {...placed,width:command.width*0.9,height:command.height*0.84,fontSize:command.fontSize*0.84};
        if(command.op==='circle')return {...placed,radius:command.radius*0.84};
        return {...placed,width:command.width*0.9,height:command.height*0.76,
          radius:Math.min(command.radius*0.84,command.width*0.45,command.height*0.38)};
      });
      return {commands:safeCommands,regions:[]};
    },dispose(){}};
  }};`;
  return {manifest:{schemaVersion:'2.7.0',kind:'admission_candidate',capabilityProfile:'canvas-media-v1',
    targetId:'tiktok:portrait',durationSeconds,seed:'m0a-study-'+topic},declarations,resources,values,source};
}

export function writeShowcaseSources(outputDirectory,options={}) {
  const out=resolve(outputDirectory);mkdirSync(out,{recursive:true});
  const entries=[];
  for(const topic of ['deepseek','duolingo-math']) {
    const candidate=showcaseCandidate(topic,options),sourceDirectory=join(out,topic);mkdirSync(sourceDirectory);
    for(const [name,value] of [['candidate',candidate.manifest],['declarations',candidate.declarations],['resources',candidate.resources]])
      writeFileSync(join(sourceDirectory,name+'.json'),canonical(value),{flag:'wx'});
    writeFileSync(join(sourceDirectory,'values.json'),sourceValuesBytes(candidate.values),{flag:'wx'});
    writeFileSync(join(sourceDirectory,'composition.mjs'),candidate.source,{flag:'wx'});
    entries.push({topic,sourceDirectory});
  }
  const provenance={kind:'m0a_engineering_showcase',authorship:'Original code authored in the coding session; no external model API call.',
    benchmarkEligible:false,reason:'No metered model comparison, customer fact approval or independent blind review.',
    assets:'Original data geometry; fixed admitted OFL fonts and original CC0 procedural audio. No brand logos, UI captures or third-party photographs.',
    factsCheckedAt:'2026-10-22',factSources:{deepseek:'https://www.deepseek.com/en/news/deepseek-v4-1-flash/',
      'duolingo-math':'https://blog.duolingo.com/product-highlights/'},entries};
  writeFileSync(join(out,'provenance.json'),canonical(provenance),{flag:'wx'});
  return provenance;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {values}=parseArgs({options:{'output-directory':{type:'string'},duration:{type:'string',default:'30'},revision:{type:'string',default:'initial'}}});
  const output=values['output-directory']??'artifacts/m0a-showcase/'+Date.now();
  console.log(canonical(writeShowcaseSources(output,{durationSeconds:Number(values.duration),revision:values.revision})));
}
