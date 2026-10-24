// Synthetic authorization/QA records for contract checks, not real clearance or a rendered acceptance.
import {readFileSync} from 'node:fs';
import {canonical,digest,createFilmComposition,filmBuildReceipt,contentIdentity,qaInputIdentity,factVersionKey} from '../../packages/contracts/index.mjs';
import {sha256Bytes} from '../../packages/contracts/src/digest.mjs';
import {filmTextBindings} from '../../packages/contracts/src/film.mjs';
import {filmFixture} from '../../packages/film-runtime/test/fixture.mjs';
import {parseCanonicalJson} from '../../packages/contracts/src/canonical.mjs';
const read=path=>parseCanonicalJson(readFileSync(new URL('../../'+path,import.meta.url)));

export function filmContractFixture({exampleOnly=true}={}){
 const presetConfig=read('config/platform-presets.json'),film=filmFixture(),filmSource=canonical(film),product=readFileSync(new URL('../../apps/render-container/tests/product.svg',import.meta.url));
 const projectId='proj_film_fixture',revisionId='rev_film_fixture',workspaceId='workspace_fixture';
 const resource={path:'r/res_fixture_dashboard',sha256:sha256Bytes(product),byteLength:product.length,mediaType:'image/svg+xml',licenseRef:'rights_original_fixture'};
 const resourceManifest={schemaVersion:'3.0.0',kind:'resource_manifest',exampleOnly,resources:[resource],audioEvents:[],mixedAudio:null};
 const factManifest={schemaVersion:'3.0.0',kind:'fact_manifest',exampleOnly,projectId,revisionId,
  facts:[{factId:'fixture-cta',version:1,text:film.texts.cta.text,confirmedBy:'fixture_owner',confirmedAt:'2026-10-20T00:00:00Z',evidenceRefs:['fixture_original_cta']}],bindings:[]};
 const all=presetConfig.presets.flatMap(p=>[p.defaultAspect,...p.optionalAspects].map(aspect=>p.id+':'+aspect));
 factManifest.bindings=all.flatMap((targetId,index)=>filmTextBindings(film).filter(b=>b.factIds.length).map(b=>({bindingId:'binding_film_'+index,targetId,
  frameStart:b.frameStart,frameEndExclusive:b.frameEndExclusive,expectedText:b.text,factIds:b.factIds,coverage:'declared'})));
 const dependencyManifest={kind:'fixture_dependencies',runtimeVersion:'film-runtime-v1',blocks:['hook-title@1','ui-showcase@1','cta-endcard@1']};
 const input={filmSource,resourceManifest,factManifest,dependencyManifest,presetConfig,exampleOnly,projectId,revisionId,seed:'film-fixture-1',runtimeVersion:'film-runtime-v1',
  rendererImageDigest:'sha256:'+digest('fixture-only-renderer'),renderProfile:presetConfig.renderProfiles.standard};
 const composition=createFilmComposition(input),reportProfile='qa-film-fixture',reportVersion='fixture-checker',qualityReports={},qualityAssociations=[];
 for(const variant of composition.variants){
  const qaInputHash=digest(qaInputIdentity(composition,variant,reportProfile,presetConfig)),report={schemaVersion:'3.0.0',kind:'quality_report',exampleOnly,
   workspaceId,projectId,targetId:variant.targetId,qaProfileVersion:reportProfile,qaInputHash,checkerVersion:reportVersion,coverage:'sampled',evidenceRefs:['synthetic_evidence'],findings:[]};
  const reportHash=digest(report);qualityReports[reportHash]=report;
  qualityAssociations.push({schemaVersion:'3.0.0',kind:'quality_association',exampleOnly,workspaceId,projectId,revisionId,targetId:variant.targetId,
   qaInputHash,qaProfileVersion:reportProfile,reportHash,waiverHashes:[]});
 }
 const snapshot={schemaVersion:'3.0.0',kind:'release_snapshot',exampleOnly,projectId,revisionId,snapshotId:'snapshot_film_fixture',confirmedAt:'2026-10-20T00:00:00Z',
  qualityAssociations,compositionHash:digest(composition),contentHash:digest(contentIdentity(composition)),presetRulesVersion:presetConfig.rulesVersion,
  durationSeconds:15,fps:30,totalFrames:450,variants:structuredClone(composition.variants),initialTargetIds:['tiktok:portrait'],factManifestHash:digest(factManifest),
  rendererImageDigest:composition.rendererImageDigest,usagePolicy:{termsVersion:'terms-fixture-1',rightsPolicyVersion:'rights-fixture-1',intendedUse:'commercial_export',
   licenseVersions:[{licenseRef:resource.licenseRef,recordVersion:'1'}]},markingProfileVersion:'marking-fixture-1',qaProfileVersion:reportProfile};
 const build=filmBuildReceipt(filmSource),fact=factManifest.facts[0],hash=digest(resourceManifest);
 const context={production:!exampleOnly,composition,snapshot,filmSource,resourceManifest,presetConfig,factManifest,workspaceId,projectId,intendedUse:'preview',now:Date.parse('2026-10-24T00:00:00Z'),
  sourceBuilds:Object.fromEntries(composition.variants.map(v=>[v.targetId,structuredClone(build)])),sourceArchiveFiles:build.files,
  resourceManifests:{[hash]:resourceManifest},resourceObservations:{[hash]:{resources:[{path:resource.path,sha256:resource.sha256}],audioEvents:[],mixedAudio:null}},
  assetBindings:{[resource.sha256]:resource.licenseRef},licenseVersions:{[resource.licenseRef]:'1'},
  licenseRegistry:{[resource.licenseRef]:{'1':{exampleOnly,assetHash:resource.sha256,scope:'platform',basis:'platform_created',evidenceHash:digest('synthetic_rights_record'),allowedUses:['preview','commercial_export']}}},
  usagePolicies:{'rights-fixture-1':{exampleOnly,termsVersion:'terms-fixture-1',allowedUses:['commercial_export']}},
  markingProfiles:{'marking-fixture-1':{exampleOnly,decisionRef:'synthetic_marking_decision',machineMarking:'not_applicable',audienceDisclosure:'not_applicable'}},
  facts:{[fact.factId]:{workspaceId,projectId,version:fact.version,textHash:digest(fact.text),confirmation:{confirmedBy:fact.confirmedBy,confirmedAt:fact.confirmedAt}}},
  factRevocations:{},claimKinds:{[factVersionKey(projectId,fact)]:'general'},evidenceRegistry:{fixture_original_cta:{exampleOnly,workspaceId,projectId,sourceHash:digest('synthetic_original_copy'),factTextHash:digest(fact.text),kind:'source'}},
  qaProfileVersion:reportProfile,qaProfiles:{[reportProfile]:{exampleOnly,checkerVersion:reportVersion}},qualityReports,qualityAssociations};
 return {film,filmSource,input,composition,resourceManifest,factManifest,snapshot,context};
}
