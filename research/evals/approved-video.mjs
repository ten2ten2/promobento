// Internal approved video intake. Browser is offline; the original is retained,
// and generated poster/30 fps WebP frame packs are reproducible and identity-bound.
import {chromium} from 'playwright-core';
import {lstatSync,mkdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,join,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {parseVideoFrameManifest} from '@promobento/contracts/video-frames';
import {materialApproval} from './material-approval.mjs';
import {imageHeader} from './image-header.mjs';
import {approvedWebUrl,downloadApprovedImage} from './capture-approved-web-images.mjs';
import {evaluationChromeExecutable} from './chrome.mjs';
import {privateExisting,privateNewDirectory,writePrivateFile} from './private-path.mjs';
import {readReviewedMaterial} from './prepare-material-selection.mjs';
import {readBoundedApprovedFile} from './read-local-approved.mjs';

const within=(root,path)=>path.startsWith(root+sep),maxSource=50<<20,maxPack=8<<20,maxTotal=175<<20;
const kindFor=file=>({'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.gif':'image/gif','.png':'image/png','.apng':'image/png','.webp':'image/webp','.avif':'image/avif'})[extname(file).toLowerCase()];
const extension=type=>({'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','image/gif':'gif','image/png':'png','image/webp':'webp','image/avif':'avif'})[type];
const validCard=card=>card.status==='confirmed_for_s1_eval'&&card.confirmation?.confirmedBy==='owner'&&card.confirmation.scope==='s1-first-internal-evaluation'&&card.rights?.scope==='internal_eval_only'&&card.rights.publicUseCleared===false;
const isAnimatedSource=type=>['image/gif','image/png','image/webp','image/avif'].includes(type);
const blob=bytes=>({sha256:sha256Bytes(bytes),byteLength:bytes.length});
function approved(card,asset){
 const decision=materialApproval(card,asset),derived=asset.derivation;
 const web=derived?.sourceOrigin==='web';
 const webPathType=web?kindFor(approvedWebUrl(asset.videoUrl).pathname):undefined;
 if(!decision.explicit||derived?.kind!=='approved_video_frame_pack'||decision.explicit.sourceUrl!==asset.sourceUrl
  ||!/^[a-f0-9]{64}$/.test(decision.explicit.sha256??'')||derived.sourceSha256!==decision.explicit.sha256
  ||(web?(decision.source.kind==='local_project_media'||decision.explicit.videoUrl!==asset.videoUrl||derived.videoUrl!==asset.videoUrl
     ||!extension(derived.sourceMediaType)||(webPathType?webPathType!==derived.sourceMediaType:decision.explicit.sourceMediaType!==derived.sourceMediaType)
     ||decision.explicit.sourceMediaType!==undefined&&decision.explicit.sourceMediaType!==derived.sourceMediaType)
   :(decision.source.kind!=='local_project_media'||decision.explicit.sourceFile!==derived.sourceFile||kindFor(derived.sourceFile)!==derived.sourceMediaType)))throw Error('VIDEO_APPROVAL_IDENTITY_REQUIRED');
 return decision;
}
function checkBytes(card,asset,bytes){const decision=approved(card,asset);if(!bytes.length||bytes.length>maxSource||sha256Bytes(bytes)!==decision.explicit.sha256)throw Error('VIDEO_SOURCE_IDENTITY_MISMATCH');}
export function assertVideoSourceHeader(bytes,mediaType){
 const box=bytes.toString('ascii',4,8);
 if(mediaType==='image/png'){
  if(bytes.length<33||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR'
   ||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)>4096||bytes.readUInt32BE(20)>4096)throw Error('VIDEO_SOURCE_FORMAT_INVALID');return;
 }
 if(mediaType==='image/webp'){
  if(bytes.length<30||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)+8!==bytes.length||bytes.toString('ascii',8,16)!=='WEBPVP8X'
   ||bytes.readUInt32LE(16)!==10||!(bytes[20]&2)||1+bytes.readUIntLE(24,3)>4096||1+bytes.readUIntLE(27,3)>4096)throw Error('VIDEO_SOURCE_FORMAT_INVALID');return;
 }
 if(mediaType==='image/avif'){
  if(bytes.length<16||box!=='ftyp')throw Error('VIDEO_SOURCE_FORMAT_INVALID');
  const size=bytes.readUInt32BE(0);if(size<16||size>bytes.length||(size-16)%4)throw Error('VIDEO_SOURCE_FORMAT_INVALID');
  const brands=[bytes.toString('ascii',8,12)];for(let offset=16;offset<size;offset+=4)brands.push(bytes.toString('ascii',offset,offset+4));
  if(!brands.includes('avis'))throw Error('VIDEO_SOURCE_FORMAT_INVALID');return;
 }
 if(mediaType==='video/mp4'&&(bytes.length<12||box!=='ftyp')
  ||mediaType==='video/quicktime'&&(bytes.length<12||!['ftyp','moov','mdat','free','wide'].includes(box))
  ||mediaType==='video/webm'&&(bytes.length<4||bytes.subarray(0,4).toString('hex')!=='1a45dfa3')
  ||mediaType==='image/gif'&&(bytes.length<14||!['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6))||bytes.readUInt16LE(6)<1||bytes.readUInt16LE(8)<1||bytes.readUInt16LE(6)>4096||bytes.readUInt16LE(8)>4096)||!extension(mediaType))throw Error('VIDEO_SOURCE_FORMAT_INVALID');
}
async function bounded(work,ms=15000){let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('VIDEO_DECODE_TIMEOUT')),ms);})]);}finally{clearTimeout(timer);}}
async function openBrowser(){
 const browser=await chromium.launch({executablePath:evaluationChromeExecutable,headless:true,chromiumSandbox:true,timeout:30000});
 let context;try{context=await browser.newContext({viewport:{width:16,height:16},deviceScaleFactor:1,acceptDownloads:false});await context.route('**/*',route=>route.abort('blockedbyclient'));
  const page=await context.newPage();
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob:"><video muted playsinline preload="auto"></video><canvas></canvas>`);return{browser,page,version:browser.version(),async close(){try{await context.close();}finally{await browser.close();}}};
 }catch(error){try{await context?.close();}finally{await browser.close();}throw error;}
}
async function extractVideo({page,version},source,mediaType){
 assertVideoSourceHeader(source,mediaType);
 if(isAnimatedSource(mediaType)){
  // WebCodecs is secure-context-only. This origin is fulfilled entirely by
  // Playwright; the context-wide route still blocks every real network request.
  const origin='http://127.0.0.1/promobento-animation-decoder';
  await page.route(origin,route=>route.fulfill({status:200,contentType:'text/html',body:`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src blob:"><video muted playsinline preload="auto"></video><canvas></canvas>`}));
  try{await page.goto(origin,{waitUntil:'load',timeout:15000});}finally{await page.unroute(origin);}
 }
 const info=await bounded(page.evaluate(async({base64,mediaType})=>{
  const data=atob(base64),buffer=new Uint8Array(data.length);for(let i=0;i<data.length;i++)buffer[i]=data.charCodeAt(i);
  if(window.__pbAnimatedDecoder){window.__pbAnimatedDecoder.close();window.__pbAnimatedDecoder=null;}
  if(['image/gif','image/png','image/webp','image/avif'].includes(mediaType)){
   if(typeof ImageDecoder!=='function')throw Error(isSecureContext?'ANIMATED_DECODER_UNAVAILABLE':'ANIMATED_DECODER_INSECURE_CONTEXT');
   if(!await ImageDecoder.isTypeSupported(mediaType))throw Error('ANIMATED_SOURCE_UNSUPPORTED');
   const decoder=new ImageDecoder({data:buffer,type:mediaType,preferAnimation:true});await decoder.completed;await decoder.tracks.ready;const track=decoder.tracks.selectedTrack;
   if(!track?.animated||track.frameCount<2||track.frameCount>1800){decoder.close();throw Error('ANIMATED_FRAME_COUNT_UNSUPPORTED');}
   const ends=[];let duration=0,width=0,height=0;
   try{for(let index=0;index<track.frameCount;index++){
    const result=await decoder.decode({frameIndex:index,completeFramesOnly:true}),frame=result.image;
    try{if(!result.complete||!Number.isSafeInteger(frame.duration)||frame.duration<=0)throw Error('ANIMATED_FRAME_DURATION_INVALID');
     if(index===0){width=frame.displayWidth;height=frame.displayHeight;if(width<1||height<1||width>4096||height>4096)throw Error('VIDEO_FORMAT_UNSUPPORTED');}
     if(frame.displayWidth!==width||frame.displayHeight!==height)throw Error('ANIMATED_FRAME_DIMENSIONS_INVALID');
     duration+=frame.duration;if(duration>60000000)throw Error('VIDEO_DURATION_UNSUPPORTED');ends.push(duration);
    }finally{frame.close();}
   }}catch(error){decoder.close();throw error;}
   window.__pbAnimatedDecoder=decoder;window.__pbAnimatedEnds=ends;return{duration:duration/1000000,width,height};
  }
  // Chromium demuxes compatible QuickTime containers through its MP4 media
  // path; the manifest and retained original still say video/quicktime.
  const v=document.querySelector('video');if(v.src.startsWith('blob:'))URL.revokeObjectURL(v.src);v.src=URL.createObjectURL(new Blob([buffer],{type:mediaType==='video/quicktime'?'video/mp4':mediaType}));
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
  const result=await bounded(page.evaluate(async({index,mediaType,width,height})=>{
   // Sample the center of each output frame interval. Exact start-boundary
   // seeks can pick either adjacent source frame after a fresh decoder launch.
   const v=document.querySelector('video'),canvas=document.querySelector('canvas'),time=(index+0.5)/30;
   canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');if(!ctx)throw Error('VIDEO_CANVAS_UNAVAILABLE');
   if(['image/gif','image/png','image/webp','image/avif'].includes(mediaType)){
    const frameIndex=window.__pbAnimatedEnds.findIndex(end=>time*1000000<end);if(frameIndex<0)throw Error('VIDEO_SEEK_FAILED');
    const decoded=await window.__pbAnimatedDecoder.decode({frameIndex,completeFramesOnly:true});try{if(!decoded.complete)throw Error('VIDEO_DECODE_FAILED');ctx.drawImage(decoded.image,0,0);}finally{decoded.image.close();}
   }else{
    if(Math.abs(v.currentTime-time)>1e-7){await new Promise((resolve,reject)=>{const done=()=>{v.removeEventListener('error',bad);resolve();},bad=()=>{v.removeEventListener('seeked',done);reject(Error('VIDEO_SEEK_FAILED'));};v.addEventListener('seeked',done,{once:true});v.addEventListener('error',bad,{once:true});v.currentTime=time;});}
    if(Math.abs(v.currentTime-time)>.001||v.readyState<2)throw Error('VIDEO_SEEK_FAILED');ctx.drawImage(v,0,0);
   }
   const webp=canvas.toDataURL('image/webp',1),poster=index===0?canvas.toDataURL('image/png'):null;
   if(!webp.startsWith('data:image/webp;base64,')||poster&&!poster.startsWith('data:image/png;base64,'))throw Error('VIDEO_FRAME_ENCODING_UNAVAILABLE');
   return{webp:webp.slice('data:image/webp;base64,'.length),poster:poster?.slice('data:image/png;base64,'.length)};
  },{index,mediaType,width:info.width,height:info.height}));
  const image=Buffer.from(result.webp,'base64'),header=imageHeader(image);if(header.mediaType!=='image/webp'||header.width!==info.width||header.height!==info.height||image.length>maxPack)throw Error('VIDEO_FRAME_ENCODING_INVALID');
  if(index===0){poster=Buffer.from(result.poster,'base64');const p=imageHeader(poster);if(p.width!==info.width||p.height!==info.height||poster.length>1<<20)throw Error('VIDEO_POSTER_INVALID');}
  if(size+image.length>maxPack)flush();frames.push({index,pts:index/30,duration:1/30,pack:packs.length,offset:size,byteLength:image.length});parts.push(image);size+=image.length;total+=image.length;if(total>maxTotal)throw Error('VIDEO_FRAME_BUDGET_EXCEEDED');
 }
 flush();const manifest={schemaVersion:'3.0.0',kind:'video_frame_manifest',source:{...blob(source),mediaType},browserVersion:version,width:info.width,height:info.height,poster:blob(poster),packs:packs.map(blob),frames};
 const raw=Buffer.from(canonical(manifest));parseVideoFrameManifest(raw,sha256Bytes(raw));return{manifest,raw,poster,packs};
}
export async function captureApprovedLocalVideo({sourceDir,outputDir,card,entries}){
 const source=realpathSync(sourceDir),output=privateNewDirectory(outputDir,'NEW_PRIVATE_OUTPUT_REQUIRED');
 if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 if(!Array.isArray(entries)||!entries.length||entries.length>12||new Set(entries.map(item=>item.id)).size!==entries.length)throw Error('VIDEO_SELECTION_INVALID');
 const accepted=entries.map(entry=>{
  if(!/^[a-z0-9-]{4,80}$/.test(entry.id??'')||typeof entry.sourceFile!=='string'||!entry.sourceFile||typeof entry.description!=='string'||!entry.description.trim())throw Error('VIDEO_SELECTION_INVALID');
  const mediaType=kindFor(entry.sourceFile);if(!mediaType)throw Error('VIDEO_SOURCE_FORMAT_INVALID');
  const asset={id:entry.id,topicId:card.topicId,sourceUrl:entry.sourceUrl,approvalRef:entry.approvalRef,derivation:{kind:'approved_video_frame_pack',sourceFile:entry.sourceFile,sourceMediaType:mediaType,sourceSha256:card.materialApprovals?.[entry.id]?.sha256}};approved(card,asset);
  const path=resolve(source,entry.sourceFile);if(!within(source,path)||relative(source,path).split(sep).join('/')!==entry.sourceFile||!within(source,realpathSync(path))||lstatSync(path).isSymbolicLink()||!statSync(path).isFile())throw Error('LOCAL_MATERIAL_PATH_INVALID');
  if(statSync(path).size>maxSource)throw Error('VIDEO_SOURCE_SIZE_INVALID');return{entry,asset,path};
 });
 const inputs=accepted.map(item=>{const bytes=readBoundedApprovedFile(item.path,maxSource,'VIDEO_SOURCE_SIZE_INVALID');checkBytes(card,item.asset,bytes);return{...item,bytes};});
 return materializeVideo(output,inputs);
}
async function materializeVideo(output,inputs){
 let runner;const collected=[];let totalPackBytes=0;
 try{runner=await openBrowser();for(const input of inputs){const out=await extractVideo(runner,input.bytes,input.asset.derivation.sourceMediaType);
  totalPackBytes+=out.packs.reduce((sum,pack)=>sum+pack.length,0);if(totalPackBytes>maxTotal)throw Error('VIDEO_FRAME_BUDGET_EXCEEDED');
  const ext=extension(input.asset.derivation.sourceMediaType);if(!ext)throw Error('VIDEO_SOURCE_FORMAT_INVALID');const derivation={...input.asset.derivation,originalFile:input.entry.id+'.source.'+ext,manifestFile:input.entry.id+'.video.json',packFiles:out.packs.map((_,i)=>input.entry.id+'.pack-'+i+'.bin'),browserVersion:runner.version};
  collected.push({source:input.bytes,...out,asset:{...input.asset,derivation,file:input.entry.id+'.png',width:out.manifest.width,height:out.manifest.height,mediaType:'image/png',description:input.entry.description,review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false}});
 }}finally{await runner?.close();}
 mkdirSync(output,{recursive:true});privateExisting(output,'directory','NEW_PRIVATE_OUTPUT_REQUIRED');
 for(const item of collected){writePrivateFile(join(output,item.asset.derivation.originalFile),item.source,{exclusive:true});writePrivateFile(join(output,item.asset.file),item.poster,{exclusive:true});writePrivateFile(join(output,item.asset.derivation.manifestFile),item.raw,{exclusive:true});
  for(const [i,pack]of item.packs.entries())writePrivateFile(join(output,item.asset.derivation.packFiles[i]),pack,{exclusive:true});}
 const result={scope:'internal_eval_only',publicUseCleared:false,assets:collected.map(item=>item.asset)};writePrivateFile(join(output,'selected.json'),canonical(result)+'\n',{exclusive:true});return result;
}
export async function captureApprovedWebVideo({outputDir,card,entries,download=downloadApprovedImage}){
 const output=privateNewDirectory(outputDir,'NEW_PRIVATE_OUTPUT_REQUIRED');
 if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 if(!Array.isArray(entries)||!entries.length||entries.length>12||new Set(entries.map(item=>item.id)).size!==entries.length)throw Error('VIDEO_SELECTION_INVALID');
 const accepted=entries.map(entry=>{
  if(!/^[a-z0-9-]{4,80}$/.test(entry.id??'')||typeof entry.description!=='string'||!entry.description.trim())throw Error('VIDEO_SELECTION_INVALID');
  approvedWebUrl(entry.sourceUrl);const url=approvedWebUrl(entry.videoUrl),mediaType=kindFor(url.pathname)??entry.sourceMediaType;
  if(!extension(mediaType)||entry.sourceMediaType!==undefined&&entry.sourceMediaType!==mediaType)throw Error('VIDEO_SOURCE_FORMAT_INVALID');
  const asset={id:entry.id,topicId:card.topicId,sourceUrl:entry.sourceUrl,videoUrl:entry.videoUrl,approvalRef:entry.approvalRef,
   derivation:{kind:'approved_video_frame_pack',sourceOrigin:'web',videoUrl:entry.videoUrl,sourceMediaType:mediaType,sourceSha256:card.materialApprovals?.[entry.id]?.sha256}};
  approved(card,asset);return{entry,asset};
 });
 const inputs=[];for(const item of accepted){const bytes=Buffer.from(await download(item.entry.videoUrl,{accept:'video/mp4,video/quicktime,video/webm,image/gif,image/png,image/webp,image/avif',maxBytes:maxSource,timeoutMs:60000}));checkBytes(card,item.asset,bytes);inputs.push({...item,bytes});}
 return materializeVideo(output,inputs);
}

/** Before any remote operation, reproduce every approved video's poster and complete frame set. */
export async function verifyVideoSelections(directory,selected,topics){
 const assets=(selected.assets??[]).filter(asset=>asset.derivation?.kind==='approved_video_frame_pack');if(!assets.length)return new Map();
 if(selected.scope!=='internal_eval_only'||selected.publicUseCleared!==false||topics.factConfirmation?.confirmedBy!=='owner')throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 const root=privateExisting(directory);let packBytes=0;
 const paths=assets.map(asset=>{
  if(!/^[a-z0-9-]{4,80}$/.test(asset.id??'')||asset.review!=='approved_for_internal_eval_by_codex'||!asset.reviewedAt)throw Error('MATERIAL_REVIEW_REQUIRED');
  const topic=topics.topics.find(item=>item.id===asset.topicId&&item.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
  const card=parseCanonicalJson(readFileSync(topic.factCard));if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');approved(card,asset);
  const ext=extension(asset.derivation.sourceMediaType);if(!ext)throw Error('VIDEO_SOURCE_INVALID');
  if(asset.file!==asset.id+'.png'||asset.derivation.originalFile!==asset.id+'.source.'+ext||asset.derivation.manifestFile!==asset.id+'.video.json'
   ||!Array.isArray(asset.derivation.packFiles)||!asset.derivation.packFiles.length||asset.derivation.packFiles.length>180
   ||asset.derivation.packFiles.some((file,i)=>file!==asset.id+'.pack-'+i+'.bin'))throw Error('VIDEO_SOURCE_INVALID');
  const source=readReviewedMaterial(root,asset.derivation.originalFile,maxSource);checkBytes(card,asset,source);
  const manifestBytes=readReviewedMaterial(root,asset.derivation.manifestFile,1<<20),manifest=parseVideoFrameManifest(manifestBytes,sha256Bytes(manifestBytes));
  const poster=readReviewedMaterial(root,asset.file,1<<20),packs=asset.derivation.packFiles.map(name=>{
   const bytes=readReviewedMaterial(root,name,12<<20);packBytes+=bytes.length;
   if(packBytes>maxTotal)throw Error('VIDEO_FRAME_BUDGET_EXCEEDED');return bytes;
  });
  if(manifest.source.sha256!==asset.derivation.sourceSha256||manifest.source.byteLength!==source.length||manifest.source.mediaType!==asset.derivation.sourceMediaType
   ||manifest.browserVersion!==asset.derivation.browserVersion||manifest.width!==asset.width||manifest.height!==asset.height
   ||manifest.poster.sha256!==sha256Bytes(poster)||manifest.poster.byteLength!==poster.length||packs.length!==manifest.packs.length
   ||packs.some((pack,i)=>pack.length!==manifest.packs[i].byteLength||sha256Bytes(pack)!==manifest.packs[i].sha256))throw Error('VIDEO_DERIVATION_MISMATCH');
  return{asset,source,manifestBytes,poster,packs};
 });
 let runner;const verified=new Map();
 try{runner=await openBrowser();for(const {asset,source,manifestBytes,poster,packs}of paths){
  if(asset.derivation.browserVersion!==runner.version)throw Error('VIDEO_RENDERER_CHANGED');
  const result=await extractVideo(runner,source,asset.derivation.sourceMediaType);
  if(!result.raw.equals(manifestBytes)||!result.poster.equals(poster)||result.packs.length!==packs.length||result.packs.some((pack,index)=>!pack.equals(packs[index])))throw Error('VIDEO_DERIVATION_MISMATCH');
  verified.set(asset.id,{source,manifest:result.manifest,manifestBytes,poster,packs});
 }}finally{await runner?.close();}return verified;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [outputDir,topicId,sourceArg,manifestFile,...extra]=process.argv.slice(2),web=sourceArg==='--web';if(!outputDir||!topicId||!sourceArg||!manifestFile||extra.length)throw Error('VIDEO_CAPTURE_ARGUMENTS_REQUIRED');
 const manifestPath=privateExisting(manifestFile,'file','PRIVATE_MANIFEST_REQUIRED');
 const topics=parseCanonicalJson(readFileSync('research/evals/topics.json')),topic=topics.topics.find(item=>item.id===topicId&&item.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=parseCanonicalJson(readFileSync(topic.factCard)),manifest=parseCanonicalJson(readFileSync(manifestPath));
 const result=web?await captureApprovedWebVideo({outputDir,card,entries:manifest.files}):await captureApprovedLocalVideo({sourceDir:sourceArg,outputDir,card,entries:manifest.files});console.log(canonical({scope:result.scope,assets:result.assets.length,review:'pending_visual_selection'}));
}
