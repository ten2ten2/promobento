import {assertNativePath} from '@promobento/contracts/native-project';

const textPath=/^(index\.(?:html|js|css)|src\/[A-Za-z0-9_./-]+\.(?:html|js|css|svg|json)|BRIEF\.md|TREATMENT\.md|script\.json|material-selection\.json|script-audio-locks\.json)$/;
export function assertAuthorPath(path){assertNativePath(path);if(!textPath.test(path))throw Error('NATIVE_AUTHOR_PATH_INVALID');return path;}
export function nativeTextType(path){
 const ext=path.split('.').at(-1);return ({html:'text/html',js:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',md:'text/markdown'})[ext]??'text/plain';
}
/** This is file transport validation. Native composition semantics are checked by huashu in the browser. */
export function assertSourceFiles(files){
 if(!Array.isArray(files)||!files.length||files.length>24)throw Error('NATIVE_SOURCE_FILES_INVALID');
 const paths=new Set();let bytes=0;
 for(const file of files){
  assertAuthorPath(file.path);
  if(paths.has(file.path.toLowerCase())||typeof file.content!=='string'||new TextEncoder().encode(file.content).length>240000)throw Error('NATIVE_SOURCE_FILES_INVALID');
  paths.add(file.path.toLowerCase());bytes+=new TextEncoder().encode(file.content).length;
 }
 for(const file of files){const parts=file.path.toLowerCase().split('/');parts.pop();while(parts.length){if(paths.has(parts.join('/')))throw Error('NATIVE_SOURCE_FILES_INVALID');parts.pop();}}
 if(!paths.has('index.html')||bytes>1048576)throw Error('NATIVE_SOURCE_FILES_INVALID');
 return files;
}
/** Apply all edits to a copy. A stale revision or ambiguous text match never changes any file. */
export function applyProjectPatch(files,revisionId,input){
 if(input.baseRevision!==revisionId)throw Error('NATIVE_REVISION_CONFLICT');
 assertSourceFiles(files);
 if(!Array.isArray(input.edits)||!input.edits.length||input.edits.length>32)throw Error('NATIVE_PATCH_INVALID');
 const next=new Map(files.map(file=>[file.path,file.content]));
 for(const edit of input.edits){
  assertAuthorPath(edit.path);
  if(edit.path==='BRIEF.md')throw Error('NATIVE_BRIEF_READ_ONLY');
  if(edit.path==='TREATMENT.md')throw Error('NATIVE_TREATMENT_READ_ONLY');
  if(['script.json','material-selection.json','script-audio-locks.json'].includes(edit.path))throw Error('NATIVE_PRODUCTION_DOCUMENT_READ_ONLY');
  if(edit.command==='create'){
   if(next.has(edit.path)||typeof edit.content!=='string')throw Error('NATIVE_PATCH_CREATE_CONFLICT');
   next.set(edit.path,edit.content);
  }else if(edit.command==='replace'){
   const old=next.get(edit.path);
   if(old===undefined||typeof edit.oldText!=='string'||!edit.oldText||typeof edit.newText!=='string')throw Error('NATIVE_PATCH_TARGET_INVALID');
   const at=old.indexOf(edit.oldText);
   if(at<0||old.indexOf(edit.oldText,at+1)>=0)throw Error('NATIVE_PATCH_MATCH_INVALID');
   next.set(edit.path,old.slice(0,at)+edit.newText+old.slice(at+edit.oldText.length));
  }else if(edit.command==='delete'){
   if(edit.path==='index.html'||!next.delete(edit.path))throw Error('NATIVE_PATCH_DELETE_INVALID');
  }else throw Error('NATIVE_PATCH_COMMAND_INVALID');
 }
 if(next.size===files.length&&files.every(file=>next.get(file.path)===file.content))throw Error('NATIVE_PATCH_NO_CHANGE');
 return assertSourceFiles([...next].map(([path,content])=>({path,content})).sort((a,b)=>a.path.localeCompare(b.path)));
}
export function reviewFrameTimes(frames,durationSeconds){
 if(![15,30].includes(durationSeconds)||!Array.isArray(frames)||!frames.length||frames.length>10
  ||frames.some(frame=>!Number.isInteger(frame)||frame<0||frame>=durationSeconds*30))throw Error('NATIVE_REVIEW_FRAMES_INVALID');
 return [...new Set([0,...frames,durationSeconds*30-1])].sort((a,b)=>a-b).slice(0,16).map(frame=>frame/30);
}
export function assertTreatment(value,durationSeconds,resourceIds){
 const total=durationSeconds*30,ids=new Set();
 for(const beat of value.beats){
  if(ids.has(beat.id)||!Number.isInteger(beat.startFrame)||!Number.isInteger(beat.endFrame)||beat.startFrame<0||beat.endFrame>total||beat.endFrame<=beat.startFrame
   ||new Set(beat.assetIds).size!==beat.assetIds.length||beat.assetIds.some(id=>!resourceIds.includes(id)))throw Error('NATIVE_TREATMENT_INVALID');
  ids.add(beat.id);
 }
 if(!ids.has(value.hardestBeat)||Math.min(...value.beats.map(b=>b.startFrame))!==0||Math.max(...value.beats.map(b=>b.endFrame))!==total)throw Error('NATIVE_TREATMENT_INVALID');
 // A first and final beat do not prove a complete timeline. Overlapping
 // visual/audio beats are valid, but every frame needs an authored intent.
 let coveredUntil=0;
 for(const beat of [...value.beats].sort((a,b)=>a.startFrame-b.startFrame)){
  if(beat.startFrame>coveredUntil)throw Error('NATIVE_TREATMENT_INVALID');
  coveredUntil=Math.max(coveredUntil,beat.endFrame);
 }
 if(coveredUntil!==total)throw Error('NATIVE_TREATMENT_INVALID');
 reviewFrameTimes(value.reviewFrames,durationSeconds);return value;
}

/** Accept timing only for the exact admitted media, on its measured local clock. */
export function normalizeTimingEvidence(entries,materials){
 if(entries===undefined)return [];
 // A patch can retain measurements from earlier revisions while adding new
 // tracks. The saved collection is bounded by native-project.resources (128),
 // not by a single request's 12+12 admitted material lists.
 if(!Array.isArray(entries)||entries.length>128)throw Error('NATIVE_TIMING_EVIDENCE_INVALID');
 if(new Set(entries.map(entry=>entry?.sourceSha256)).size!==entries.length)throw Error('NATIVE_TIMING_EVIDENCE_INVALID');
 return entries.map(entry=>{
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Error('NATIVE_TIMING_EVIDENCE_INVALID');
  const source=materials.find(material=>material.sha256===entry.sourceSha256&&['audio','video'].includes(material.kind));
  if(!source||!Number.isFinite(source.durationSeconds)||source.durationSeconds<=0||!Number.isFinite(entry.durationSeconds)
   ||Math.abs(entry.durationSeconds-source.durationSeconds)>1/30||!Array.isArray(entry.words)||entry.words.length>5000)throw Error('NATIVE_TIMING_EVIDENCE_INVALID');
  let previous=-1;
  for(const word of entry.words){
   if(!word||typeof word!=='object'||Array.isArray(word)||typeof word.text!=='string'||!word.text||!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<previous||word.start<0
    ||word.end<=word.start||word.end>source.durationSeconds)throw Error('NATIVE_TIMING_EVIDENCE_INVALID');
   previous=word.start;
  }
  return {sourceSha256:source.sha256,path:source.path,durationSeconds:source.durationSeconds,words:entry.words.map(word=>({text:word.text,start:word.start,end:word.end}))};
 });
}
