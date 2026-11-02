import {join} from 'node:path';
import {canonical} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {imageHeader} from './image-header.mjs';
import {writePrivateFile} from './private-path.mjs';

/** The approved source can exceed the native renderer's 4096px limit. Preserve it and record the full-frame transform. */
export async function downscaleSelectedPng(bytes,{rasterize,browser}){
 const {width,height,mediaType}=imageHeader(bytes);
 if(mediaType!=='image/png'||width>8192||height>8192||width*height>20_000_000||bytes.length>8<<20)
  throw Error('SELECTED_IMAGE_INVALID');
 if(width<=4096&&height<=4096)return{bytes,width,height};
 const scale=Math.min(4096/width,4096/height),targetWidth=Math.max(1,Math.round(width*scale)),targetHeight=Math.max(1,Math.round(height*scale));
 const output=Buffer.from(await rasterize(bytes,targetWidth,targetHeight));
 const actual=imageHeader(output);
 if(actual.mediaType!=='image/png'||actual.width!==targetWidth||actual.height!==targetHeight||output.length>8<<20)
  throw Error('SELECTED_IMAGE_DOWNSCALE_INVALID');
 return{bytes:output,width:targetWidth,height:targetHeight,original:bytes,
  derivation:{kind:'selected_image_downscale',method:'inert_PNG_full_image_downscale_no_crop',browser,
   original:{sha256:sha256Bytes(bytes),byteLength:bytes.length,width,height},
   output:{sha256:sha256Bytes(output),byteLength:output.length,width:targetWidth,height:targetHeight}}};
}

/** Content-addressed names keep a failed re-selection from overwriting previously approved files. */
export function stageSelectedFile(files,id,bytes,extension){
 if(!/^[a-z0-9-]+$/.test(id)||!['png','txt'].includes(extension))throw Error('SELECTED_FILE_INVALID');
 const file=`${id}-${sha256Bytes(bytes)}.${extension}`;
 files.set(file,bytes);
 return file;
}

/** The manifest is the single commit point: nothing is replaced until every selection succeeds. */
export function commitSelectedMaterials(directory,previous,selectedTopic,stagedAssets,stagedFiles){
 const retained=selectedTopic?(previous?.assets??[]).filter(asset=>asset.topicId!==selectedTopic):[];
 const assets=[...retained,...stagedAssets];
 for(const[file,bytes]of stagedFiles)writePrivateFile(join(directory,file),bytes);
 writePrivateFile(join(directory,'selected.json'),canonical({scope:'internal_eval_only',publicUseCleared:false,assets})+'\n');
}
