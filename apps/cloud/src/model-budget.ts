import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {validate} from '@promobento/contracts/validators/model-spend';
import {validate as validAuthorization} from '@promobento/contracts/validators/model-config';
import authorization from '../../../config/model-authorization.json';
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
