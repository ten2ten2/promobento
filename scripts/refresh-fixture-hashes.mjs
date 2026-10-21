// Rebuild linked, deliberately non-production contract examples. No media is rendered.
import {writeFileSync} from 'node:fs';
import {sourceFileDigests,sourceArchiveIdentity,sourceValuesBytes,targetSourceIdentity} from '../packages/contracts/index.mjs';
import {targets,digest,factVersionKey,factContentIdentity,resourceContentIdentity,contentIdentity,variantIdentity,outputArtifactIdentity,qaInputIdentity,audioIdentity,presets,load} from './contract-validation.mjs';
const write=(p,v)=>writeFileSync(new URL('../'+p,import.meta.url),JSON.stringify(v)+'\n');
const version='2.7.0',projectId='proj_fixture',revisionId='rev_fixture';
const quality=load('config/agent-policy.json').quality;
const all=targets();
const resources={schemaVersion:version,kind:'resource_manifest',exampleOnly:true,
 resources:[
  {path:'assets/product.png',sha256:digest('fixture-product-image'),byteLength:16,mediaType:'image/png',licenseRef:'rights_customer_product'},
  {path:'fonts/fixture.woff2',sha256:digest('fixture-font'),byteLength:16,mediaType:'font/woff2',licenseRef:'rights_platform_font'},
  {path:'audio/fixture.wav',sha256:digest('fixture-audio'),byteLength:16,mediaType:'audio/wav',licenseRef:'rights_platform_audio'},
  {path:'audio/mixed.wav',sha256:digest('fixture-mixed-audio'),byteLength:16,mediaType:'audio/wav',licenseRef:'rights_platform_mix'}],
 audioEvents:[{eventId:'music_fixture',kind:'music',sourceHash:digest('fixture-audio'),licenseRef:'rights_platform_audio',frameStart:0,frameEndExclusive:900,sourceOffsetFrames:0,gainDb:0,fadeInFrames:0,fadeOutFrames:0}],
 mixedAudio:{resourcePath:'audio/mixed.wav',sha256:digest('fixture-mixed-audio'),sampleRate:48000,channels:2,mixerVersion:'mix-v1'}};
const fact={schemaVersion:version,kind:'fact_manifest',exampleOnly:true,projectId,revisionId,
 facts:[{factId:'fact_name',version:1,text:'Sample / 示例产品',confirmedBy:'user_fixture',confirmedAt:'2026-10-20T00:00:00Z',evidenceRefs:['evidence_product_name']}],
 bindings:all.map((t,i)=>({bindingId:'binding_title_'+i,targetId:t.targetId,frameStart:0,frameEndExclusive:900,expectedText:'Sample / 示例产品',factIds:['fact_name'],coverage:'declared'}))};
const licenseVersions=Object.fromEntries(resources.resources.map(x=>[x.licenseRef,'1']));
const usagePolicy={termsVersion:'terms-fixture-1',rightsPolicyVersion:'rights-fixture-1',intendedUse:'commercial_export',
 licenseVersions:Object.entries(licenseVersions).map(([licenseRef,recordVersion])=>({licenseRef,recordVersion}))};
const markingProfileVersion='marking-fixture-1';
const provenance={scope:'contract_only_not_legal_clearance',exampleOnly:true,context:{workspaceId:'workspace_fixture',projectId,intendedUse:'preview',
 facts:Object.fromEntries(fact.facts.map(f=>[f.factId,{projectId,workspaceId:'workspace_fixture',version:f.version,textHash:digest(f.text),confirmation:{confirmedBy:f.confirmedBy,confirmedAt:f.confirmedAt}}])),factRevocations:{},
 qaProfileVersion:quality.profileVersion,qaProfiles:{[quality.profileVersion]:{exampleOnly:true,checkerVersion:quality.checkerVersion}},qualityReports:{},qualityAssociations:[],qualityWaivers:{},waiverActors:{user_fixture:{workspaceId:'workspace_fixture',role:'owner',active:true}},now:Date.parse('2026-10-20T00:00:00Z'),
 audioMetadata:Object.fromEntries(resources.resources.filter(x=>x.mediaType==='audio/wav').map(x=>[x.sha256,{sampleRate:48000,channels:2,sampleFrames:900*1600}])),
 assetBindings:Object.fromEntries(resources.resources.map(x=>[x.sha256,x.licenseRef])),licenseVersions,
 licenseRegistry:Object.fromEntries(resources.resources.map((x,i)=>[x.licenseRef,{'1':{exampleOnly:true,assetHash:x.sha256,
  scope:i===0?'customer':'platform',basis:i===0?'customer_declaration':'third_party_license',
  ...(i===0?{workspaceId:'workspace_fixture',projectId}:{}),evidenceHash:digest('fixture-evidence-'+x.licenseRef),allowedUses:['preview','commercial_export']}}])),
 usagePolicies:{'rights-fixture-1':{exampleOnly:true,termsVersion:'terms-fixture-1',allowedUses:['commercial_export']}},
 markingProfiles:{[markingProfileVersion]:{exampleOnly:true,machineMarking:'required',audienceDisclosure:'not_applicable',decisionRef:'fixture-assessment'}},
 claimKinds:{[factVersionKey(projectId,fact.facts[0])]:'general'},evidenceRegistry:{evidence_product_name:{exampleOnly:true,workspaceId:'workspace_fixture',projectId,
  kind:'source',sourceHash:resources.resources[0].sha256,factTextHash:digest(fact.facts[0].text)}}}};
const composition={schemaVersion:version,identityVersion:1,kind:'composition',exampleOnly:true,projectId,revisionId,
 durationSeconds:30,fps:30,totalFrames:900,seed:'fixture',sourceArchiveHash:'0'.repeat(64),dependencyManifestHash:digest('fixture-dependencies'),resourceManifestHash:digest(resources),resourceContentHash:digest(resourceContentIdentity(resources)),layoutRulesHash:digest('fixture-responsive-layout-rules'),factContentHash:digest(factContentIdentity(fact)),runtimeVersion:'runtime-fixture',rendererImageDigest:'sha256:'+digest('fixture-renderer'),presetRulesVersion:presets.rulesVersion,renderProfile:presets.renderProfiles[presets.defaultRenderProfile],
 variants:all.map(t=>({targetId:t.targetId,presetId:t.presetId,aspectId:t.aspectId,presetVersion:t.version,entrypoint:'src/'+t.aspectId+'.mjs',sourceHash:digest('fixture-code-'+t.aspectId),targetOverrideHash:null,resourceManifestHash:digest(resources),resourceContentHash:digest(resourceContentIdentity(resources)),audioHash:digest(audioIdentity(resources)),variantHash:'0'.repeat(64),coverFrame:240})),
 styleLabel:'自定义云墨 Shader',textMetadata:[{language:'mul',direction:'ltr',label:'mixed original text'}]};
provenance.context.sourceBuilds = {};
const values={headline:fact.facts[0].text};
const sourceFiles=sourceFileDigests([
 ...[...new Set(composition.variants.map(v=>v.entrypoint))].map(path=>({path,bytes:Buffer.from('fixture-code-'+path)})),
 {path:'src/shared.mjs',bytes:Buffer.from('fixture-shared-module')},
 {path:'values.json',bytes:sourceValuesBytes(values)}
]);
composition.sourceArchiveHash=digest(sourceArchiveIdentity(sourceFiles));
provenance.context.sourceArchiveFiles=sourceFiles;
for(const v of composition.variants){
 const build={exampleOnly:true,sourceArchiveHash:composition.sourceArchiveHash,entrypoint:v.entrypoint,
  files:sourceFiles.filter(file=>[v.entrypoint,'src/shared.mjs','values.json'].includes(file.path)),
  values,editables:[{id:'headline',label:'Headline',type:'text',factId:'fact_name'}]};
 provenance.context.sourceBuilds[v.targetId]=build;
 v.sourceHash=digest(targetSourceIdentity(build));
 v.variantHash=digest(variantIdentity(composition,v));
 const qaInputHash=digest(qaInputIdentity(composition,v,quality.profileVersion));
 const report={schemaVersion:version,kind:'quality_report',exampleOnly:true,workspaceId:'workspace_fixture',projectId,targetId:v.targetId,qaProfileVersion:quality.profileVersion,qaInputHash,checkerVersion:quality.checkerVersion,coverage:'fixture_only',evidenceRefs:[],findings:[]};
 const reportHash=digest(report);provenance.context.qualityReports[reportHash]=report;
 provenance.context.qualityAssociations.push({schemaVersion:version,kind:'quality_association',exampleOnly:true,workspaceId:'workspace_fixture',projectId,revisionId,targetId:v.targetId,qaInputHash,qaProfileVersion:quality.profileVersion,reportHash,waiverHashes:[]});
}
const snapshot={schemaVersion:version,kind:'release_snapshot',exampleOnly:true,projectId,revisionId,snapshotId:'snapshot_fixture',confirmedAt:'2026-10-20T00:00:00Z',qualityAssociations:structuredClone(provenance.context.qualityAssociations),compositionHash:digest(composition),contentHash:digest(contentIdentity(composition)),presetRulesVersion:presets.rulesVersion,durationSeconds:30,fps:30,totalFrames:900,variants:structuredClone(composition.variants),initialTargetIds:['tiktok:portrait'],factManifestHash:digest(fact),rendererImageDigest:composition.rendererImageDigest,usagePolicy,markingProfileVersion,qaProfileVersion:quality.profileVersion};
const edit={schemaVersion:version,kind:'edit_request',exampleOnly:true,requestId:'edit_fixture',baseRevision:revisionId,comments:[{targetId:'tiktok:portrait',frameIndex:240,normalizedPoint:{x:.52,y:.38},comment:'Make the camera orbit around this interface. Preserve other shots.',editScope:'shot'}]};
const manifest={schemaVersion:version,kind:'export_manifest',exampleOnly:true,projectId,revisionId,snapshotId:snapshot.snapshotId,releaseId:'release_fixture',snapshotHash:digest(snapshot),compositionHash:digest(composition),markingProfileVersion,qaProfileVersion:quality.profileVersion,state:'rendering',initialTargetIds:[...snapshot.initialTargetIds],artifacts:['video','cover','mapping'].map(kind=>({id:kind+'_fixture',targetId:'tiktok:portrait',kind,artifactFingerprint:digest(outputArtifactIdentity(composition,composition.variants[0],kind,markingProfileVersion)),sha256:null,state:'pending'}))};
for(const [name,data] of Object.entries({composition,'release-snapshot':snapshot,'edit-request':edit,'fact-manifest':fact,'export-manifest':manifest,'resource-manifest':resources}))write('contracts/'+name+'.example.json',data);
write('tests/contracts/provenance-fixtures.json',provenance);
const envelope={protocolVersion:version,sessionId:'render_fixture',requestId:'seek_fixture',sequence:2,revisionId,targetId:'tiktok:portrait'};
write('tests/contracts/protocol-fixtures.json',{scope:'contract_only_not_runtime',valid:{
 create_project_request:{schemaVersion:version,kind:'create_project_request',exampleOnly:true,requestId:'req_create',workspaceId:'workspace_fixture',audience:'software',task:'Product launch',durationSeconds:30,targetIds:['tiktok:portrait'],requestTrial:true},
 create_project_result:{schemaVersion:version,kind:'create_project_result',requestId:'req_create',workspaceId:'workspace_fixture',projectId,trialGrantStatus:'granted'},
 checkout_request:{schemaVersion:version,kind:'checkout_request',exampleOnly:true,requestId:'req_checkout',projectId,sku:'single_export',purchaseIntent:'purchase_and_export',snapshotId:snapshot.snapshotId,consent:{disclosureId:'disclosure_fixture',acceptedItemIds:['terms']}},
 agent_request:{schemaVersion:version,kind:'agent_request',exampleOnly:true,requestId:'req_generate',baseRevision:revisionId,operation:'creative_generate',mode:'direct',instruction:'悬浮 UI 与连续运镜，使用实际素材。',targetIds:['tiktok:portrait']},
 render_init:{...envelope,sequence:1,command:'init',mode:'trusted_render',pixelScale:1,manifestHash:digest(composition),frameCount:900,width:1080,height:1920,fps:30,seed:composition.seed,renderProfile:composition.renderProfile},
 render_seek:{...envelope,command:'seek',frameIndex:240},
 render_ready:{...envelope,event:'frame-ready',frameIndex:240,manifestHash:digest(composition)},
 render_sample:{...envelope,command:'sample',frameIndex:240,sampleIndex:0},
 render_sample_ready:{...envelope,event:'sample-ready',frameIndex:240,sampleIndex:0,manifestHash:digest(composition)},
 render_error:{...envelope,event:'error',code:'FRAME_TIMEOUT'}
}});
console.log('Linked specification fixtures refreshed; no media, QA or production execution occurred.');
