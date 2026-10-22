/** Source strings only. Execute these compositions only in admission containers. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {canonical,sourceValuesBytes} from '@promobento/contracts';
import {admittedFontDeclarations,allAdmittedFontDeclarations} from '../src/admission-fonts.mjs';

export function visualCandidate({durationSeconds=15}={}) {
  if(![15,30].includes(durationSeconds))throw Error('ADMISSION_DURATION_INVALID');
  const fontIds=['geist-sans-fixture','geist-mono-fixture','hm-noto-sans-sc','hm-lxgw-wenkai','hm-inter','hm-poppins'];
  const names=['kineticType','ui','mechanism','chart','flatWorld','collage','whiteboard'];
  const declarations={schemaVersion:'2.7.0',kind:'runtime_declarations',editables:[],videoUses:[],
    markers:names.map((name,i)=>({id:name,frame:Math.floor((i+0.65)*durationSeconds*30/7),label:name})),
    regions:[{id:'stage',label:'Current visual grammar',sourcePath:'composition.mjs'}],fonts:admittedFontDeclarations(fontIds)};
  const {schemaVersion,kind,...declared}=declarations;
  const source=`export default {apiVersion:'2.7.0',...${canonical(declared)},prepare(context){
    const {paint:P,motion:M,components:C,camera}=context,seconds=context.totalFrames/30;
    const titles=['让故事动起来','产品就在眼前','让原理看得见','让数据说清楚','构建一整个世界','证据连接成故事','一步一步画明白'];
    return {draw(time){
      const t=time.numerator/30,segment=seconds/7,index=Math.min(6,Math.floor(t/segment)),local=t-index*segment,p=M.at(local,0,0.85);
      const dark=index===4,background=dark?'#102c3c':'#f5f1e8',ink=dark?'#f5f1e8':'#24352b';
      const commands=[P.rect(0,0,1080,1080,background),P.texture('paper',0,0,1080,1080,{color:background,accent:dark?'#24556b':'#b7aa8e',seed:17,opacity:0.35}),
        P.text('series','MOTION / A VISUAL VOCABULARY',100,95,880,{fontId:'hm-inter',weight:400,fontSize:22,color:ink}),
        P.text('headline',titles[index],95,150,890,{fontId:'hm-noto-sans-sc',weight:700,fontSize:64,color:ink}),
        P.text('chapter',String(index+1).padStart(2,'0')+' / 07',100,950,380,{fontId:'hm-inter',weight:400,fontSize:22,color:ink}),
        P.rect(100,1010,880*(time.numerator/(context.totalFrames-1)),4,dark?'#6bbcb1':'#f2783d')];
      const box={x:130,y:340,width:790,height:470,id:'scene-'+index,progress:p};
      if(index===0)commands.push(...C.kineticType({...box,x:160,y:340,width:760,height:480,fontId:'hm-poppins',weight:700,words:['MAKE','IT','MOVE'],fontSize:90}));
      if(index===1)commands.push(...C.ui({...box,title:'Launch workspace',resourceId:'screen-still',crop:{x:0.18,y:0.1,width:0.8,height:0.84}}));
      if(index===2)commands.push(...C.mechanism({...box,nodes:[{label:'Evidence'},{label:'Story'},{label:'Delivery'}],formula:'Facts + rhythm = a clear story'}));
      if(index===3)commands.push(...C.chart({...box,title:'Illustrative data',data:[{label:'A',value:18},{label:'B',value:42},{label:'C',value:64},{label:'D',value:90}]}));
      if(index===4)commands.push(...C.flatWorld({...box,time:t,nodes:['Discover','Connect','Grow']}));
      if(index===5)commands.push(...C.collage({...box,cards:[{title:'Observation',text:'Keep the source.',resourceId:'screen-detail'},{title:'Evidence',text:'Connect the details.',resourceId:'screen-still'}]}));
      if(index===6)commands.push(...C.whiteboard({...box,title:'Build it step by step',annotation:'Start with a clear point.'}),P.text('handwriting','从想法到画面',220,870,650,{fontId:'hm-lxgw-wenkai',weight:500,fontSize:40}));
      if(index===0)commands.push(P.lightSweep(140,330,770,460,M.at(local,0.5,0.8)));
      const pose={x:540,y:540,z:1+0.006*M.sineInOut(p),r:0};
      const stage={id:'stage',x:130,y:330,width:790,height:500};
      return {commands:camera.apply(commands,pose),regions:[camera.region(stage,pose)]};
    },dispose(){}};
  }};`;
  return {manifest:{schemaVersion:'2.7.0',kind:'admission_candidate',capabilityProfile:'canvas-media-v1',targetId:'instagram_feed:square',durationSeconds,seed:'visual-grammar-v1'},
    declarations,resources:{schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:[...fontIds,'screen-still','screen-detail'],audioEvents:[]},values:{},source};
}
export function fontGalleryCandidate() {
  const fonts=allAdmittedFontDeclarations().filter(font=>font.fontId.startsWith('hm-'));
  const declarations={schemaVersion:'2.7.0',kind:'runtime_declarations',editables:[],videoUses:[],markers:[],regions:[],fonts};
  const {schemaVersion,kind,...declared}=declarations;
  const source=`export default {apiVersion:'2.7.0',...${canonical(declared)},prepare(context){return {draw(){
    const commands=[context.paint.rect(0,0,1080,1080,'#f5f1e8')];let i=0;
    for(const font of ${canonical(fonts)})for(const weight of font.weights){
      commands.push(context.paint.text('face-'+i,'Abc 123',90+(i%3)*310,80+Math.floor(i/3)*65,280,{fontId:font.fontId,weight,fontSize:28,padding:8}));i++;
    }
    return {commands};},dispose(){}};}};`;
  return {manifest:{schemaVersion:'2.7.0',kind:'admission_candidate',capabilityProfile:'canvas-media-v1',targetId:'instagram_feed:square',durationSeconds:15,seed:'font-gallery-v1'},
    declarations,resources:{schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:fonts.map(font=>font.fontId),audioEvents:[]},values:{},source};
}
export function writeVisualCandidate(directory,options) {
  const candidate=visualCandidate(options);return writeCandidate(directory,candidate);
}
export function writeCandidate(directory,candidate) {
  mkdirSync(directory,{recursive:true});
  for(const [file,value] of [['candidate',candidate.manifest],['declarations',candidate.declarations],['resources',candidate.resources]])writeFileSync(join(directory,file+'.json'),canonical(value));
  writeFileSync(join(directory,'values.json'),sourceValuesBytes(candidate.values));writeFileSync(join(directory,'composition.mjs'),candidate.source);return candidate;
}
