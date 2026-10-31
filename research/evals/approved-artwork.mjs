// Rasterize explicitly approved local SVG/ICO into inspectable PNGs. The source bytes,
// browser version and reproducible output stay bound through subsequent ingestion.
import {chromium} from 'playwright-core';
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {resolve,relative,dirname,join,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {materialApproval} from './material-approval.mjs';
import {imageHeader} from './image-header.mjs';

const within=(root,path)=>path.startsWith(root+sep),limit=1<<20;
const executablePath='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const kindFor=path=>({'.svg':'image/svg+xml','.ico':'image/x-icon'})[extname(path).toLowerCase()];
export function artworkSourceObjectName(asset){
 if(!/^[a-z0-9-]{4,80}$/.test(asset.id??'')||!['image/svg+xml','image/x-icon'].includes(asset.derivation?.sourceMediaType))throw Error('ARTWORK_SOURCE_INVALID');
 return asset.id+'-source.'+(asset.derivation.sourceMediaType==='image/svg+xml'?'svg':'ico');
}
function validCard(card){return card.status==='confirmed_for_s1_eval'&&card.confirmation?.confirmedBy==='owner'&&card.confirmation.scope==='s1-first-internal-evaluation'&&card.rights?.scope==='internal_eval_only'&&card.rights.publicUseCleared===false;}
function checkApproval(card,asset){
 const decision=materialApproval(card,asset),original=asset.derivation;
 if(!decision.explicit||decision.source.kind!=='local_project_media'||original?.kind!=='approved_artwork_rasterization'
  ||decision.explicit.sourceFile!==original.sourceFile||decision.explicit.sourceUrl!==asset.sourceUrl
  ||!/^[a-f0-9]{64}$/.test(decision.explicit.sha256??'')||original.sourceSha256!==decision.explicit.sha256
  ||kindFor(original.sourceFile)!==original.sourceMediaType)throw Error('ARTWORK_APPROVAL_IDENTITY_MISMATCH');
 return decision;
}
function checkIdentity(card,asset,sourceBytes){
 const decision=checkApproval(card,asset);if(sha256Bytes(sourceBytes)!==decision.explicit.sha256)throw Error('ARTWORK_APPROVAL_IDENTITY_MISMATCH');return decision;
}
async function openBrowser(){
 const browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true,timeout:30000});
 try{
  const context=await browser.newContext({viewport:{width:4096,height:4096},deviceScaleFactor:1,locale:'en-US',acceptDownloads:false});
  await context.route('**/*',route=>route.abort('blockedbyclient'));const page=await context.newPage();
  await page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;padding:0;background:transparent}img{display:block}</style><img id="art">`);
  return{browser,context,page,version:browser.version()};
 }catch(error){await browser.close();throw error;}
}
async function bounded(work){
 let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('ARTWORK_RENDER_TIMEOUT')),15000);})]);}finally{clearTimeout(timer);}
}
async function renderArtwork({page},bytes,mediaType){
 if(!bytes.length||bytes.length>limit)throw Error('ARTWORK_SIZE_INVALID');
 if(mediaType==='image/svg+xml'){
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('ARTWORK_SVG_INVALID');}
  if(/<!\s*(?:DOCTYPE|ENTITY)/i.test(source))throw Error('ARTWORK_SVG_UNSUPPORTED');
  const valid=await bounded(page.evaluate(text=>{
   const doc=new DOMParser().parseFromString(text,'image/svg+xml'),root=doc.documentElement;
   if(root.localName!=='svg'||root.namespaceURI!=='http://www.w3.org/2000/svg'||doc.querySelector('parsererror'))return false;
   const allowed=new Set(['svg','g','path','circle','ellipse','rect','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath','mask','title','desc']);
   const nodes=[root,...root.querySelectorAll('*')];if(nodes.length>5000)return false;
   for(const node of nodes){
    if(node.namespaceURI!=='http://www.w3.org/2000/svg'||!allowed.has(node.localName))return false;
    for(const attr of node.attributes){const name=attr.localName.toLowerCase(),value=attr.value;
     if(name.startsWith('on')||name==='href'||name==='src'||value.length>200000||/[\\]/.test(value)||/@import|expression\s*\(/i.test(value))return false;
     if(/url\s*\(/i.test(value)&&!(/^(fill|stroke|clip-path|mask)$/.test(name)&&/^url\(\s*#[a-zA-Z_][\w:.-]*\s*\)$/.test(value)))return false;
    }
   }
   return true;
  },source));
  if(!valid)throw Error('ARTWORK_SVG_UNSUPPORTED');
 }
 const dims=await bounded(page.evaluate(async({mediaType,base64})=>{
  const img=document.querySelector('#art');img.src=`data:${mediaType};base64,${base64}`;
  try{await img.decode();}catch{throw Error('ARTWORK_DECODE_FAILED');}
  return{width:img.naturalWidth,height:img.naturalHeight};
 },{mediaType,base64:bytes.toString('base64')}));
 if(![dims.width,dims.height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=4096))throw Error('ARTWORK_DIMENSIONS_INVALID');
 const png=await page.locator('#art').screenshot({type:'png',omitBackground:true,timeout:15000});
 if(png.length>limit)throw Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED');
 const header=imageHeader(png);if(header.width!==dims.width||header.height!==dims.height)throw Error('ARTWORK_DIMENSIONS_INVALID');
 return{png,width:dims.width,height:dims.height};
}
/** All inputs are approved and identity-checked before any image is decoded. */
export async function captureApprovedArtwork({sourceDir,outputDir,card,entries}){
 const source=realpathSync(sourceDir),artifacts=realpathSync('artifacts'),output=resolve(outputDir);
 if(!within(artifacts,output)||existsSync(output))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 let parent=dirname(output);while(!existsSync(parent)&&parent!==dirname(parent))parent=dirname(parent);
 const parentReal=realpathSync(parent);if(parentReal!==artifacts&&!within(artifacts,parentReal))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 if(!Array.isArray(entries)||!entries.length||entries.length>60||new Set(entries.map(item=>item.id)).size!==entries.length)throw Error('ARTWORK_SELECTION_INVALID');
 const accepted=entries.map(entry=>{
  if(!/^[a-z0-9-]{4,80}$/.test(entry.id??'')||typeof entry.sourceFile!=='string'||!entry.sourceFile||typeof entry.description!=='string'||!entry.description.trim())throw Error('ARTWORK_SELECTION_INVALID');
  const mediaType=kindFor(entry.sourceFile);if(!mediaType)throw Error('ARTWORK_KIND_UNSUPPORTED');
  const asset={id:entry.id,topicId:card.topicId,sourceUrl:entry.sourceUrl,approvalRef:entry.approvalRef,
   derivation:{kind:'approved_artwork_rasterization',sourceFile:entry.sourceFile,sourceMediaType:mediaType,sourceSha256:card.materialApprovals?.[entry.id]?.sha256,originalFile:entry.id+(mediaType==='image/svg+xml'?'.source.svg':'.source.ico')}};
  const decision=materialApproval(card,asset);if(!decision.explicit||decision.source.kind!=='local_project_media'||decision.explicit.sourceFile!==entry.sourceFile||decision.explicit.sourceUrl!==entry.sourceUrl||!/^[a-f0-9]{64}$/.test(decision.explicit.sha256??''))throw Error('ARTWORK_APPROVAL_IDENTITY_REQUIRED');
  const path=resolve(source,entry.sourceFile);if(!within(source,path)||relative(source,path).split(sep).join('/')!==entry.sourceFile||!within(source,realpathSync(path))||lstatSync(path).isSymbolicLink()||!statSync(path).isFile())throw Error('LOCAL_MATERIAL_PATH_INVALID');
  if(statSync(path).size>limit)throw Error('ARTWORK_SIZE_INVALID');return{entry,asset,path};
 });
 const inputs=accepted.map(item=>{const bytes=readFileSync(item.path);if(bytes.length>limit)throw Error('ARTWORK_SIZE_INVALID');checkIdentity(card,item.asset,bytes);return{...item,bytes};});
 let runner;const items=[];
 try{runner=await openBrowser();for(const input of inputs){const image=await renderArtwork(runner,input.bytes,input.asset.derivation.sourceMediaType);
  items.push({bytes:input.bytes,png:image.png,asset:{...input.asset,derivation:{...input.asset.derivation,chromeVersion:runner.version},file:input.entry.id+'.png',width:image.width,height:image.height,mediaType:'image/png',description:input.entry.description,review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false}});
 }}finally{await runner?.browser.close();}
 mkdirSync(output,{recursive:true});if(!within(artifacts,realpathSync(output)))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 for(const item of items){writeFileSync(join(output,item.asset.derivation.originalFile),item.bytes,{flag:'wx'});writeFileSync(join(output,item.asset.file),item.png,{flag:'wx'});}
 const result={scope:'internal_eval_only',publicUseCleared:false,assets:items.map(item=>item.asset)};writeFileSync(join(output,'selected.json'),canonical(result)+'\n',{flag:'wx'});return result;
}
/** Independently rebuild artwork previews before any remote side effect; bytes must match. */
export async function verifyArtworkSelections(directory,selected,topics){
 const artwork=(selected.assets??[]).filter(asset=>asset.derivation?.kind==='approved_artwork_rasterization');if(!artwork.length)return new Map();
 if(selected.scope!=='internal_eval_only'||selected.publicUseCleared!==false||topics.factConfirmation?.confirmedBy!=='owner')throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 const root=realpathSync(directory),artifacts=realpathSync('artifacts');if(!within(artifacts,root))throw Error('PRIVATE_ARTIFACT_DIRECTORY_REQUIRED');
 const sources=artwork.map(asset=>{
  if(!/^[a-z0-9-]{4,80}$/.test(asset.id??'')||asset.review!=='approved_for_internal_eval_by_codex'||!asset.reviewedAt)throw Error('MATERIAL_REVIEW_REQUIRED');
  const topic=topics.topics.find(item=>item.id===asset.topicId&&item.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
  const card=parseCanonicalJson(readFileSync(topic.factCard));if(!validCard(card))throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
  checkApproval(card,asset);
  const original=asset.derivation.originalFile,expected=asset.id+(asset.derivation.sourceMediaType==='image/svg+xml'?'.source.svg':'.source.ico');
  if(original!==expected||asset.file!==asset.id+'.png')throw Error('ARTWORK_SOURCE_INVALID');
  const sourcePath=join(root,original),pngPath=join(root,asset.file);
  for(const path of [sourcePath,pngPath])if(lstatSync(path).isSymbolicLink()||!within(root,realpathSync(path))||!statSync(path).isFile())throw Error('ARTWORK_SOURCE_INVALID');
  const bytes=readFileSync(sourcePath);if(bytes.length>limit)throw Error('ARTWORK_SIZE_INVALID');checkIdentity(card,asset,bytes);
  return{asset,bytes,pngPath};
 });
 let runner;const verified=new Map();
 try{runner=await openBrowser();for(const {asset,bytes,pngPath}of sources){
  if(asset.derivation.chromeVersion!==runner.version)throw Error('ARTWORK_RENDERER_CHANGED');
  const result=await renderArtwork(runner,bytes,asset.derivation.sourceMediaType),png=readFileSync(pngPath);
  if(!result.png.equals(png)||result.width!==asset.width||result.height!==asset.height)throw Error('ARTWORK_DERIVATION_MISMATCH');
  verified.set(asset.id,{sha256:sha256Bytes(png),original:bytes,sourceMediaType:asset.derivation.sourceMediaType});
 }}finally{await runner?.browser.close();}return verified;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [outputDir,topicId,sourceDir,manifestFile,...extra]=process.argv.slice(2);if(!outputDir||!topicId||!sourceDir||!manifestFile||extra.length)throw Error('ARTWORK_CAPTURE_ARGUMENTS_REQUIRED');
 const root=realpathSync('artifacts'),manifestPath=realpathSync(manifestFile);if(!within(root,manifestPath))throw Error('PRIVATE_MANIFEST_REQUIRED');
 const topics=parseCanonicalJson(readFileSync('research/evals/topics.json')),topic=topics.topics.find(item=>item.id===topicId&&item.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=parseCanonicalJson(readFileSync(topic.factCard)),manifest=parseCanonicalJson(readFileSync(manifestPath));
 const result=await captureApprovedArtwork({sourceDir,outputDir,card,entries:manifest.files});console.log(canonical({scope:result.scope,assets:result.assets.length,review:'pending_visual_selection'}));
}
