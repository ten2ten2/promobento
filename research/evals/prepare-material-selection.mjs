// Validate every selected original before creating any remote operation or secret.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';
import {materialApproval,assertLocalMaterialIdentity,assertRemoteMaterialIdentity} from './material-approval.mjs';
import {imageHeader} from './image-header.mjs';

export function prepareMaterialSelection(directory,selected,topics,{readCard=path=>parseCanonicalJson(readFileSync(path)),verifiedArtwork=new Map(),verifiedVideos=new Map()}={}){
if(!Array.isArray(selected.assets)||!selected.assets.length||new Set(selected.assets.map(asset=>asset.id)).size!==selected.assets.length)throw Error('MATERIAL_SELECTION_INVALID');
if(selected.scope!=='internal_eval_only'||selected.publicUseCleared!==false||topics.factConfirmation.confirmedBy!=='owner')throw Error('INTERNAL_SOURCE_APPROVAL_REQUIRED');
return selected.assets.map(asset=>{
 const topic=topics.topics.find(topic=>topic.id===asset.topicId&&topic.countsTowardGate!==false);if(!topic)throw Error('TOPIC_NOT_APPROVED');
 const card=readCard(topic.factCard);
 if(card.status!=='confirmed_for_s1_eval'||card.confirmation.confirmedBy!=='owner'||card.confirmation.scope!=='s1-first-internal-evaluation'||card.rights.scope!=='internal_eval_only'||asset.review!=='approved_for_internal_eval_by_codex'||!asset.reviewedAt)throw Error('MATERIAL_REVIEW_REQUIRED');
 const approval=materialApproval(card,asset);
 if(!/^[a-z0-9-]+\.(?:png|jpg|webp)$/.test(asset.file))throw Error('MATERIAL_SOURCE_INVALID');
 let originalSource;
 if(approval.original){
  originalSource=readFileSync(join(directory,asset.originalSourceFile));
  if(originalSource.length>8<<20||!originalSource.toString('utf8').trimStart().startsWith('<svg')
   ||/<\s*(?:script|image|foreignObject|!DOCTYPE|!ENTITY)\b|\bhref\s*=|\bon[a-z]+\s*=|url\s*\(/i.test(originalSource.toString('utf8')))throw Error('ORIGINAL_MATERIAL_SOURCE_INVALID');
 }
 const bytes=readFileSync(join(directory,asset.file));if(bytes.length>8<<20)throw Error('MATERIAL_IDENTITY_INVALID');
 const {width,height,extension,mediaType}=imageHeader(bytes);
 if(!asset.file.endsWith('.'+extension)||width!==asset.width||height!==asset.height||extension!=='png'&&asset.mediaType&&asset.mediaType!==mediaType)throw Error('MATERIAL_IDENTITY_INVALID');
 const sha256=sha256Bytes(bytes),artwork=asset.derivation?.kind==='approved_artwork_rasterization'?verifiedArtwork.get(asset.id):undefined,video=asset.derivation?.kind==='approved_video_frame_pack'?verifiedVideos.get(asset.id):undefined;
 if(asset.derivation?.kind==='approved_video_frame_pack'){
  const web=asset.derivation.sourceOrigin==='web';
  if(!video||!approval.explicit||approval.explicit.sourceUrl!==asset.sourceUrl
   ||(web?(approval.source.kind==='local_project_media'||approval.explicit.videoUrl!==asset.videoUrl||asset.derivation.videoUrl!==asset.videoUrl
      ||approval.explicit.sourceMediaType!==undefined&&approval.explicit.sourceMediaType!==asset.derivation.sourceMediaType)
    :(approval.source.kind!=='local_project_media'||approval.explicit.sourceFile!==asset.derivation.sourceFile))
   ||approval.explicit.sha256!==asset.derivation.sourceSha256||sha256Bytes(video.source)!==approval.explicit.sha256
   ||video.manifest.source.sha256!==approval.explicit.sha256||video.manifest.source.mediaType!==asset.derivation.sourceMediaType
   ||video.manifest.poster.sha256!==sha256||!video.poster.equals(bytes))throw Error('VIDEO_VERIFICATION_REQUIRED');
  return{asset,bytes:video.manifestBytes,sha256:sha256Bytes(video.manifestBytes),mediaType:'application/json',extension:'json',original:approval.original,explicit:approval.explicit,video};
 }
 if(asset.derivation?.kind==='approved_artwork_rasterization'){
  const web=asset.derivation.sourceOrigin==='web',inline=asset.derivation.sourceOrigin==='inline-svg';
  if(!artwork||artwork.sha256!==sha256||!approval.explicit||approval.explicit.sourceUrl!==asset.sourceUrl
   ||(inline?(approval.source.kind==='local_project_media'||!asset.derivation.selector||approval.explicit.selector!==asset.derivation.selector
      ||asset.derivation.sourceMediaType!=='image/svg+xml'||asset.imageUrl!==undefined)
    :web?(approval.source.kind==='local_project_media'||approval.explicit.imageUrl!==asset.imageUrl||asset.derivation.imageUrl!==asset.imageUrl
      ||approval.explicit.sourceMediaType!==undefined&&approval.explicit.sourceMediaType!==asset.derivation.sourceMediaType)
    :(approval.source.kind!=='local_project_media'||approval.explicit.sourceFile!==asset.derivation.sourceFile))
   ||approval.explicit.sha256!==asset.derivation.sourceSha256||sha256Bytes(artwork.original)!==approval.explicit.sha256
   ||artwork.sourceMediaType!==asset.derivation.sourceMediaType)throw Error('ARTWORK_VERIFICATION_REQUIRED');
 }
 else{assertLocalMaterialIdentity(approval,asset,sha256);assertRemoteMaterialIdentity(approval,asset,sha256);}
 return{asset,bytes,sha256,mediaType,extension,original:approval.original,explicit:approval.explicit,originalSource,...(artwork?{artwork}: {})};
});
}
