// Rebuild linked, deliberately non-production contract examples. No media is rendered.
import {writeFileSync} from 'node:fs';
import {targets,digest,factContentIdentity,contentIdentity,variantIdentity,outputArtifactIdentity,presets} from './contract-validation.mjs';
const write=(p,v)=>writeFileSync(new URL('../'+p,import.meta.url),JSON.stringify(v)+'\n');
const version='2.2.1',projectId='proj_fixture',revisionId='rev_fixture_22';
const all=targets();
const fact={schemaVersion:version,kind:'fact_manifest',exampleOnly:true,projectId,revisionId,
 facts:[{factId:'fact_name',version:1,text:'Sample / 示例产品',confirmedBy:'user_fixture',confirmedAt:'2026-10-20T00:00:00Z',evidenceRefs:['asset_fixture']}],
 bindings:all.map((t,i)=>({bindingId:'binding_title_'+i,targetId:t.targetId,frameStart:0,frameEndExclusive:900,expectedText:'Sample / 示例产品',factIds:['fact_name'],coverage:'declared'}))};
const composition={schemaVersion:version,kind:'composition',exampleOnly:true,projectId,revisionId,
 durationSeconds:30,fps:30,totalFrames:900,seed:'fixture-22',sourceArchiveHash:digest('fixture-runtime-source'),dependencyManifestHash:digest('fixture-dependencies'),resourceManifestHash:digest('fixture-resources'),factManifestHash:digest(fact),factContentHash:digest(factContentIdentity(fact)),runtimeVersion:'runtime-fixture',rendererImageDigest:'sha256:'+digest('fixture-renderer'),presetRulesVersion:presets.rulesVersion,releaseEligible:true,
 variants:all.map(t=>({targetId:t.targetId,presetId:t.presetId,aspectId:t.aspectId,presetVersion:t.version,entrypoint:'src/'+t.aspectId+'.html',sourceHash:digest('fixture-code-'+t.aspectId),resourceManifestHash:digest('fixture-resources'),audioHash:digest('fixture-silent-audio-spec'),variantHash:'0'.repeat(64),coverFrame:240,qaReportHash:digest('fixture-only-qa-'+t.targetId)})),
 styleLabel:'自定义云墨 Shader',textMetadata:[{language:'mul',direction:'ltr',label:'mixed original text'}]};
for(const v of composition.variants)v.variantHash=digest(variantIdentity(composition,v));
const snapshot={schemaVersion:version,kind:'release_snapshot',exampleOnly:true,projectId,revisionId,snapshotId:'snapshot_fixture',compositionHash:digest(composition),contentHash:digest(contentIdentity(composition)),presetRulesVersion:presets.rulesVersion,durationSeconds:30,fps:30,totalFrames:900,variants:structuredClone(composition.variants),initialTargetIds:['tiktok:portrait'],factManifestHash:composition.factManifestHash,rendererImageDigest:composition.rendererImageDigest};
const edit={schemaVersion:version,kind:'edit_request',exampleOnly:true,requestId:'edit_fixture',baseRevision:revisionId,targetId:'tiktok:portrait',frameIndex:240,normalizedPoint:{x:.52,y:.38},comment:'Make the camera orbit around this interface. Preserve other shots.',editScope:'shot'};
const manifest={schemaVersion:version,kind:'export_manifest',exampleOnly:true,projectId,revisionId,snapshotId:snapshot.snapshotId,releaseId:'release_fixture',snapshotHash:digest(snapshot),compositionHash:digest(composition),state:'rendering',initialTargetIds:[...snapshot.initialTargetIds],artifacts:['video','cover','mapping'].map(kind=>({id:kind+'_fixture',targetId:'tiktok:portrait',kind,artifactFingerprint:digest(outputArtifactIdentity(composition,composition.variants[0],kind)),sha256:null,state:'pending'}))};
for(const [name,data] of Object.entries({composition,'release-snapshot':snapshot,'edit-request':edit,'fact-manifest':fact,'export-manifest':manifest}))write('contracts/'+name+'.example.json',data);
const envelope={protocolVersion:version,sessionId:'render_fixture',requestId:'seek_fixture',sequence:2,revisionId,targetId:'tiktok:portrait'};
write('tests/contracts/protocol-fixtures.json',{scope:'contract_only_not_runtime',valid:{
 agent_request:{schemaVersion:version,kind:'agent_request',exampleOnly:true,requestId:'req_generate',baseRevision:revisionId,operation:'creative_generate',mode:'direct',instruction:'悬浮 UI 与连续运镜，使用实际素材。',targetIds:['tiktok:portrait']},
 render_init:{...envelope,sequence:1,command:'init',manifestHash:digest(composition),frameCount:900,width:1080,height:1920,fps:30,seed:composition.seed},
 render_seek:{...envelope,command:'seek',frameIndex:240},
 render_ready:{...envelope,event:'frame-ready',frameIndex:240,manifestHash:digest(composition)},
 render_error:{...envelope,event:'error',code:'FRAME_TIMEOUT'}
}});
console.log('Linked specification fixtures refreshed; no media, QA or production execution occurred.');
