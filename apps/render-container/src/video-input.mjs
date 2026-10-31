// Container-side immutable video packs. The Worker supplies only broker-approved input refs.
import {parseVideoFrameManifest,openVideoFramePack} from '@promobento/contracts/video-frames';
import {sha256Bytes} from '@promobento/contracts/digest';
const same=(ref,expected)=>ref&&ref.sha256===expected.sha256&&ref.byteLength===expected.byteLength;
export async function admitPackedVideos(task,objects,bytes){
 const videos=new Map();
 for(const resource of task.options.resources){
  if(resource.videoFramePacking===undefined)continue; // Preserve every older individual-frame contract.
  if(resource.videoFramePacking!=='webp-pack-v1'||resource.kind!=='video')throw Error('VIDEO_FRAME_MANIFEST_MISMATCH');
  const id=resource.resourceId,jobResource=task.job.resources.find(item=>item.resourceId===id),ref=objects.get('resource:'+id);
  if(!jobResource||!ref||jobResource.sha256!==ref.sha256)throw Error('VIDEO_FRAME_MANIFEST_IDENTITY');
  const manifest=parseVideoFrameManifest(await bytes('resource:'+id,1<<20),jobResource.sha256);
  if(resource.width!==manifest.width||resource.height!==manifest.height||!Array.isArray(resource.videoFrames)||resource.videoFrames.length!==manifest.frames.length
   ||resource.videoFrames.some((frame,index)=>frame.index!==index||frame.pts!==manifest.frames[index].pts||frame.duration!==manifest.frames[index].duration))throw Error('VIDEO_FRAME_MANIFEST_MISMATCH');
  const poster=objects.get('poster:'+id);if(!same(poster,manifest.poster))throw Error('VIDEO_FRAME_POSTER_IDENTITY');
  for(const [index,pack]of manifest.packs.entries())if(!same(objects.get('framepack:'+id+':'+index),pack))throw Error('VIDEO_FRAME_PACK_IDENTITY');
  const cache=new Map();
  videos.set(id,{
   async poster(){const value=await bytes('poster:'+id,1<<20);if(value.byteLength!==manifest.poster.byteLength||sha256Bytes(value)!==manifest.poster.sha256)throw Error('VIDEO_FRAME_POSTER_IDENTITY');return value;},
   async frame(index){const frame=manifest.frames[index];if(!frame||frame.index!==index)throw Error('VIDEO_FRAME_UNAVAILABLE');
    let opened=cache.get(frame.pack);if(!opened){const value=await bytes('framepack:'+id+':'+frame.pack,12<<20);opened=openVideoFramePack(manifest,frame.pack,value);
     if(cache.size>=4)cache.delete(cache.keys().next().value);cache.set(frame.pack,opened);}
    return opened.frame(index);
   }
  });
 }
 return videos;
}
