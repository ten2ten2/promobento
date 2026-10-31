// Internal approved video intake. Browser is offline; the original is retained,
// and generated poster/30 fps WebP frame packs are reproducible and identity-bound.
import {chromium} from 'playwright-core';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,join,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {parseVideoFrameManifest} from '@promobento/contracts/video-frames';
import {materialApproval} from './material-approval.mjs';
import {imageHeader} from './image-header.mjs';
import {approvedWebUrl,downloadApprovedImage} from './capture-approved-web-images.mjs';

const within=(root,path)=>path.startsWith(root+sep),maxSource=50<<20,maxPack=8<<20,maxTotal=175<<20;
const kindFor=file=>({'.mp4':'video/mp4','.webm':'video/webm'})[extname(file).toLowerCase()];
const validCard=card=>card.status==='confirmed_for_s1_eval'&&card.confirmation?.confirmedBy==='owner'&&card.confirmation.scope==='s1-first-internal-evaluation'&&card.rights?.scope==='internal_eval_only'&&card.rights.publicUseCleared===false;
const blob=bytes=>({sha256:sha256Bytes(bytes),byteLength:bytes.length});
function approved(card,asset){
 const decision=materialApproval(card,asset),derived=asset.derivation;
 const web=derived?.sourceOrigin==='web';
 if(!decision.explicit||derived?.kind!=='approved_video_frame_pack'||decision.explicit.sourceUrl!==asset.sourceUrl
  ||!/^[a-f0-9]{64}$/.test(decision.explicit.sha256??'')||derived.sourceSha256!==decision.explicit.sha256
  ||(web?(decision.source.kind==='local_project_media'||decision.explicit.videoUrl!==asset.videoUrl||derived.videoUrl!==asset.videoUrl||kindFor(approvedWebUrl(asset.videoUrl).pathname)!==derived.sourceMediaType)
   :(decision.source.kind!=='local_project_media'||decision.explicit.sourceFile!==derived.sourceFile||kindFor(derived.sourceFile)!==derived.sourceMediaType)))throw Error('VIDEO_APPROVAL_IDENTITY_REQUIRED');
 return decision;
}
function checkBytes(card,asset,bytes){const decision=approved(card,asset);if(!bytes.length||bytes.length>maxSource||sha256Bytes(bytes)!==decision.explicit.sha256)throw Error('VIDEO_SOURCE_IDENTITY_MISMATCH');}
function sourceSignature(bytes,mediaType){
 if(mediaType==='video/mp4'&&(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')||mediaType==='video/webm'&&(bytes.length<4||bytes.subarray(0,4).toString('hex')!=='1a45dfa3'))throw Error('VIDEO_SOURCE_FORMAT_INVALID');
}
async function bounded(work,ms=15000){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('VIDEO_DECODE_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
async function openBrowser(){
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,chromiumSandbox:true,timeout:30000});
 try{const context=await browser.newContext({viewport:{width:16,height:16},deviceScaleFactor:1,acceptDownloads:false});await context.route('**/*',route=>route.abort('blockedbyclient'));
  const page=await context.newPage();await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob:"><video muted playsinline preload="auto"></video><canvas></canvas>`);return{browser,page,version:browser.version()};
 }catch(error){await browser.close();throw error;}
}
async function extractVideo({page,version},source,mediaType){
 sourceSignature(source,mediaType);
 const info=await bounded(page.evaluate(async({base64,mediaType})=>{
  const data=atob(base64),buffer=new Uint8Array(data.length);for(let i=0;i<data.length;i++)buffer[i]=data.charCodeAt(i);
  const v=document.querySelector('video');if(v.src.startsWith('blob:'))URL.revokeObjectURL(v.src);v.src=URL.createObjectURL(new Blob([buffer],{type:mediaType}));
  const wait=event=>new Promise((resolve,reject)=>{const done=()=>{v.removeEventListener('error',bad);resolve();},bad=()=>{v.removeEventListener(event,done);reject(Error('VIDEO_DECODE_FAILED'));};v.addEventListener(event,done,{once:true});v.addEventListener('error',bad,{once:true});});
  await wait('loadedmetadata');let duration=v.duration;
  if(!Number.isFinite(duration)){v.currentTime=1e10;await wait('seeked');duration=v.duration;}
  if(v.readyState<2)await wait('loadeddata');
  return{duration,width:v.videoWidth,height:v.videoHeight};
 },{base64:source.toString('base64'),mediaType}),30000);
 if(!Number.isFinite(info.duration)||info.duration<=0||info.duration>60||![info.width,info.height].every(v=>Number.isSafeInteger(v)&&v>=1&&v<=4096))throw Error('VIDEO_FORMAT_UNSUPPORTED');
 const count=Math.floor((info.duration+1e-7)*30);if(count<1||count>1800)throw Error('VIDEO_DURATION_UNSUPPORTED');
 const frames=[],packs=[],parts=[];let size=0,total=0,poster;
 const flush=()=>{if(size){packs.push(Buffer.concat(parts,size));parts.length=0;size=0;}};
 for(let index=0;index<count;index++){
  const result=await bounded(page.evaluate(async({index})=>{
   const v=document.querySelector('video'),canvas=document.querySelector('canvas'),time=index/30;
   if(Math.abs(v.currentTime-time)>1e-7){await new Promise((resolve,reject)=>{const done=()=>{v.removeEventListener('error',bad);resolve();},bad=()=>{v.removeEventListener('seeked',done);reject(Error('VIDEO_SEEK_FAILED'));};v.addEventListener('seeked',done,{once:true});v.addEventListener('error',bad,{once:true});v.currentTime=time;});}
   if(Math.abs(v.currentTime-time)>.001||v.readyState<2)throw Error('VIDEO_SEEK_FAILED');
   canvas.width=v.videoWidth;canvas.height=v.videoHeight;const ctx=canvas.getContext('2d');if(!ctx)throw Error('VIDEO_CANVAS_UNAVAILABLE');ctx.drawImage(v,0,0);
   const webp=canvas.toDataURL('image/webp',1),poster=index===0?canvas.toDataURL('image/png'):null;
   if(!webp.startsWith('data:image/webp;base64,')||poster&&!poster.startsWith('data:image/png;base64,'))throw Error('VIDEO_FRAME_ENCODING_UNAVAILABLE');
   return{webp:webp.slice('data:image/webp;base64,'.length),poster:poster?.slice('data:image/png;base64,'.length)};
  },{index}));
  const image=Buffer.from(result.webp,'base64'),header=imageHeader(image);if(header.mediaType!=='image/webp'||header.width!==info.width||header.height!==info.height||image.length>maxPack)throw Error('VIDEO_FRAME_ENCODING_INVALID');
  if(index===0){poster=Buffer.from(result.poster,'base64');const p=imageHeader(poster);if(p.width!==info.width||p.height!==info.height||poster.length>1<<20)throw Error('VIDEO_POSTER_INVALID');}
  if(size+image.length>maxPack)flush();frames.push({index,pts:index/30,duration:1/30,pack:packs.length,offset:size,byteLength:image.length});parts.push(image);size+=image.length;total+=image.length;if(total>maxTotal)throw Error('VIDEO_FRAME_BUDGET_EXCEEDED');
 }
 flush();const manifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',source:{...blob(source),mediaType},browserVersion:version,width:info.width,height:info.height,poster:blob(poster),packs:packs.map(blob),frames};
 const raw=Buffer.from(canonical(manifest));parseVideoFrameManifest(raw,sha256Bytes(raw));return{manifest,raw,poster,packs};
}
export async function captureApprovedLocalVideo({sourceDir,outputDir,card,entries}){
 const source=realpathSync(sourceDir),artifacts=realpathSync('artifacts'),output=resolve(outputDir);
 if(!within(artifacts,output)||existsSync(output))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');let parent=dirname(output);while(!existsSync(parent)&&parent!==dirname(parent))parent=dirname(parent);
 const parentReal=realpathSync(parent);if(parentReal!==artifacts&&!within(artifacts,parentReal))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 if(!Array.isArray(entries)||!entries.length||entries.length>12||new Set(entries.map(item=>item.id)).size!==entries.length)throw Error('VIDEO_SELECTION_INVALID');
 const accepted=entries.map(entry=>{
  if(!/^[a-z0-9-]{4,80}$/.test(entry.id??'')||typeof entry.sourceFile!=='string'||!entry.sourceFile||typeof entry.description!=='string'||!entry.description.trim())throw Error('VIDEO_SELECTION_INVALID');
  const mediaType=kindFor(entry.sourceFile);if(!mediaType)throw Error('VIDEO_SOURCE_FORMAT_INVALID');
  const asset={id:entry.id,topicId:card.topicId,sourceUrl:entry.sourceUrl,approvalRef:entry.approvalRef,derivation:{kind:'approved_video_frame_pack',sourceFile:entry.sourceFile,sourceMediaType:mediaType,sourceSha256:card.materialApprovals?.[entry.id]?.sha256}};approved(card,asset);
  const path=resolve(source,entry.sourceFile);if(!within(source,path)||relative(source,path).split(sep).join('/')!==entry.sourceFile||!within(source,realpathSync(path))||lstatSync(path).isSymbolicLink()||!statSync(path).isFile())throw Error('LOCAL_MATERIAL_PATH_INVALID');
  if(statSync(path).size>maxSource)throw Error('VIDEO_SOURCE_SIZE_INVALID');return{entry,asset,path};
 });
 const inputs=accepted.map(item=>{const bytes=readFileSync(item.path);checkBytes(card,item.asset,bytes);return{...item,bytes};});
 return materializeVideo(output,artifacts,inputs);
}
async function materializeVideo(output,artifacts,inputs){
 let runner;const collected=[];let totalPackBytes=0;
 try{runner=await openBrowser();for(const input of inputs){const out=await extractVideo(runner,input.bytes,input.asset.derivation.sourceMediaType);
  totalPackBytes+=out.packs.reduce((sum,pack)=>sum+pack.length,0);if(totalPackBytes>maxTotal)throw Error('VIDEO_FRAME_BUDGET_EXCEEDED');
  const ext=input.asset.derivation.sourceMediaType==='video/mp4'?'mp4':'webm';const derivation={...input.asset.derivation,originalFile:input.entry.id+'.source.'+ext,manifestFile:input.entry.id+'.video.json',packFiles:out.packs.map((_,i)=>input.entry.id+'.pack-'+i+'.bin'),browserVersion:runner.version};
  collected.push({source:input.bytes,...out,asset:{...input.asset,derivation,file:input.entry.id+'.png',width:out.manifest.width,height:out.manifest.height,mediaType:'image/png',description:input.entry.description,review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false}});
 }}finally{await runner?.browser.close();}
 mkdirSync(output,{recursive:true});if(!within(artifacts,realpathSync(output)))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 for(const item of collected){writeFileSync(join(output,item.asset.derivation.originalFile),item.source,{flag:'wx'});writeFileSync(join(output,item.asset.file),item.poster,{flag:'wx'});writeFileSync(join(output,item.asset.derivation.manifestFile),item.raw,{flag:'wx'});
  for(const [i,pack]of item.packs.entries())writeFileSync(join(output,item.asset.derivation.packFiles[i]),pack,{flag:'wx'});}
 const result={scope:'internal_eval_only',publicUseCleared:false,assets:collected.map(item=>item.asset)};writeFileSync(join(output,'selected.json'),canonical(result)+'\n',{flag:'wx'});return result;
}
export async function captureApprovedWebVideo({outputDir,card,entries,download=downloadApprovedImage}){
 const artifacts=realpathSync('artifacts'),output=resolve(outputDir);if(!within(artifacts,output)||existsSync(output))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 let parent=dirname(output);while(!existsSync(parent)&&parent!==dirname(parent))parent=dirname(parent);const parentReal=realpathSync(parent);if(parentReal!==artifacts&&!within(artifacts,parentReal))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 if(!Array.isArray(entries)||!entries.length||entries.length>12||new Set(entries.map(item=>item.id)).size!==entries.length)throw Error('VIDEO_SELECTION_INVALID');
 const accepted=entries.map(entry=>{
  if(!/^[a-z0-9-]{4,80}$/.test(entry.id??'')||typeof entry.description!=='string'||!entry.description.trim())throw Error('VIDEO_SELECTION_INVALID');
  approvedWebUrl(entry.sourceUrl);const url=approvedWebUrl(entry.videoUrl),mediaType=kindFor(url.pathname);if(!mediaType)throw Error('VIDEO_SOURCE_FORMAT_INVALID');
  const asset={id:entry.id,topicId:card.topicId,sourceUrl:entry.sourceUrl,videoUrl:entry.videoUrl,approvalRef:entry.approvalRef,
   derivation:{kind:'approved_video_frame_pack',sourceOrigin:'web',videoUrl:entry.videoUrl,sourceMediaType:mediaType,sourceSha256:card.materialApprovals?.[entry.id]?.sha256}};
  approved(card,asset);return{entry,asset};
 });
 const inputs=[];for(const item of accepted){const bytes=Buffer.from(await download(item.entry.videoUrl,{accept:'video/mp4,video/webm',maxBytes:maxSource,timeoutMs:60000}));checkBytes(card,item.asset,bytes);inputs.push({...item,bytes});}
 return materializeVideo(output,artifacts,inputs);
}

/** Before any remote operation, reproduce every approved video's poster and complete frame set. */
export async function verifyVideoSelections(directory,selected,topics){
 const assets=(selected.assets??[]).filter(asset=>asset.derivation?.kind==='approved_video_frame_pack');if(!assets.length)return new Map();
 if(selected.scope!=='internal_eval_only'||selected.publicUseCleared!==false||topics.factConfirmation?.confirmedBy!=='owner')throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 const root=realpathSync(directory),artifacts=realpathSync('artifacts');if(!within(artifacts,root))throw Error('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
 const paths=assets.map(asset=>{
  if(!/^[a-z0-9-]{4,80}$/.test(asset.id??'')||asset.review!=='approved_for_internal_eval_by_codex'||!asset.reviewedAt)throw Error('MATERIAL_REVIEW_REQUIRED');
  const topic=topics.topics.find(item=>item.id===asset.topicId&&item.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
  const card=parseCanonicalJson(readFileSync(topic.factCard));if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');approved(card,asset);
  const ext=asset.derivation.sourceMediaType==='video/mp4'?'mp4':'webm';
  if(asset.file!==asset.id+'.png'||asset.derivation.originalFile!==asset.id+'.source.'+ext||asset.derivation.manifestFile!==asset.id+'.video.json'
   ||!Array.isArray(asset.derivation.packFiles)||!asset.derivation.packFiles.length||asset.derivation.packFiles.length>180
   ||asset.derivation.packFiles.some((file,i)=>file!==asset.id+'.pack-'+i+'.bin'))throw Error('VIDEO_SOURCE_INVALID');
  const all=[asset.file,asset.derivation.originalFile,asset.derivation.manifestFile,...asset.derivation.packFiles].map(file=>join(root,file));
  for(const path of all)if(lstatSync(path).isSymbolicLink()||!within(root,realpathSync(path))||!statSync(path).isFile())throw Error('VIDEO_SOURCE_INVALID');
  if(statSync(all[1]).size>maxSource||statSync(all[0]).size>1<<20||statSync(all[2]).size>1<<20||all.slice(3).some(path=>statSync(path).size>12<<20))throw Error('VIDEO_SOURCE_SIZE_INVALID');
  const source=readFileSync(all[1]);checkBytes(card,asset,source);const manifestBytes=readFileSync(all[2]),manifest=parseVideoFrameManifest(manifestBytes,sha256Bytes(manifestBytes));
  const poster=readFileSync(all[0]),packs=all.slice(3).map(path=>readFileSync(path));
  if(manifest.source.sha256!==asset.derivation.sourceSha256||manifest.source.byteLength!==source.length||manifest.source.mediaType!==asset.derivation.sourceMediaType
   ||manifest.browserVersion!==asset.derivation.browserVersion||manifest.width!==asset.width||manifest.height!==asset.height
   ||manifest.poster.sha256!==sha256Bytes(poster)||manifest.poster.byteLength!==poster.length||packs.length!==manifest.packs.length
   ||packs.some((pack,i)=>pack.length!==manifest.packs[i].byteLength||sha256Bytes(pack)!==manifest.packs[i].sha256))throw Error('VIDEO_DERIVATION_MISMATCH');
  return{asset,source,manifestBytes,poster,packs};
 });
 if(paths.reduce((sum,item)=>sum+item.packs.reduce((n,pack)=>n+pack.length,0),0)>maxTotal)throw Error('VIDEO_FRAME_BUDGET_EXCEEDED');
 let runner;const verified=new Map();
 try{runner=await openBrowser();for(const {asset,source,manifestBytes,poster,packs}of paths){
  if(asset.derivation.browserVersion!==runner.version)throw Error('VIDEO_RENDERER_CHANGED');
  const result=await extractVideo(runner,source,asset.derivation.sourceMediaType);
  if(!result.raw.equals(manifestBytes)||!result.poster.equals(poster)||result.packs.length!==packs.length||result.packs.some((pack,index)=>!pack.equals(packs[index])))throw Error('VIDEO_DERIVATION_MISMATCH');
  verified.set(asset.id,{source,manifest:result.manifest,manifestBytes,poster,packs});
 }}finally{await runner?.browser.close();}return verified;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [outputDir,topicId,sourceArg,manifestFile,...extra]=process.argv.slice(2),web=sourceArg==='--web';if(!outputDir||!topicId||!sourceArg||!manifestFile||extra.length)throw Error('VIDEO_CAPTURE_ARGUMENTS_REQUIRED');
 const root=realpathSync('artifacts'),manifestPath=realpathSync(manifestFile);if(!within(root,manifestPath))throw Error('PRIVATE_MANIFEST_REQUIRED');
 const topics=parseCanonicalJson(readFileSync('research/evals/topics.json')),topic=topics.topics.find(item=>item.id===topicId&&item.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=parseCanonicalJson(readFileSync(topic.factCard)),manifest=parseCanonicalJson(readFileSync(manifestPath));
 const result=web?await captureApprovedWebVideo({outputDir,card,entries:manifest.files}):await captureApprovedLocalVideo({sourceDir:sourceArg,outputDir,card,entries:manifest.files});console.log(canonical({scope:result.scope,assets:result.assets.length,review:'pending_visual_selection'}));
}
