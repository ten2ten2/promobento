// Source-specific permission: an original facts diagram never clears the original site's images.
export function materialApproval(card,asset){
 const original=asset.origin==='original_factual_diagram';
 const source=card.assetSources.find(source=>source.url===asset.sourceUrl&&
  (original?source.kind==='original_factual_diagram':source.kind!=='original_factual_diagram'));
 if(original){
  const approval=card.originalMaterialApproval;
  if(!source||!approval||approval.status!=='approved'||approval.approvedBy!=='owner'||approval.scope!=='internal_eval_only'
   ||approval.publicUseCleared!==false||approval.assetId!==asset.id||asset.approvalRef!=='research/evals/fact-cards/'+card.topicId+'.json#/originalMaterialApproval'
   ||asset.imageUrl||asset.clip||asset.originalSourceFile!==asset.id+'.svg'||!Array.isArray(asset.factIds)
   ||asset.factIds.length!==approval.factIds.length||new Set(asset.factIds).size!==asset.factIds.length
   ||!asset.factIds.every(id=>approval.factIds.includes(id)&&card.confirmation.factIds.includes(id)))throw Error('ORIGINAL_MATERIAL_APPROVAL_REQUIRED');
  return{source,original:approval};
 }
 if(card.materialLicenseReview?.status==='permission_required')throw Error('MATERIAL_SOURCE_PERMISSION_REQUIRED');
 if(!source)throw Error('MATERIAL_SOURCE_INVALID');
 const explicit=card.materialApprovals?.[asset.id];
 if(explicit||asset.approvalRef){
  if(!explicit||explicit.status!=='approved'||explicit.approvedBy!=='owner'||explicit.scope!=='internal_eval_only'
   ||explicit.storage!=='staging_R2'||explicit.publicUseCleared!==false||!/^\d{4}-\d{2}-\d{2}$/.test(explicit.approvedOn??'')
   ||!explicit.basis||asset.approvalRef!==`research/evals/fact-cards/${card.topicId}.json#/materialApprovals/${asset.id}`)throw Error('MATERIAL_EXPLICIT_APPROVAL_REQUIRED');
 }
 return{source,original:null,...(explicit?{explicit}: {})};
}

/** A local approval binds the selected path, its declared source and the actual bytes. */
export function assertLocalMaterialIdentity(approval,asset,sha256){
 if(approval.source.kind!=='local_project_media')return;
 if(!approval.explicit||asset.derivation?.kind!=='approved_local_project_file'
  ||approval.explicit.sourceFile!==asset.derivation.sourceFile||approval.explicit.sourceUrl!==asset.sourceUrl
  ||!/^[a-f0-9]{64}$/.test(approval.explicit.sha256??'')||sha256!==approval.explicit.sha256)throw Error('LOCAL_MATERIAL_IDENTITY_MISMATCH');
}

/** A web-image approval fixes both the source URL and the exact bytes before download. */
export function assertRemoteMaterialIdentity(approval,asset,sha256){
 if(!approval.explicit?.imageUrl&&asset.derivation?.kind!=='approved_web_image')return;
 if(!approval.explicit||asset.derivation?.kind!=='approved_web_image'||approval.explicit.sourceUrl!==asset.sourceUrl
  ||approval.explicit.imageUrl!==asset.imageUrl||asset.derivation.imageUrl!==asset.imageUrl
  ||!/^[a-f0-9]{64}$/.test(approval.explicit.sha256??'')||approval.explicit.sha256!==sha256)throw Error('WEB_MATERIAL_IDENTITY_MISMATCH');
}
