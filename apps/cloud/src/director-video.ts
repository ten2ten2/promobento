import {parseVideoFrameManifest} from '@promobento/contracts/video-frames';
import {checkedBytes} from './render-source.ts';
import {getJson} from './store.ts';
import type {PipelineEnv,Operation,Json,BlobRef} from './pipeline-types.ts';

const matching=(ref:Json,expected:{sha256:string;byteLength:number})=>ref&&typeof ref.key==='string'&&/^evals\/[A-Za-z0-9_/-]{4,240}\.[a-z0-9]{2,8}$/.test(ref.key)
 &&!ref.key.split('/').includes('..')&&ref.sha256===expected.sha256&&ref.byteLength===expected.byteLength;
/** Admit video only from the operation's own immutable rights evidence, before paid calls. */
export async function admitDirectorVideos(env:PipelineEnv,op:Operation,resources:Json[]):Promise<Json[]>{
 let total=0,packs=0;const admitted:Json[]=[];
 for(const [resourceIndex,asset] of resources.entries()){
  if(asset.videoFramePacking===undefined){admitted.push(asset);continue;}
  if(asset.kind!=='video'||asset.videoFramePacking!=='webp-pack-v1'||asset.byteLength>1<<20)throw Error('VIDEO_ADMISSION_INVALID');
  const row=await env.DB.prepare('SELECT evidence_key,license_ref FROM pipeline_rights WHERE operation_id=? AND resource_id=? AND sha256=? AND revoked_at IS NULL')
   .bind(op.id,asset.resourceId,asset.sha256).first<{evidence_key:string;license_ref:string}>();if(!row)throw Error('ASSET_RIGHTS_PENDING');
  const evidence=await getJson(env,row.evidence_key),raw=await checkedBytes(env,{name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength});
  const manifest=parseVideoFrameManifest(raw,asset.sha256),source=evidence.videoSource,preview=evidence.preview,refs=evidence.framePacks;
  if(evidence.resourceId!==asset.resourceId||evidence.sha256!==asset.sha256||evidence.scope!=='internal_eval_only'||row.license_ref!==asset.licenseRef||evidence.licenseRef!==row.license_ref
   ||!matching(source,manifest.source)||!matching(preview,manifest.poster)||!Array.isArray(refs)||refs.length!==manifest.packs.length
   ||refs.some((ref:Json,index:number)=>!matching(ref,manifest.packs[index]!))||asset.width!==manifest.width||asset.height!==manifest.height)throw Error('VIDEO_ADMISSION_INVALID');
  // Direction previews sample at 1.5 seconds; shorter clips cannot supply that required frame.
  if(resourceIndex===0&&manifest.frames.length<46)throw Error('VIDEO_DIRECTION_PREVIEW_TOO_SHORT');
  for(const ref of [source,preview,...refs]){const head=await env.MEDIA.head(ref.key);if(!head||head.size!==ref.byteLength||head.customMetadata?.sha256!==ref.sha256)throw Error('VIDEO_BLOB_UNAVAILABLE');}
  total+=manifest.packs.reduce((sum,pack)=>sum+pack.byteLength,0);packs+=refs.length;
  admitted.push({...asset,preview:{...preview,mediaType:'image/png'},framePacks:refs,
   videoFrames:manifest.frames.map(({index,pts,duration})=>({index,pts,duration}))});
 }
 if(total>175<<20||packs>270)throw Error('VIDEO_FRAME_BUDGET_EXCEEDED');return admitted;
}
export function directorResourceOptions(resources:Json[]):Json[]{return resources.map(asset=>({resourceId:asset.resourceId,kind:asset.kind,width:asset.width,height:asset.height,licenseRef:asset.licenseRef,rightsCleared:true,
 ...(asset.videoFramePacking==='webp-pack-v1'?{videoFramePacking:asset.videoFramePacking,videoFrames:asset.videoFrames}: {})}));}
export function directorResourceInputs(resources:Json[]):BlobRef[]{return resources.flatMap(asset=>[
 {name:'resource:'+asset.resourceId,key:asset.key,sha256:asset.sha256,byteLength:asset.byteLength},
 ...(asset.videoFramePacking==='webp-pack-v1'?[{name:'poster:'+asset.resourceId,key:asset.preview.key,sha256:asset.preview.sha256,byteLength:asset.preview.byteLength},
  ...asset.framePacks.map((pack:Json,index:number)=>({name:'framepack:'+asset.resourceId+':'+index,key:pack.key,sha256:pack.sha256,byteLength:pack.byteLength}))]:[])
]);}

/** Model prompts need source identity and duration, not thousands of transport entries. */
export function directorModelResource(asset:Json):Json{
 if(asset.videoFramePacking!=='webp-pack-v1')return asset;
 const {videoFrames,framePacks,preview,derivation,originalSourceKey,...rest}=asset;return{...rest,durationFrames:videoFrames.length,visualObservation:'The attached image is the first video frame; later content requires actual frame review.'};
}
