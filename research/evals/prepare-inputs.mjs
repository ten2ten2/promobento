// Prepare the existing internal creative API's inputs. No upload, operation, model or render call.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {AUDIO_STYLES} from '../../packages/audio/src/catalog.mjs';

const [directoryArg,rendererRelease]=process.argv.slice(2),directory=resolve(directoryArg??'');
if(!directoryArg||!directory.startsWith(resolve('artifacts')+'/')||!/^renderer-[a-f0-9]{12}$/.test(rendererRelease??''))throw Error('EVAL_PRIVATE_DIRECTORY_AND_PINNED_RENDERER_REQUIRED');
if(existsSync(directory))throw Error('EVAL_INPUT_DIRECTORY_EXISTS');
const read=path=>parseCanonicalJson(readFileSync(path)),topics=read('research/evals/topics.json'),materials=read('research/evals/materials.json');
if(topics.rights.scope!=='internal_eval_only'||topics.factConfirmation.confirmedBy!=='owner'||materials.status!=='ingested_internal_eval'
 ||materials.publicUseCleared!==false||materials.pending.length)throw Error('EVAL_CONFIRMED_INPUTS_REQUIRED');
const cases=[];
for(const topic of topics.topics.filter(topic=>topic.countsTowardGate!==false)){
 const card=read(topic.factCard);
 if(!['software','course'].includes(topic.segment)||card.fictional!==false||card.status!=='confirmed_for_s1_eval'||card.assets!=='ingested_internal_eval'
  ||card.confirmation.confirmedBy!=='owner'||card.confirmation.scope!=='s1-first-internal-evaluation'||!card.videoLanguage
  ||canonical([...card.confirmation.factIds].sort())!==canonical(card.facts.map(fact=>fact.id).sort()))throw Error('EVAL_FACT_CONFIRMATION_REQUIRED');
 const resources=topic.materialIds.map(id=>{
  const asset=materials.assets.find(asset=>asset.id===id&&asset.topicId===topic.id);
  if(!asset||asset.scope!=='internal_eval_only'||asset.publicUseCleared!==false||asset.byteLength>1<<20
   ||!(asset.kind==='video'?asset.mediaType==='application/json'&&asset.videoFramePacking==='webp-pack-v1'&&asset.preview&&Array.isArray(asset.framePacks):['image/png','image/jpeg','image/webp'].includes(asset.mediaType))
   ||!asset.evidenceKey||!asset.licenseRef)throw Error('EVAL_REVIEWED_MATERIAL_REQUIRED');
  if(![asset.width,asset.height].every(size=>Number.isInteger(size)&&size>=1&&size<=4096))throw Error('EVAL_MATERIAL_NORMALIZATION_REQUIRED');
  if(card.materialLicenseReview?.status==='permission_required'&&(asset.origin!=='original_factual_diagram'
   ||card.originalMaterialApproval?.status!=='approved'||card.originalMaterialApproval.assetId!==asset.id))throw Error('MATERIAL_SOURCE_PERMISSION_REQUIRED');
  return asset;
 });
 for(const durationSeconds of topics.variants.durationsSeconds){
  if(![15,30].includes(durationSeconds)||canonical([...topics.variants.aspects].sort())!==canonical(['landscape','portrait']))throw Error('EVAL_VARIANTS_INVALID');
  const id=topic.id+'-'+durationSeconds,context={audience:topic.segment,targetAudience:card.audience,brand:card.brand,product:card.product,
   videoLanguage:card.videoLanguage,durationSeconds,fps:30,aspects:topics.variants.aspects,seed:'s1-eval-'+id,
   creativeBriefVersion:'director-led-v1',brief:card.brief,notes:card.notes,cta:card.cta,facts:card.facts,sources:card.sources,confirmedFactIds:card.confirmation.factIds,factConfirmation:card.confirmation,
   runtimeVersion:'film-runtime-v1',rendererRelease,fonts:[{fontId:'geist-sans',weight:600,style:'normal',licenseRef:'geist-ofl-1.1',rightsCleared:true}],
   resources,audioSources:[],music:{allowedKinds:['procedural','none'],proceduralStyles:AUDIO_STYLES},scope:'internal_eval_only',publicUseCleared:false};
  cases.push({id,topicId:topic.id,durationSeconds,aspects:context.aspects,contextFile:id+'.json',context,
   rightsAdmissions:resources.map(({resourceId,sha256,licenseRef,evidenceKey})=>({resourceId,sha256,licenseRef,evidenceKey,scope:'internal_eval_only'}))});
 }
}
if(cases.length!==12)throw Error('EVAL_TWELVE_CREATIVE_CASES_REQUIRED');
mkdirSync(directory,{recursive:true});
for(const item of cases)writeFileSync(join(directory,item.contextFile),canonical(item.context)+'\n');
const manifest={schemaVersion:'3.0.0',kind:'s1_eval_prepared_inputs',status:'prepared_not_executed',scope:'internal_eval_only',publicUseCleared:false,
 rendererRelease,creativeBriefVersion:'director-led-v1',materialManifestKey:materials.manifestKey,creativeCases:cases.length,expectedFinalFilms:24,
 cases:cases.map(({context,...item})=>item)};
writeFileSync(join(directory,'manifest.json'),canonical(manifest)+'\n');
console.log(canonical({status:manifest.status,creativeCases:manifest.creativeCases,expectedFinalFilms:manifest.expectedFinalFilms,manifest:join(directory,'manifest.json')}));
