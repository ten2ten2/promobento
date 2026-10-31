// Candidate inventory only, adapted from huashu-motion cli/lib/grab.js @ 52467f99 (MIT).
// No media bytes are read or copied; selection and per-file rights precede ingestion.
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,relative,sep,join,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';

const within=(root,path)=>path.startsWith(root+sep);
const skipped=new Set(['node_modules','.git','dist','build','out','.om','_archive','.next','coverage','vendor','Pods','DerivedData','.cache']);
const kinds=new Map(Object.entries({'.png':'image','.jpg':'image','.jpeg':'image','.webp':'image','.gif':'image','.svg':'vector','.avif':'image',
 '.mp4':'video','.mov':'video','.webm':'video','.ico':'icon','.icns':'icon'}));

export function discoverLocalMaterials({sourceDir,sourceUrl,outputDir,card,observeStyles=false}){
 // Directory discovery has separate approval from a material's later usage rights.
 if(typeof sourceUrl!=='string'||!sourceUrl.trim()||sourceUrl.length>2048||card.status!=='confirmed_for_s1_eval'||card.confirmation?.confirmedBy!=='owner'||card.confirmation.scope!=='s1-first-internal-evaluation'
  ||card.rights?.scope!=='internal_eval_only'||card.rights.publicUseCleared!==false||card.materialLicenseReview?.status==='permission_required'
  ||!card.assetSources?.some(item=>item.kind==='local_project_media'&&item.url===sourceUrl))throw Error('LOCAL_SOURCE_APPROVAL_REQUIRED');
 const root=realpathSync(sourceDir),output=resolve(outputDir),artifacts=realpathSync('artifacts');
 if(!within(artifacts,output)||existsSync(output))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 let parent=dirname(output);while(!existsSync(parent)&&parent!==dirname(parent))parent=dirname(parent);
 const actualParent=realpathSync(parent);if(actualParent!==artifacts&&!within(artifacts,actualParent))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 if(typeof observeStyles!=='boolean')throw Error('LOCAL_DISCOVERY_MODE_INVALID');
 const candidates=[],limits={maxDepth:6,maxEntries:10000,maxCandidates:1000},missing=[];let entries=0,symlinks=0,styleBytes=0,styleFiles=0;
 const colours=new Map(),fonts=new Map(),add=(map,value,path)=>{const existing=map.get(value);if(existing){existing.count++;if(existing.sources.length<8&&!existing.sources.includes(path))existing.sources.push(path);}else if(map.size<100)map.set(value,{value,count:1,sources:[path]});};
 const scan=(dir,depth)=>{
  for(const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
   if(++entries>limits.maxEntries){if(!missing.includes('entry_limit'))missing.push('entry_limit');return;}
   if(item.name.startsWith('.')||skipped.has(item.name))continue;
   const path=join(dir,item.name);
   if(item.isSymbolicLink()){symlinks++;continue;}
   if(item.isDirectory()){
    if(depth>=limits.maxDepth){if(!missing.includes('depth_limit'))missing.push('depth_limit');continue;}
    if(!within(root,realpathSync(path)))throw Error('LOCAL_MATERIAL_PATH_INVALID');scan(path,depth+1);continue;
   }
   const ext=extname(item.name).toLowerCase(),kind=kinds.get(ext);if(!item.isFile())continue;
   if(observeStyles&&ext==='.css'){
    const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||!within(root,realpathSync(path)))throw Error('LOCAL_MATERIAL_PATH_INVALID');
    if(styleFiles>=100||stat.size>256<<10||styleBytes+stat.size>2<<20){if(!missing.includes('style_limit'))missing.push('style_limit');continue;}
    styleFiles++;styleBytes+=stat.size;const css=readFileSync(path,'utf8').replace(/\/\*[\s\S]*?\*\//g,''),source=relative(root,path).split(sep).join('/');
    for(const match of css.matchAll(/:\s*(#[0-9a-f]{8}|#[0-9a-f]{6}|#[0-9a-f]{4}|#[0-9a-f]{3})(?![0-9a-z_-])/gi))add(colours,match[1].toLowerCase(),source);
    for(const match of css.matchAll(/(?:^|[;{])\s*font-family\s*:\s*(['"]?)([a-z][a-z0-9 -]{0,59})\1\s*(?=[,;}])/gi))add(fonts,match[2].trim(),source);
    continue;
   }
   if(!kind)continue;
   if(candidates.length>=limits.maxCandidates){if(!missing.includes('candidate_limit'))missing.push('candidate_limit');return;}
   const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||!within(root,realpathSync(path)))throw Error('LOCAL_MATERIAL_PATH_INVALID');
   candidates.push({sourceFile:relative(root,path).split(sep).join('/'),kind,byteLength:stat.size,review:'pending_rights_and_visual_review'});
  }
 };
 scan(root,0);
 const result={kind:'local_material_candidates',topicId:card.topicId,sourceUrl,scope:'internal_eval_only',publicUseCleared:false,
  candidates,missing,skippedSymlinks:symlinks,...(observeStyles?{styleObservations:{colours:[...colours.values()],fonts:[...fonts.values()],filesRead:styleFiles,
   scope:'declared_css_only_not_font_or_asset_permission'}}:{})};
 mkdirSync(output,{recursive:true});if(!within(artifacts,realpathSync(output)))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 writeFileSync(join(output,'candidates.json'),canonical(result)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [outputDir,topicId,sourceDir,sourceUrl,...extra]=process.argv.slice(2);
 if(!outputDir||!topicId||!sourceDir||!sourceUrl||extra.length>1||extra.length===1&&extra[0]!=='--styles')throw Error('LOCAL_DISCOVERY_ARGUMENTS_REQUIRED');
 const topics=parseCanonicalJson(readFileSync('research/evals/topics.json')),topic=topics.topics.find(item=>item.id===topicId&&item.countsTowardGate!==false);
 if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=parseCanonicalJson(readFileSync(topic.factCard)),result=discoverLocalMaterials({sourceDir,sourceUrl,outputDir,card,observeStyles:extra[0]==='--styles'});
 console.log(canonical({scope:result.scope,candidates:result.candidates.length,missing:result.missing,review:'pending_rights_and_visual_review'}));
}
