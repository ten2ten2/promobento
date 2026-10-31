// Download only individually approved, byte-identified web images for the internal S1 selection.
// No redirects, credentials, website scripts, model calls or automatic approval.
import {request} from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList, isIP} from 'node:net';
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,dirname,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {materialApproval,assertRemoteMaterialIdentity} from './material-approval.mjs';
import {imageHeader} from './image-header.mjs';

const MAX_BYTES=1<<20,within=(root,path)=>path.startsWith(root+sep),blocked=new BlockList();
for(const [ip,bits] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(ip,bits,'ipv4');
for(const [ip,bits] of [['2001::',32],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked.addSubnet(ip,bits,'ipv6');
const globalV6=new BlockList();globalV6.addSubnet('2000::',3,'ipv6');
export function approvedWebUrl(value){
 let url;try{url=new URL(value);}catch{throw Error('WEB_MATERIAL_URL_INVALID');}
 if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search||url.href!==value||value.length>2048||isIP(url.hostname.replace(/^\[|\]$/g,''))||!url.hostname.includes('.')||url.hostname.endsWith('.local'))throw Error('WEB_MATERIAL_URL_INVALID');
 return url;
}
function publicAddress(item){return item.family===4?!blocked.check(item.address,'ipv4'):item.family===6&&globalV6.check(item.address,'ipv6')&&!blocked.check(item.address,'ipv6');}
export async function downloadApprovedImage(value,{resolveAddress=lookup,makeRequest=request,accept='image/png,image/jpeg,image/webp'}={}){
 const url=approvedWebUrl(value);let timer,addresses;
 try{addresses=await Promise.race([resolveAddress(url.hostname,{all:true,verbatim:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('WEB_MATERIAL_TIMEOUT')),15000);})]);}
 finally{clearTimeout(timer);}
 if(!addresses.length||addresses.some(item=>!publicAddress(item)))throw Error('WEB_MATERIAL_ADDRESS_INVALID');
 const selected=addresses[0];
 return new Promise((done,fail)=>{
  const req=makeRequest(url,{method:'GET',headers:{accept},timeout:15000,
   lookup(_host,options,callback){if(options.all)callback(null,[selected]);else callback(null,selected.address,selected.family);}},response=>{
   response.on('error',fail);response.on('aborted',()=>fail(Error('WEB_MATERIAL_RESPONSE_ABORTED')));
   if(response.statusCode!==200){response.destroy();fail(Error('WEB_MATERIAL_HTTP_'+response.statusCode));return;}
   const declared=Number(response.headers['content-length']);if(Number.isFinite(declared)&&declared>MAX_BYTES){response.destroy();fail(Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED'));return;}
   let length=0;const parts=[];
   response.on('data',chunk=>{length+=chunk.length;if(length>MAX_BYTES){response.destroy(Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED'));return;}parts.push(chunk);});
   response.on('end',()=>done(Buffer.concat(parts)));
  });
  // Limit total wall time as well as socket inactivity; a slow stream cannot hold intake open forever.
  const deadline=setTimeout(()=>req.destroy(Error('WEB_MATERIAL_TIMEOUT')),15000);
  req.on('close',()=>clearTimeout(deadline));req.on('timeout',()=>req.destroy(Error('WEB_MATERIAL_TIMEOUT')));req.on('error',fail);req.end();
 });
}
export async function captureApprovedWebImages({outputDir,card,entries,download=downloadApprovedImage}){
 const artifacts=realpathSync('artifacts'),output=resolve(outputDir);
 if(!within(artifacts,output)||existsSync(output))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 let parent=dirname(output);while(!existsSync(parent)&&parent!==dirname(parent))parent=dirname(parent);
 const actualParent=realpathSync(parent);if(actualParent!==artifacts&&!within(artifacts,actualParent))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 if(card.status!=='confirmed_for_s1_eval'||card.confirmation?.confirmedBy!=='owner'||card.confirmation.scope!=='s1-first-internal-evaluation'||card.rights?.scope!=='internal_eval_only'||card.rights.publicUseCleared!==false)throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 if(!Array.isArray(entries)||!entries.length||entries.length>60||new Set(entries.map(item=>item.id)).size!==entries.length)throw Error('WEB_MATERIAL_SELECTION_INVALID');
 // Validate every license, source and exact approved URL before any network request.
 const approved=entries.map(entry=>{
  if(!/^[a-z0-9-]{4,80}$/.test(entry.id??'')||typeof entry.description!=='string'||!entry.description.trim())throw Error('WEB_MATERIAL_SELECTION_INVALID');
  approvedWebUrl(entry.sourceUrl);approvedWebUrl(entry.imageUrl);
  const asset={id:entry.id,topicId:card.topicId,sourceUrl:entry.sourceUrl,imageUrl:entry.imageUrl,approvalRef:entry.approvalRef,
   derivation:{kind:'approved_web_image',imageUrl:entry.imageUrl}};
  const decision=materialApproval(card,asset);
  if(!decision.explicit||decision.source.kind==='local_project_media'||decision.explicit.sourceUrl!==entry.sourceUrl||decision.explicit.imageUrl!==entry.imageUrl||!/^[a-f0-9]{64}$/.test(decision.explicit.sha256??''))throw Error('WEB_MATERIAL_APPROVAL_IDENTITY_REQUIRED');
  return{entry,asset,decision};
 });
 const materials=[];
 for(const {entry,asset,decision}of approved){
  const bytes=Buffer.from(await download(entry.imageUrl));if(!bytes.length||bytes.length>MAX_BYTES)throw Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED');
  assertRemoteMaterialIdentity(decision,asset,sha256Bytes(bytes));const {width,height,extension,mediaType}=imageHeader(bytes);
  if(width>4096||height>4096)throw Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED');
  materials.push({bytes,asset:{...asset,file:entry.id+'.'+extension,width,height,mediaType,description:entry.description,review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false}});
 }
 mkdirSync(output,{recursive:true});if(!within(artifacts,realpathSync(output)))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 for(const {asset,bytes}of materials)writeFileSync(join(output,asset.file),bytes,{flag:'wx'});
 const result={scope:'internal_eval_only',publicUseCleared:false,assets:materials.map(item=>item.asset)};
 writeFileSync(join(output,'selected.json'),canonical(result)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [outputDir,topicId,manifestFile,...extra]=process.argv.slice(2);
 if(!outputDir||!topicId||!manifestFile||extra.length)throw Error('WEB_CAPTURE_ARGUMENTS_REQUIRED');
 const root=realpathSync('artifacts'),manifestPath=realpathSync(manifestFile);if(!within(root,manifestPath))throw Error('PRIVATE_MANIFEST_REQUIRED');
 const topics=parseCanonicalJson(readFileSync('research/evals/topics.json')),topic=topics.topics.find(item=>item.id===topicId&&item.countsTowardGate!==false);
 if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=parseCanonicalJson(readFileSync(topic.factCard)),manifest=parseCanonicalJson(readFileSync(manifestPath));
 const result=await captureApprovedWebImages({outputDir,card,entries:manifest.files});console.log(canonical({scope:result.scope,assets:result.assets.length,review:'pending_visual_selection'}));
}
