import {mediaDeclarations,admittedMediaCatalog} from '../src/admission-media.mjs';
import {canonical,sourceValuesBytes} from '@promobento/contracts';
import {writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

export function mediaCandidate({durationSeconds=30,title='Ideas into motion',image='screen-still'}={}) {
  const totalFrames=durationSeconds*30;
  const declarations={schemaVersion:'2.7.0',kind:'runtime_declarations',
    editables:[{id:'headline',label:'Headline',type:'text'},{id:'image',label:'Image',type:'asset',acceptedMediaTypes:['image/png']}],
    markers:[{id:'open',frame:30,label:'Opening accent',audioEventId:'opening'}],
    regions:[{id:'screen',label:'Product screen',sourcePath:'composition.mjs'}],...mediaDeclarations({durationSeconds})};
  const resources={schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:admittedMediaCatalog().resources.map(resource=>resource.id),
    audioEvents:[{eventId:'score',kind:'music',sourceId:'original-score',frameStart:0,frameEndExclusive:totalFrames,
      sourceOffsetFrames:0,gainDb:0,fadeInFrames:15,fadeOutFrames:15},
    {eventId:'opening',kind:'sfx',sourceId:'original-cue',frameStart:30,frameEndExclusive:36,sourceOffsetFrames:0,gainDb:-6,fadeInFrames:0,fadeOutFrames:2}]};
  const {schemaVersion,kind,...declared}=declarations;
  const source=`export default {apiVersion:'2.7.0',...${canonical(declared)},prepare(context) {
    const {width:w,height:h}=context;
    const rect=(x,y,width,height,color,radius=0)=>({op:'rect',x,y,width,height,color,radius,opacity:1});
    const text=(id,value,y,size,color='#24352b')=>({op:'text',id,text:value,fontId:'geist-sans-fixture',weight:600,
      fontSize:size,x:90,y,width:w-180,height:size*1.3,color,opacity:1});
    const measured=context.measureText('geist-sans-fixture',context.values.headline,74,600);
    if(measured.width>w-180)throw Error('Headline too long');
    return {draw(time) {
      const frame=time.numerator,progress=frame/(context.totalFrames-1);
      const commands=[rect(0,0,w,h,'#f5f1e8'),text('brand','PROMOBENTO / MOTION LAB',210,32),
        text('headline',context.values.headline,270,74),text('subtitle','Real assets. A story worth sharing.',400,32),
        rect(70,570,w-140,550,'#24352b',24),{op:'video',useId:'screen-demo',x:90,y:590,width:w-180,height:506.25,opacity:1},
        {op:'image',resourceId:context.values.image,x:90,y:1170,width:266.667,height:150,opacity:1},
        text('step','01 / CREATE',1130,26),text('detail','Build your next launch.',1325,28),
        rect(90,1380,w-180,100,'#f2783d',24),text('cta','MAKE IT MOVE',1400,40),
        rect(90,1810,(w-180)*progress,8,'#24352b')];
      if(frame>=30&&frame<36)commands.push(rect(1000,1800,24,24,'#ffffff'));
      return {commands,regions:[{id:'screen',x:90,y:590,width:w-180,height:506.25}]};
    },dispose(){}};
  }};`;
  return {manifest:{schemaVersion:'2.7.0',kind:'admission_candidate',capabilityProfile:'canvas-media-v1',targetId:'tiktok:portrait',durationSeconds,seed:'media-admission-1'},
    declarations,resources,values:{headline:title,image},source};
}

export function writeMediaCandidate(directory,options) {
  const candidate=mediaCandidate(options);mkdirSync(directory,{recursive:true});
  for(const [name,value] of [['candidate',candidate.manifest],['declarations',candidate.declarations],['resources',candidate.resources]])
    writeFileSync(join(directory,name+'.json'),canonical(value));
  writeFileSync(join(directory,'values.json'),sourceValuesBytes(candidate.values));writeFileSync(join(directory,'composition.mjs'),candidate.source);
  return candidate;
}
