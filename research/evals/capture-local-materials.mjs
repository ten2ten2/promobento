// Collect only explicitly approved PNGs from a local project into the existing S1 selection workflow.
// The source directory is read-only; the collector never runs project code or infers usage rights.
import {existsSync,lstatSync,mkdirSync,readFileSync,realpathSync,statSync,writeFileSync} from 'node:fs';
import {resolve,relative,sep,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {materialApproval} from './material-approval.mjs';

const within=(root,path)=>path.startsWith(root+sep);
export function captureApprovedLocal({sourceDir,outputDir,card,entries}){
 const source=realpathSync(sourceDir),output=resolve(outputDir),artifacts=realpathSync('artifacts');
 if(!within(artifacts,output)||existsSync(output))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 let parent=dirname(output);while(!existsSync(parent)&&parent!==dirname(parent))parent=dirname(parent);
 const actualParent=realpathSync(parent);if(actualParent!==artifacts&&!within(artifacts,actualParent))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 if(!Array.isArray(entries)||!entries.length||entries.length>60||new Set(entries.map(entry=>entry.id)).size!==entries.length)throw Error('LOCAL_MATERIAL_SELECTION_INVALID');
 if(card.status!=='confirmed_for_s1_eval'||card.confirmation?.confirmedBy!=='owner'||card.confirmation.scope!=='s1-first-internal-evaluation'
  ||card.rights?.scope!=='internal_eval_only'||card.rights.publicUseCleared!==false)throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
 // Approve every source before reading any media bytes; a broad project directory is not itself a license.
 const approved=entries.map(entry=>{
  if(!/^[a-z0-9-]{4,80}$/.test(entry.id??'')||typeof entry.sourceFile!=='string'||!entry.sourceFile||typeof entry.description!=='string'||!entry.description.trim())throw Error('LOCAL_MATERIAL_SELECTION_INVALID');
  const asset={id:entry.id,topicId:card.topicId,sourceUrl:entry.sourceUrl,approvalRef:entry.approvalRef};
  const decision=materialApproval(card,asset);if(!decision.explicit)throw Error('MATERIAL_EXPLICIT_APPROVAL_REQUIRED');
  if(decision.explicit.sourceFile!==entry.sourceFile||decision.explicit.sourceUrl!==entry.sourceUrl||!/^[a-f0-9]{64}$/.test(decision.explicit.sha256??''))throw Error('LOCAL_MATERIAL_APPROVAL_IDENTITY_REQUIRED');
  const path=resolve(source,entry.sourceFile);if(!within(source,path)||relative(source,path).split(sep).join('/')!==entry.sourceFile
   ||!within(source,realpathSync(path))||lstatSync(path).isSymbolicLink()||!statSync(path).isFile())throw Error('LOCAL_MATERIAL_PATH_INVALID');
  if(statSync(path).size>1<<20)throw Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED');
  return{entry,path,approvedSha:decision.explicit.sha256};
 });
 const materials=approved.map(({entry,path,approvedSha})=>{
  const bytes=readFileSync(path);if(bytes.length>1<<20)throw Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED');
  if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('MATERIAL_IDENTITY_INVALID');
  if(sha256Bytes(bytes)!==approvedSha)throw Error('LOCAL_MATERIAL_IDENTITY_MISMATCH');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height)throw Error('MATERIAL_IDENTITY_INVALID');
  if(width>4096||height>4096)throw Error('DIRECTOR_MATERIAL_NORMALIZATION_REQUIRED');
  return{bytes,asset:{id:entry.id,topicId:card.topicId,file:entry.id+'.png',width,height,description:entry.description,sourceUrl:entry.sourceUrl,approvalRef:entry.approvalRef,
   derivation:{kind:'approved_local_project_file',sourceFile:relative(source,path).split(sep).join('/')},review:'pending_visual_selection',scope:'internal_eval_only',publicUseCleared:false}};
 });
 mkdirSync(output,{recursive:true});if(!within(artifacts,realpathSync(output)))throw Error('NEW_PRIVATE_OUTPUT_REQUIRED');
 for(const {asset,bytes}of materials)writeFileSync(join(output,asset.file),bytes,{flag:'wx'});
 const result={scope:'internal_eval_only',publicUseCleared:false,assets:materials.map(item=>item.asset)};
 writeFileSync(join(output,'selected.json'),canonical(result)+'\n',{flag:'wx'});return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [outputDir,topicId,sourceDir,manifestFile,...extra]=process.argv.slice(2);
 if(!outputDir||!topicId||!sourceDir||!manifestFile||extra.length)throw Error('LOCAL_CAPTURE_ARGUMENTS_REQUIRED');
 const manifestPath=resolve(manifestFile);if(!within(realpathSync('artifacts'),realpathSync(manifestPath)))throw Error('PRIVATE_MANIFEST_REQUIRED');
 const topics=parseCanonicalJson(readFileSync('research/evals/topics.json')),topic=topics.topics.find(item=>item.id===topicId&&item.countsTowardGate!==false);
 if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=parseCanonicalJson(readFileSync(topic.factCard)),manifest=parseCanonicalJson(readFileSync(manifestPath));
 const selected=captureApprovedLocal({sourceDir,outputDir,card,entries:manifest.files});
 console.log(canonical({scope:selected.scope,assets:selected.assets.length,review:'pending_visual_selection'}));
}
