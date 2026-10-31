import type {Json} from './pipeline-types.ts';
import {assertCanvasTitle} from '../../../packages/blocks/src/canvas-title-validate.ts';

/** Keep new template choices out of older frozen methods and video-led previews. */
export function supportsVoxClip(method:Json|null,resources:Json[]):boolean{
 const [major,minor]=(method?.version??'').split('.').map(Number);
 return method?.id==='product-directing'&&(major>1||major===1&&minor>=31)
  &&['image','svg'].includes(resources[0]?.kind)&&resources.filter(asset=>['image','svg'].includes(asset.kind)).length>=2;
}

export function supportsCanvasTitle(method:Json|null,context:Json):boolean{
 const [major,minor]=(method?.version??'').split('.').map(Number),font=context.fonts?.[0];
 if(method?.id!=='product-directing'||!(major>1||major===1&&minor>=32)||!font)return false;
 const text=context.product??context.brand??context.facts?.[0]?.text;
 if(typeof text!=='string')return false;
 try{assertCanvasTitle(text,'headline',font.style);return true;}catch{return false;}
}

/** Sequence pages must be exact confirmed text, not a product label attached to an unrelated fact. */
export function supportsCanvasSequence(method:Json|null,context:Json):boolean{
 const [major,minor]=(method?.version??'').split('.').map(Number);
 if(!supportsCanvasTitle(method,context)||!(major>1||major===1&&minor>=35))return false;
 return (context.facts??[]).some((fact:Json)=>{try{assertCanvasTitle(fact.text,'headline',context.fonts[0].style);return context.confirmedFactIds?.includes(fact.id);}catch{return false;}});
}

/** Compact B cards become one silent trusted-block hero, not three model-written full movies. */
export function directionHero(card:Json,context:Json,index:number):Json{
 const font=context.fonts[0],face={fontId:font.fontId,weight:font.weight,style:font.style};
 const palette=(roles:string[],fallback:number)=>card.palette.find((entry:Json)=>roles.includes(entry.role))??card.palette[fallback%card.palette.length];
 const bg=palette(['bg','background'],0),ink=palette(['ink','foreground','text'],1),accent=palette(['accent','primary'],2);
 const supported=['ui-showcase','device-3d','object-studio','ui-journey','continuous-focus','vox-clip','feature-grid','curriculum','drawn-steps','canvas-title','canvas-sequence','hook-title','kinetic-title','cta-endcard','captions'];
 const proposals=card.skeleton.map((scene:Json)=>scene.approach.replace(/^block:/,''));
 const block=card.usesDepth?(proposals.includes('object-studio')?'object-studio':proposals.includes('device-3d')?'device-3d':'ui-journey'):
  proposals.find((id:string)=>['ui-showcase','ui-journey','continuous-focus','vox-clip'].includes(id))??
  proposals.find((id:string)=>supported.includes(id)&&!['hook-title','kinetic-title','cta-endcard','captions'].includes(id))??proposals.find((id:string)=>supported.includes(id))??(proposals.includes('custom')?'ui-showcase':undefined);
 if(!block)throw Error('DIRECTION_HERO_UNSUPPORTED');
 // Compare palette/depth on the same primary cleared image, not an auxiliary logo or a random catalog item.
 const asset=context.resources[0],facts=context.facts,first=facts[0];
 const caption={...first,text:context.product??context.brand??first.text};
 const texts:Json={},assets:Json={},text=(id:string,fact:Json,role='headline')=>{texts[id]={text:fact.text,role,factIds:[fact.id]};return id;};
 const image=()=>{assets.hero={resourceId:asset.resourceId};return'hero';};
 let params:Json;
 if(['ui-showcase','device-3d','object-studio','continuous-focus'].includes(block))params={assetKey:image(),textSlot:text('headline',caption)};
 else if(block==='ui-journey')params={items:[0,1].map(i=>({assetKey:image(),textSlot:text('fact-'+i,facts[i%facts.length])}))};
 else if(block==='vox-clip'){
  if(!['image','svg'].includes(asset.kind))throw Error('VOX_CLIP_IMAGE_REQUIRED');
  // Direction cards compare the same primary image; only the final director
  // chooses distinct, semantically related source states for a real handoff.
  params={intervalFrames:90,items:[{assetKey:image()},{assetKey:image()}]};
 }
 else if(['feature-grid','curriculum','drawn-steps'].includes(block))params={items:[0,1,...(facts.length>2?[2]:[])].map(i=>({textSlot:text('fact-'+i,facts[i%facts.length],'label')}))};
 else if(block==='captions')params={assetKey:image(),cues:[{textSlot:text('headline',first,'caption'),start:0,end:450}]};
 else if(block==='canvas-title')params={textSlot:text('headline',caption)};
 else if(block==='canvas-sequence'){
  const admissible=facts.filter((fact:Json)=>{try{assertCanvasTitle(fact.text,'headline',face.style);return context.confirmedFactIds?.includes(fact.id);}catch{return false;}});
  if(!admissible.length)throw Error('CANVAS_SEQUENCE_FACT_REQUIRED');
  params={items:[0,1].map(index=>({textSlot:text('headline-'+index,admissible[index%admissible.length]),startFrame:index*120}))};
 }
 else if(block==='cta-endcard'){
  texts.cta={text:context.cta?.text??first.text,role:'cta',factIds:[first.id]};params={textSlot:'cta'};
  if(context.cta?.urlLabel){texts.url={text:context.cta.urlLabel,role:'label',factIds:[first.id]};params.subtitleSlot='url';}
 }else params={textSlot:text('headline',first)};
 return{schemaVersion:'3.0.0',specVersion:'film-v1',audience:context.audience,durationSeconds:15,fps:30,totalFrames:450,
  style:{palette:{roles:{bg:bg.color,ink:ink.color,accent:accent.color},sources:{bg:bg.source,ink:ink.source,accent:accent.source}},
   type:{display:face,text:face,scale:card.key==='fit'?'regular':'large'},
   motion:{language:card.language,energy:Math.max(1,Math.min(5,Math.round(card.feel.eventsPerBar/2))),easing:'expo-out',transitions:'tight'},texture:{kind:'none'}},
  audio:{music:{kind:'none'},sfx:[],captions:'off',mute:true},texts,assets,
  scenes:[{id:'hero',start:0,end:450,kind:'block',block:block+'@1',params,purpose:'Actual trusted-block hero for the '+card.key+' direction.'}],
  treatment:{message:card.logline,hook:first.text,energyCurve:[{frame:0,level:1},{frame:449,level:1}],continuity:'One silent hero preview; the full selected story is written in C.'}};
}
