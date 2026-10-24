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
 return{source,original:null};
}
