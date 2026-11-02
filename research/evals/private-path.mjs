// Resolve the existing private root and the requested path before reading or
// writing. A lexical "artifacts/" prefix alone does not fence symlink parents.
import {closeSync,constants,existsSync,lstatSync,mkdirSync,openSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {basename,dirname,join,resolve,sep} from 'node:path';

const within=(root,path)=>path.startsWith(root+sep);
function bounds(path,code,createRoot=false){
 const lexical=resolve('artifacts'),target=resolve(path);
 if(!within(lexical,target))throw Error(code);
 // Captures and input preparation work in a fresh checkout, too. Establish
 // only the trusted root before checking any deeper, potentially linked parent.
 if(createRoot&&!existsSync(lexical))mkdirSync(lexical,{recursive:false});
 const rootStat=lstatSync(lexical);
 if(rootStat.isSymbolicLink()||!rootStat.isDirectory())throw Error(code);
 const actual=realpathSync(lexical);
 return {actual,target};
}
export function privateExisting(path,kind='directory',code='PRIVATE_ARTIFACT_DIRECTORY_REQUIRED'){
 const {actual,target}=bounds(path,code),resolved=realpathSync(target),stat=lstatSync(target);
 if(!within(actual,resolved)||stat.isSymbolicLink()||(kind==='directory'?!stat.isDirectory():!stat.isFile()))throw Error(code);
 return resolved;
}
export function privateNewDirectory(path,code='PRIVATE_ARTIFACT_DIRECTORY_REQUIRED',existsCode=code){
 const {actual,target}=bounds(path,code,true);
 if(lstatSync(target,{throwIfNoEntry:false}))throw Error(existsCode);
 let parent=dirname(target);
 while(!existsSync(parent)&&parent!==dirname(parent))parent=dirname(parent);
 const resolved=realpathSync(parent);
 if(resolved!==actual&&!within(actual,resolved))throw Error(code);
 return target;
}
export function privateWritableDirectory(path,code='PRIVATE_ARTIFACT_DIRECTORY_REQUIRED'){
 return existsSync(path)?privateExisting(path,'directory',code):privateNewDirectory(path,code);
}
/** Writes never follow a linked target; updates replace files atomically, including hardlinks. */
export function writePrivateFile(path,data,{exclusive=false}={}){
 const parent=privateExisting(dirname(path));
 const target=join(parent,basename(path)),prior=lstatSync(target,{throwIfNoEntry:false});
 if(prior&&(prior.isSymbolicLink()||!prior.isFile()))throw Error('PRIVATE_ARTIFACT_FILE_INVALID');
 if(exclusive){
  const fd=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,data);}finally{closeSync(fd);}
  return;
 }
 const temp=join(parent,'.'+basename(path)+'.'+randomBytes(12).toString('hex')+'.tmp');
 try{
  const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,data);}finally{closeSync(fd);}
  renameSync(temp,target);
 }finally{if(lstatSync(temp,{throwIfNoEntry:false}))unlinkSync(temp);}
}
