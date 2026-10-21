import {mkdirSync,readFileSync,writeFileSync,renameSync,openSync,closeSync,fsyncSync,unlinkSync,lstatSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,parseCanonicalJson} from '../../../packages/contracts/index.mjs';

export function readJson(path) {return parseCanonicalJson(readFileSync(path));}
export function writeJson(path,value) {
  const temporary=path+'.'+randomUUID()+'.tmp';
  writeFileSync(temporary,canonical(value)+'\n',{mode:0o600,flag:'wx'});
  const descriptor=openSync(temporary,'r');try{fsyncSync(descriptor);}finally{closeSync(descriptor);}
  renameSync(temporary,path);
}
export function checkedId(id) {if(typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id))throw Error('LOCAL_AGENT_ID_INVALID');return id;}
/** One owner holds this workspace lock across each call, including settlement. No stale-lock guessing. */
export async function withStore(directory,callback) {
  const root=resolve(directory);mkdirSync(root,{recursive:true,mode:0o700});
  if(lstatSync(root).isSymbolicLink())throw Error('LOCAL_AGENT_SYMLINK_STORE');
  const lock=join(root,'.lock');let fd;
  try{fd=openSync(lock,'wx',0o600);}catch(error){if(error.code==='EEXIST')throw Error('LOCAL_AGENT_STORE_BUSY');throw error;}
  writeFileSync(fd,canonical({pid:process.pid,startedAt:new Date().toISOString()}));
  try{return await callback({root,exists:path=>existsSync(join(root,path)),read:path=>readJson(join(root,path)),
    write:(path,value)=>writeJson(join(root,path),value),mkdir:path=>mkdirSync(join(root,path),{recursive:true,mode:0o700})});}
  finally{closeSync(fd);unlinkSync(lock);}
}
