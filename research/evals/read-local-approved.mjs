import {closeSync,constants,fstatSync,openSync,readSync} from 'node:fs';

/** Revalidate the opened inode and bound the read even if a local file changes after path preflight. */
export function readBoundedApprovedFile(path,maxBytes,oversizeCode){
 let fd;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
 catch{throw Error('LOCAL_MATERIAL_PATH_INVALID');}
 try{
  const stat=fstatSync(fd);
  if(!stat.isFile())throw Error('LOCAL_MATERIAL_PATH_INVALID');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<0||stat.size>maxBytes)throw Error(oversizeCode);
  const bytes=Buffer.alloc(stat.size);let offset=0;
  while(offset<stat.size){const count=readSync(fd,bytes,offset,stat.size-offset,null);if(!count)throw Error('LOCAL_MATERIAL_CHANGED');offset+=count;}
  if(readSync(fd,Buffer.alloc(1),0,1,null))throw Error('LOCAL_MATERIAL_CHANGED');
  return bytes;
 }finally{closeSync(fd);}
}
