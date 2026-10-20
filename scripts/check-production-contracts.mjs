import {readFileSync} from 'node:fs';
import {load, schema, validateSchema, semanticErrors, targets, hasCalibratedCostLimits} from './contract-validation.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const c=load('contracts/composition.example.json'),snapshot=load('contracts/release-snapshot.example.json'),factManifest=load('contracts/fact-manifest.example.json');
const failures=[],expect=(ok,message)=>{if(!ok)failures.push(message);};
for(const name of ['composition','release-snapshot','edit-request','fact-manifest','export-manifest']) failures.push(...semanticErrors(load('contracts/'+name+'.example.json'),{composition:c,snapshot,factManifest}).map(e=>name+': '+e));
for(const [name,value]of Object.entries(load('tests/contracts/protocol-fixtures.json').valid)) failures.push(...semanticErrors(value,{composition:c}).map(e=>name+': '+e));
const routes=load('config/routes.json'),api=load('contracts/agent-api.json'),signatures=new Set();
for(const r of routes.routes){const signature=r.method+' '+r.path.replace(/:[A-Za-z][A-Za-z0-9]*/g,':param');expect(!signatures.has(signature),'Duplicate route shape: '+r.id);signatures.add(signature);}
for(const a of api.endpoints){const r=routes.routes.find(r=>r.id===a.routeId);expect(r&&r.path===a.path&&r.method===a.method&&r.auth===a.auth,'API/route mismatch: '+a.routeId);for(const ref of [a.requestDef,a.responseDef].filter(Boolean))expect(!!schema.$defs[ref],'Missing API schema: '+ref);}
const rows=[...read('docs/prd/04-architecture-and-data.md').matchAll(/^\| `(GET|POST|PUT|PATCH|DELETE|HEAD) (\/api\/[^`]+)` \|/gm)].map(m=>m[1]+' '+m[2]).sort();
expect(JSON.stringify(rows)===JSON.stringify(routes.routes.filter(r=>r.kind==='api').map(r=>r.method+' '+r.path).sort()),'API registry/PRD mismatch');
const section=read('docs/prd/02-ux-and-flows.md').split('## 2 首页与首次进入')[0];
const pages=[...new Set(section.split('\n').filter(l=>l.startsWith('| ')).flatMap(l=>[...(l.split('|')[1]??'').matchAll(/`(\/[^`]*)`/g)].map(m=>m[1])))].sort();
expect(JSON.stringify(pages)===JSON.stringify(routes.routes.filter(r=>r.kind!=='api').map(r=>r.path).sort()),'Page registry/PRD mismatch');
expect(!routes.routes.some(r=>/\/(storyboards|rewrites)$/.test(r.path)),'Unregistered creation model route');
const p=load('config/agent-policy.json');
const paidSkus=Object.keys(p.quota).filter(k=>Number.isSafeInteger(p.quota[k]?.priceMinor)).sort();
expect(JSON.stringify(paidSkus)===JSON.stringify(['single_export','project_pack','project_upgrade','extra_pack'].sort()),'Unexpected saleable SKU');
const expectedRights={single_export:[1900,1,0,0],project_pack:[3900,3,5,15],project_upgrade:[2000,2,5,15],extra_pack:[1200,3,2,10]};
for(const [sku,rights]of Object.entries(expectedRights))expect(JSON.stringify([p.quota[sku]?.priceMinor,p.quota[sku]?.versionUnits,p.quota[sku]?.creative_generate,p.quota[sku]?.agent_patch])===JSON.stringify(rights),'SKU price/rights mismatch: '+sku);
expect(JSON.stringify([...schema.$defs.checkoutRequest.properties.sku.enum].sort())===JSON.stringify(paidSkus),'Checkout schema/catalog mismatch');
expect(p.quota.free.scope==='internal_user_lifetime'&&p.quota.free.projects===1&&p.quota.free.creative_generate===1&&p.quota.free.agent_patch===2&&p.quota.free.versionUnits===0,'Account trial allocation mismatch');
expect(p.quota.free.claimUsesActorUserId&&p.quota.free.claimActorRole==='owner'&&p.quota.free.unavailableClaimCreatesUnfundedDraft,'Trial claim authorization/result mismatch');
expect(p.patch.maxCommentsPerRound===5&&p.patch.maxTotalCommentCodePoints===4000&&schema.$defs.editRequest.properties.comments.maxItems===5,'Edit round boundary mismatch');
expect(['maxMicrosPerUserWindow','maxMicrosPerProjectWindow'].every(key=>Object.hasOwn(p.cost,key))&&p.cost.usageWindowHours===24&&p.cost.usageWindowMode==='rolling_all_actual_and_unsettled_costs','Missing all-outcome account/project cost windows');
expect(!p.enabled||hasCalibratedCostLimits(p),'Uncalibrated execution or patch-token gate enabled');
expect(p.cost.hardBudgetScope==='operation_including_all_child_calls_and_attempts'&&!p.cost.quotaReleaseResetsSpend&&!p.cost.retryOrNewOperationResetsCumulativeFailureSpend,'Cost accounting boundary mismatch');
expect(p.schemaVersion==='2.3.0'&&api.schemaVersion==='2.3.0'&&schema.$id.endsWith('/2.3.0'),'Current structural protocol mismatch');
expect(targets().length===7&&p.limits.globalContainers===4,'Target/resource invariant');
expect(p.quota.creativeConsumeAt==='usable_candidate_delivered'&&p.quota.renderConsumeAt==='initial_batch_published','Consumption boundaries changed');
const fourteen=read('docs/prd/14-production-contracts.md');
for(const term of ['factContentIdentity','contentIdentity','variantIdentity','outputArtifactIdentity','coverFrame','layoutRulesHash','targetOverrideHash','UNIQUE(project_id,content_hash)','PRESET_VERSION_UNAVAILABLE','purchaseIntent','requestTrial'])expect(fourteen.includes(term),'Missing identity/transaction contract: '+term);
for(const file of ['05-waffo-billing.md','11-ui-design-spec.md'])expect(read('docs/prd/'+file).includes('contentHash'),'Content-based billing/UI rule missing: '+file);
// Verify every local schema definition reference, including those not used by examples.
function refs(node){if(!node||typeof node!=='object')return;if(node.$ref)expect(node.$ref.startsWith('#/$defs/')&&!!schema.$defs[node.$ref.slice(8)],'Unresolved schema reference: '+node.$ref);for(const value of Object.values(node))if(value&&typeof value==='object')refs(value);}
refs(schema);
const rootRefs=schema.oneOf.map(x=>x.$ref);expect(new Set(rootRefs).size===rootRefs.length,'Duplicate root union definition');
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Production contracts passed: current protocol, linked examples, fixed targets, API/docs, account trial, SKU/intent, bounded edit rounds, budgets and frozen identities. Scope: reference contracts, not live services.');
