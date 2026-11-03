import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {validate} from '@promobento/contracts/validators/model-spend';
import {validate as validAuthorization} from '@promobento/contracts/validators/model-config';
import authorization from '../../../config/model-authorization.json' with {type:'json'};
import {getJson,settle} from './store.ts';
import type {PipelineEnv,Json} from './pipeline-types.ts';

// Catalog/bindings may change within a grant. They must not create a fresh spending allowance.
export const modelAuthorizationId=digest({approvedBy:authorization.approvedBy,approvedAt:authorization.approvedAt});
const ledger=(env:PipelineEnv)=>{if(!env.MODEL_LEDGER)throw Error('MODEL_LEDGER_UNAVAILABLE');return env.MODEL_LEDGER;};
export const modelBudgetId=(origin:string,callId:string)=>digest({authorizationId:modelAuthorizationId,origin,callId});
/** A dated owner risk allowance, not a reconciliation and never a new grant or a zero opening. */
function budgetBasis(env:PipelineEnv,opening:Json|null){
 if(!validAuthorization(authorization))throw Error('MODEL_AUTHORIZATION_INVALID');
 if(!opening)return null;
 if(opening.total_micros!==null)return{mode:'confirmed',historyMicros:opening.total_micros,limitMicros:authorization.maxUsdMicros,expiresAt:Date.parse(authorization.expiresAt)};
 const allowance=authorization.unreconciledHistoryAllowance;
 if(!allowance||env.PIPELINE_ENVIRONMENT!==allowance.environment||opening.manifest_hash!==allowance.openingManifestHash
  ||Date.now()>=Date.parse(allowance.expiresAt)||Date.parse(allowance.expiresAt)>Date.parse(authorization.expiresAt)
  ||allowance.historyReserveUsdMicros+allowance.newSpendCapUsdMicros>authorization.maxUsdMicros)return null;
 return{mode:'provisional',historyMicros:allowance.historyReserveUsdMicros,
  limitMicros:allowance.historyReserveUsdMicros+allowance.newSpendCapUsdMicros,expiresAt:Date.parse(allowance.expiresAt)};
}

export async function importModelOpening(env:PipelineEnv,value:Json){
 if(!validate(value)||value.kind!=='historical_model_spend'||value.authorizationId!==modelAuthorizationId
  ||new Set(value.entries.map((entry:Json)=>entry.id)).size!==value.entries.length)throw Error('MODEL_OPENING_INVALID');
 const text=canonical(value),hash=digest(value),DB=ledger(env);
 await DB.prepare('INSERT OR IGNORE INTO model_budget_openings(authorization_id,manifest_hash,manifest_json,created_at) VALUES(?,?,?,?)')
  .bind(modelAuthorizationId,hash,text,Date.now()).run();
 const previous=await DB.prepare('SELECT manifest_json FROM model_budget_openings WHERE authorization_id=?').bind(modelAuthorizationId).first<Json>();
 if(previous?.manifest_json!==text)throw Error('MODEL_OPENING_CONFLICT');
 return modelBudgetStatus(env);
}
/** A caller submits only an immutable owner evidence object, never a computed "zero" default. */
export async function confirmModelOpening(env:PipelineEnv,value:Json){
 if(!validate(value)||value.kind!=='model_spend_confirmation'||value.authorizationId!==modelAuthorizationId)throw Error('MODEL_CONFIRMATION_INVALID');
 const DB=ledger(env),text=canonical(value);
 const result=await DB.prepare('UPDATE model_budget_openings SET total_micros=?,confirmation_json=? WHERE authorization_id=? AND manifest_hash=? AND confirmation_json IS NULL')
  .bind(value.totalUsdMicros,text,modelAuthorizationId,value.openingManifestHash).run();
 if(result.meta.changes!==1){
  const previous=await DB.prepare('SELECT confirmation_json FROM model_budget_openings WHERE authorization_id=?').bind(modelAuthorizationId).first<Json>();
  if(previous?.confirmation_json!==text)throw Error('MODEL_CONFIRMATION_CONFLICT');
 }
 return modelBudgetStatus(env);
}
export async function modelBudgetStatus(env:PipelineEnv){
 const DB=ledger(env),opening=await DB.prepare('SELECT * FROM model_budget_openings WHERE authorization_id=?').bind(modelAuthorizationId).first<Json>();
 const spend=await DB.prepare('SELECT COALESCE(SUM(COALESCE(s.actual_micros,r.reserved_micros)),0) AS charged,COUNT(*) AS reservations FROM model_budget_reservations r LEFT JOIN model_budget_settlements s ON s.reservation_id=r.id WHERE r.authorization_id=?')
  .bind(modelAuthorizationId).first<Json>();
 const pending=await DB.prepare('SELECT r.id,r.origin,r.operation_id,r.reserved_micros,r.dispatched_at FROM model_budget_reservations r LEFT JOIN model_budget_settlements s ON s.reservation_id=r.id WHERE r.authorization_id=? AND s.reservation_id IS NULL')
  .bind(modelAuthorizationId).all<Json>();
 const entries=opening?(parseCanonicalJson(opening.manifest_json) as Json).entries as Json[]:[];
 const basis=budgetBasis(env,opening),allowance=authorization.unreconciledHistoryAllowance;
 return{authorizationId:modelAuthorizationId,limitMicros:authorization.maxUsdMicros,openingManifestHash:opening?.manifest_hash??null,
  openingCreatedAt:opening?.created_at??null,openingConfirmed:opening?.confirmation_json!==null&&opening?.confirmation_json!==undefined,
  openingMicros:opening?.total_micros??null,recordedHistoricalCalls:entries.length,
  historicalCatalogEstimateMicros:entries.reduce((sum,entry)=>sum+(entry.quote?.usdMicros??0),0),unpricedHistoricalCalls:entries.filter(entry=>entry.quote===null).map(entry=>entry.id),
  budgetBasis:basis?.mode??'unconfirmed',budgetedHistoryMicros:basis?.historyMicros??null,admissionLimitMicros:basis?.limitMicros??null,
  historyAllowance:allowance?{...allowance,active:basis?.mode==='provisional'}:null,
  currentReservations:Number(spend?.reservations??0),currentChargedMicros:Number(spend?.charged??0),pending:pending.results};
}
export async function assertModelBudgetReady(env:PipelineEnv){
 const row=await ledger(env).prepare('SELECT * FROM model_budget_openings WHERE authorization_id=?').bind(modelAuthorizationId).first<Json>();
 const basis=budgetBasis(env,row);if(!basis)throw Error('MODEL_HISTORY_RECONCILIATION_REQUIRED');
 return{...basis,manifestHash:row!.manifest_hash};
}
/** This INSERT is the cross-environment serialization point. Local operation budgets remain separate. */
export async function reserveModelBudget(env:PipelineEnv,callId:string,operationId:string,max:number,request:unknown,catalogVersion:string){
 const origin=env.PIPELINE_ENVIRONMENT;if(!['staging','production','offline'].includes(origin))throw Error('MODEL_LEDGER_ORIGIN_INVALID');
 if(!Number.isSafeInteger(max)||max<0)throw Error('COST_RESERVATION_INVALID');
 const basis=await assertModelBudgetReady(env);
 const DB=ledger(env),id=modelBudgetId(origin,callId),hash=digest(request);
 const previous=await DB.prepare('SELECT request_hash,operation_id,reserved_micros,catalog_version FROM model_budget_reservations WHERE id=?').bind(id).first<Json>();
 if(previous){if(previous.request_hash!==hash||previous.operation_id!==operationId||previous.reserved_micros!==max||previous.catalog_version!==catalogVersion)throw Error('IDEMPOTENCY_CONFLICT');throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');}
 const result=await DB.prepare(`INSERT INTO model_budget_reservations(id,authorization_id,origin,operation_id,call_id,request_hash,reserved_micros,catalog_version,created_at)
  SELECT ?,?,?,?,?,?,?,?,? WHERE ? < ? AND EXISTS(SELECT 1 FROM model_budget_openings WHERE authorization_id=? AND manifest_hash=?
   AND ((?='confirmed' AND total_micros=?) OR (?='provisional' AND total_micros IS NULL)))
  AND ? +
  (SELECT COALESCE(SUM(COALESCE(s.actual_micros,r.reserved_micros)),0) FROM model_budget_reservations r LEFT JOIN model_budget_settlements s ON s.reservation_id=r.id WHERE r.authorization_id=?) + ? <= ?`)
  .bind(id,modelAuthorizationId,origin,operationId,callId,hash,max,catalogVersion,Date.now(),Date.now(),basis.expiresAt,
    modelAuthorizationId,basis.manifestHash,basis.mode,basis.historyMicros,basis.mode,basis.historyMicros,modelAuthorizationId,max,basis.limitMicros).run();
 if(result.meta.changes!==1)throw Error('MODEL_AUTHORIZATION_BUDGET_EXHAUSTED');return id;
}
export async function markModelDispatched(env:PipelineEnv,id:string){
 const result=await ledger(env).prepare('UPDATE model_budget_reservations SET dispatched_at=? WHERE id=? AND dispatched_at IS NULL AND NOT EXISTS(SELECT 1 FROM model_budget_settlements WHERE reservation_id=?)')
  .bind(Date.now(),id,id).run();if(result.meta.changes!==1)throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');
}
/** Only the same execution that marked dispatch, and has not invoked the provider, may undo its own marker. */
export async function undoUnsentModelDispatch(env:PipelineEnv,id:string){
 const result=await ledger(env).prepare('UPDATE model_budget_reservations SET dispatched_at=NULL WHERE id=? AND dispatched_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM model_budget_settlements WHERE reservation_id=?)')
  .bind(id,id).run();if(result.meta.changes!==1)throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');
}
/** A committed shared zero settlement can repair a lost local admission/cleanup acknowledgement. */
export async function modelUnsentReceipt(env:PipelineEnv,id:string,operationId:string,requestHash:string):Promise<Json|null>{
 const row=await ledger(env).prepare(`SELECT r.origin,r.operation_id,r.request_hash,r.dispatched_at,s.actual_micros,s.receipt_json
  FROM model_budget_reservations r JOIN model_budget_settlements s ON s.reservation_id=r.id WHERE r.id=?`).bind(id).first<Json>();
 if(!row||row.dispatched_at!==null||row.actual_micros!==0)return null;
 if(row.origin!==env.PIPELINE_ENVIRONMENT||row.operation_id!==operationId||row.request_hash!==requestHash)throw Error('MODEL_RECEIPT_CONFLICT');
 const receipt=parseCanonicalJson(row.receipt_json) as Json;
 return receipt.kind==='not_dispatched'?receipt:null;
}

/** Keep normal completion and terminal recovery byte-identical in the local ledger. */
export function modelReceiptUsage(receipt:Json){
 return{model:receipt.model,usage:receipt.result.usage,quote:receipt.quote,
  firstTokenMs:receipt.result.firstTokenMs,totalMs:receipt.result.totalMs,
  ...(receipt.directingMethod?{directingMethod:receipt.directingMethod}:{}),
  ...(receipt.requestSettings?{requestSettings:receipt.requestSettings}:{})};
}

/** A frozen receipt is accounting evidence, not permission to run or cache its output. */
async function reconcileCompletedModelCost(env:PipelineEnv,operationId:string,row:{id:string;request_hash:string;catalog_version:string}){
 const suffix=digest({callId:row.id}),key=`operations/${operationId}/model-calls/${suffix}.json`;
 const head=await env.MEDIA.head(key);if(!head)return false;
 if(!/^[a-f0-9]{64}$/.test(head.customMetadata?.sha256??''))throw Error('MODEL_RECEIPT_CONFLICT');
 const receipt=await getJson(env,key),id=modelBudgetId(env.PIPELINE_ENVIRONMENT,row.id);
 const shared=await ledger(env).prepare(`SELECT authorization_id,origin,operation_id,call_id,request_hash,catalog_version,dispatched_at
  FROM model_budget_reservations WHERE id=?`).bind(id).first<Json>();
 if(!shared||shared.authorization_id!==modelAuthorizationId||shared.origin!==env.PIPELINE_ENVIRONMENT
  ||shared.operation_id!==operationId||shared.call_id!==row.id||shared.request_hash!==row.request_hash
  ||shared.catalog_version!==row.catalog_version||receipt.kind!=='metered_model_response'
  ||receipt.callId!==row.id||receipt.requestHash!==row.request_hash||receipt.budgetId!==id
  ||typeof receipt.model!=='string'||!/^[-a-z0-9_.]+\/[-a-zA-Z0-9_.]+$/.test(receipt.model))throw Error('MODEL_RECEIPT_CONFLICT');
 if(shared.dispatched_at===null||!receipt.quote||!receipt.result||receipt.result.streamComplete===false)return false;
 const quote=receipt.quote,count=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
 if(!count(quote.usdMicros)||!count(quote.currencyMicros)||!['USD','CNY'].includes(quote.currency)
  ||!Number.isFinite(quote.usdRate)||quote.usdRate<=0||quote.catalogVersion!==row.catalog_version
  ||!quote.prices||Array.isArray(quote.prices)||!count(quote.prices.input)||!count(quote.prices.output)
  ||Object.values(quote.prices).some(value=>!count(value)))throw Error('MODEL_RECEIPT_CONFLICT');
 // Read at most the adapter's 16 MiB stream ceiling. Both its immutable bytes
 // and final usage must agree with the receipt before a held cost is released.
 const source=receipt.rawStreamRef;
 if(!source||source.key!==`operations/${operationId}/model-streams/${suffix}.sse`
  ||!count(source.byteLength)||source.byteLength===0||source.byteLength>16<<20
  ||!/^[a-f0-9]{64}$/.test(source.sha256??''))throw Error('MODEL_RECEIPT_CONFLICT');
 const object=await env.MEDIA.get(source.key);if(!object)return false;
 if(object.size!==source.byteLength||object.customMetadata?.sha256!==source.sha256)throw Error('SOURCE_IDENTITY_MISMATCH');
 const bytes=new Uint8Array(await object.arrayBuffer());
 if(bytes.length!==source.byteLength||sha256Bytes(bytes)!==source.sha256)throw Error('SOURCE_IDENTITY_MISMATCH');
 const kind=receipt.requestSettings?.providerKind;
 if(!['openai-compatible','anthropic'].includes(kind))throw Error('MODEL_RECEIPT_CONFLICT');
 let complete=false,usage:Json|null=null;
 for(const line of new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes).split('\n')){
  if(!line.startsWith('data:'))continue;
  const value=line.slice(5).trim();
  if(value==='[DONE]'){if(kind==='openai-compatible')complete=true;continue;}
  const event=parseCanonicalJson(value) as Json;
  if(kind==='openai-compatible'){if(event.usage)usage=event.usage;}
  else{
   if(event.type==='message_start')usage={...event.message.usage};
   if(event.type==='message_delta')usage={...usage,...event.usage};
   if(event.type==='message_stop')complete=true;
  }
 }
 if(!complete||!usage||canonical(usage)!==canonical(receipt.result.usage))throw Error('MODEL_RECEIPT_CONFLICT');
 // Never reprice an old call against today's routes, grant expiry, or catalog.
 await settleModelBudget(env,id,quote.usdMicros,receipt);
 await settle(env,row.id,quote.usdMicros,modelReceiptUsage(receipt));
 return true;
}

/** Terminal operations cannot re-enter modelStep. Recover only immutable,
 * source-verified completed bills or shared-ledger-proven never-dispatched calls. */
export async function reconcileModelCosts(env:PipelineEnv,operationId:string){
 const operation=await env.DB.prepare('SELECT status FROM pipeline_operations WHERE id=?').bind(operationId).first<{status:string}>();
 if(!operation||!['failed','cancelled'].includes(operation.status))throw Error('OPERATION_NOT_TERMINAL');
 const pending=await env.DB.prepare(`SELECT r.id,r.request_hash,r.catalog_version FROM cost_reservations r
  LEFT JOIN cost_settlements s ON s.reservation_id=r.id
  WHERE r.operation_id=? AND r.kind='model' AND s.reservation_id IS NULL`).bind(operationId).all<{id:string;request_hash:string;catalog_version:string}>();
 let settled=0;
 for(const row of pending.results){
  const receipt=await modelUnsentReceipt(env,modelBudgetId(env.PIPELINE_ENVIRONMENT,row.id),operationId,row.request_hash);
  if(receipt){await settle(env,row.id,0,receipt);settled++;}
  else if(await reconcileCompletedModelCost(env,operationId,row))settled++;
 }
 // Shared admission can commit before its acknowledgement is lost, leaving no
 // local row at all. The terminal fence prevents a later local INSERT; the
 // shared CAS below races the dispatch marker without ever clearing a sent call.
 if(env.MODEL_LEDGER){
  const DB=ledger(env),orphans=await DB.prepare(`SELECT r.id,r.call_id,r.request_hash FROM model_budget_reservations r
   LEFT JOIN model_budget_settlements s ON s.reservation_id=r.id
   WHERE r.authorization_id=? AND r.origin=? AND r.operation_id=? AND r.dispatched_at IS NULL AND s.reservation_id IS NULL`)
   .bind(modelAuthorizationId,env.PIPELINE_ENVIRONMENT,operationId).all<{id:string;call_id:string;request_hash:string}>();
  for(const row of orphans.results){
   if(row.id!==modelBudgetId(env.PIPELINE_ENVIRONMENT,row.call_id))throw Error('MODEL_RECEIPT_CONFLICT');
   if(await env.DB.prepare('SELECT id FROM cost_reservations WHERE id=?').bind(row.call_id).first())continue;
   const receipt=canonical({kind:'not_dispatched',callId:row.call_id,requestHash:row.request_hash,
    reason:'The terminal operation stopped before local model admission.'});
   const result=await DB.prepare(`INSERT OR IGNORE INTO model_budget_settlements(reservation_id,actual_micros,receipt_json,settled_at)
    SELECT id,0,?,? FROM model_budget_reservations WHERE id=? AND authorization_id=? AND origin=? AND operation_id=?
     AND dispatched_at IS NULL AND NOT EXISTS(SELECT 1 FROM model_budget_settlements WHERE reservation_id=?)`)
    .bind(receipt,Date.now(),row.id,modelAuthorizationId,env.PIPELINE_ENVIRONMENT,operationId,row.id).run();
   settled+=result.meta.changes;
  }
 }
 return settled;
}
export async function settleModelBudget(env:PipelineEnv,id:string,actual:number,receipt:Json,{notDispatched=false}={}){
 if(!Number.isSafeInteger(actual)||actual<0||notDispatched&&actual!==0)throw Error('COST_SETTLEMENT_INVALID');
 const DB=ledger(env),text=canonical(receipt);
 // A pre-dispatch failure may release its reservation; an uncertain HTTP failure may not.
 await DB.prepare(`INSERT OR IGNORE INTO model_budget_settlements(reservation_id,actual_micros,receipt_json,settled_at)
  SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM model_budget_reservations WHERE id=? AND dispatched_at IS ${notDispatched?'':'NOT '}NULL)`)
  .bind(id,actual,text,Date.now(),id).run();
 const previous=await DB.prepare('SELECT actual_micros,receipt_json FROM model_budget_settlements WHERE reservation_id=?').bind(id).first<Json>();
 if(previous?.actual_micros!==actual||previous.receipt_json!==text)throw Error('COST_SETTLEMENT_CONFLICT');
}
