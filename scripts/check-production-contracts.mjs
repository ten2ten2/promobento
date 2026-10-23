import {readFileSync} from 'node:fs';
import {load, schema, semanticErrors, targets, hasCalibratedCostLimits} from './contract-validation.mjs';
import * as contracts from '../packages/contracts/index.mjs';
import {createSchemaValidator} from '../packages/contracts/index.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const c=load('contracts/composition.example.json'),snapshot=load('contracts/release-snapshot.example.json'),factManifest=load('contracts/fact-manifest.example.json');
const failures=[],expect=(ok,message)=>{if(!ok)failures.push(message);};
for(const name of ['composition','release-snapshot','edit-request','fact-manifest','export-manifest','resource-manifest']) failures.push(...semanticErrors(load('contracts/'+name+'.example.json'),{composition:c,snapshot,factManifest,...load('tests/contracts/provenance-fixtures.json').context}).map(e=>name+': '+e));
for(const [name,value]of Object.entries(load('tests/contracts/protocol-fixtures.json').valid)) failures.push(...semanticErrors(value,{composition:c,rendererSession:name==='render_sample'||name==='render_sample_ready'}).map(e=>name+': '+e));
const routes=load('config/routes.json'),api=load('contracts/agent-api.json'),signatures=new Set();
for(const r of routes.routes){const signature=r.method+' '+r.path.replace(/:[A-Za-z][A-Za-z0-9]*/g,':param');expect(!signatures.has(signature),'Duplicate route shape: '+r.id);signatures.add(signature);}
expect(new Set(api.endpoints.map(a=>a.routeId)).size===api.endpoints.length,'Duplicate API contract route');
for(const a of api.endpoints){const r=routes.routes.find(r=>r.id===a.routeId);expect(r?.kind==='api'&&r.path===a.path&&r.method===a.method&&r.auth===a.auth,'API/route mismatch: '+a.routeId);for(const ref of [a.requestDef,a.responseDef].filter(Boolean))expect(!!schema.$defs[ref],'Missing API schema: '+ref);}
expect(!routes.routes.some(r=>/\/(storyboards|rewrites)$/.test(r.path)),'Unregistered creation model route');
const p=load('config/agent-policy.json');
const paidSkus=Object.keys(p.quota).filter(k=>Number.isSafeInteger(p.quota[k]?.priceMinor)).sort();
expect(JSON.stringify(paidSkus)===JSON.stringify(['single_export','project_pack','project_upgrade','extra_pack'].sort()),'Unexpected saleable SKU');
const expectedRights={single_export:[1900,1,0,0],project_pack:[3900,3,5,15],project_upgrade:[2000,2,5,15],extra_pack:[1200,3,2,10]};
for(const [sku,rights]of Object.entries(expectedRights))expect(JSON.stringify([p.quota[sku]?.priceMinor,p.quota[sku]?.versionUnits,p.quota[sku]?.creative_generate,p.quota[sku]?.agent_patch])===JSON.stringify(rights),'SKU price/rights mismatch: '+sku);
const checkoutShapes=schema.$defs.checkoutRequest.oneOf;
expect(JSON.stringify([...new Set(checkoutShapes.map(x=>x.properties.sku.const))].sort())===JSON.stringify(paidSkus),'Checkout schema/catalog mismatch');
const schemaIntents=checkoutShapes.map(x=>x.properties.sku.const+':'+x.properties.purchaseIntent.const).sort();
const catalogIntents=paidSkus.flatMap(sku=>p.quota[sku].allowedPurchaseIntents.map(intent=>sku+':'+intent)).sort();
expect(JSON.stringify(schemaIntents)===JSON.stringify(catalogIntents),'Checkout purchase-intent structure/catalog mismatch');
expect(p.quota.free.scope==='internal_user_lifetime'&&p.quota.free.projects===1&&p.quota.free.creative_generate===1&&p.quota.free.agent_patch===2&&p.quota.free.versionUnits===0,'Account trial allocation mismatch');
expect(p.quota.free.claimUsesActorUserId&&p.quota.free.claimActorRole==='owner'&&p.quota.free.unavailableClaimCreatesUnfundedDraft,'Trial claim authorization/result mismatch');
expect(p.patch.maxCommentsPerRound===5&&p.patch.maxTotalCommentCodePoints===4000&&schema.$defs.editRequest.properties.comments.maxItems===5,'Edit round boundary mismatch');
expect(['maxMicrosPerUserWindow','maxMicrosPerProjectWindow'].every(key=>Object.hasOwn(p.cost,key))&&p.cost.usageWindowHours===24&&p.cost.usageWindowMode==='rolling_all_actual_and_unsettled_costs','Missing all-outcome account/project cost windows');
expect(!p.enabled||hasCalibratedCostLimits(p),'Uncalibrated execution or patch-token gate enabled');
expect(p.cost.hardBudgetScope==='operation_including_all_child_calls_and_attempts'&&!p.cost.quotaReleaseResetsSpend&&!p.cost.retryOrNewOperationResetsCumulativeFailureSpend,'Cost accounting boundary mismatch');
expect(p.schemaVersion==='3.0.0'&&api.schemaVersion==='3.0.0'&&schema.$id.endsWith('/3.0.0'),'Current structural protocol mismatch');
expect(targets().length===7&&new Set(targets().map(t=>t.aspectId)).size===4,'Target/aspect invariant');
expect(p.limits.workspaceShardInstances>=4*p.limits.shardsPerRender&&p.limits.shardsPerRenderWebgl<=p.limits.workspaceShardInstances&&p.limits.workspaceShardInstances<=p.limits.globalShardInstances,'Shard concurrency cannot prepare four aspects or one WebGL render');
const modelSchema=createSchemaValidator(load('contracts/model-config.schema.json')),providers=load('config/model-providers.json'),authorization=load('config/model-authorization.json');
for(const [name,value] of Object.entries({providers,authorization}))for(const error of modelSchema(value))failures.push('model config '+name+': '+error);
failures.push(...contracts.modelConfigErrors(providers,authorization,p));
expect(p.quota.creativeConsumeAt==='usable_candidate_delivered'&&p.quota.renderConsumeAt==='initial_batch_published','Consumption boundaries changed');
const fourteen=read('docs/prd/14-production-contracts.md');
for(const name of ['factContentIdentity','contentIdentity','variantIdentity','outputArtifactIdentity','targetSourceIdentity','inheritRevisionEnvironment'])
  expect(typeof contracts[name]==='function','Missing shared contract export: '+name);
for(const term of ['UNIQUE(project_id,content_hash)','PRESET_VERSION_UNAVAILABLE'])expect(fourteen.includes(term),'Missing freeze/transaction contract: '+term);
const billing=read('docs/prd/05-waffo-billing.md');
for(const term of ['purchaseIntent','requestTrial'])expect(billing.includes(term),'Missing billing/trial contract: '+term);
expect(schema.$defs.createProjectRequest.properties.requestTrial.type==='boolean'&&!schema.$defs.createProjectRequest.required.includes('requestTrial'),'Trial request must remain an explicit optional boolean');
// The shared Ajv factory compiles every definition, including those with no fixture.
const rootRefs=schema.oneOf.map(x=>x.$ref);expect(new Set(rootRefs).size===rootRefs.length,'Duplicate root union definition');
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Production contracts passed: current protocol, linked examples, fixed targets, API registry/schema, account trial, SKU/intent, bounded edit rounds, budgets and frozen identities. Scope: reference contracts, not live services.');
