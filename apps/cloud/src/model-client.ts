import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {modelCallCostMicros,modelUsageQuote} from '../../../packages/contracts/src/models.mjs';
import {providerRequest, streamModel, ModelOutputError, parseModelJson, type ModelRequest} from '../../../packages/models/src/adapters.mjs';
import providersInput from '../../../config/model-providers.json';
import authorization from '../../../config/model-authorization.json';
import policyInput from '../../../config/agent-policy.json';
import {operation, reserve, settle, getJson, immutableJson} from './store.ts';
import {assertModelBudgetReady,reserveModelBudget,markModelDispatched,settleModelBudget,modelBudgetId} from './model-budget.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';

const providers: Json=providersInput, policy: Json=policyInput;
/** A complete, durably recorded response whose text is not canonical JSON; never a transport failure. */
export class ModelJsonOutputError extends Error {constructor(code='MODEL_OUTPUT_JSON_INVALID'){super(code);}}
export async function modelStep(env: PipelineEnv, operationId: string, generation: number, stage: string, callId: string,
  request: Omit<ModelRequest,'provider'|'model'|'effort'>, validate: (value: Json) => void, deadlineAt = Date.now()+policy.limits.requestTimeoutMs) {
  if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
  const op=await operation(env,operationId,generation), ref=providers.steps[stage], model=providers.models[ref], provider=providers.providers[ref?.split('/')[0]];
  if(!ref||!model?.capabilities.verified||!authorization.models.includes(ref)||!authorization.purposes.includes(op.purpose)
    ||Date.now()>=Date.parse(authorization.expiresAt)||providers.catalogVersion!==authorization.catalogVersion)throw Error('MODEL_NOT_AUTHORIZED');
  const secret=provider.secret==='ANTHROPIC_API_KEY'?env.ANTHROPIC_API_KEY:env.MODEL_COMPAT_API_KEY;
  if(!secret)throw Error('MODEL_SECRET_MISSING');
  const limits=policy.director.steps[stage];
  if(!limits)throw Error('MODEL_STAGE_UNKNOWN');
  if(request.messages.some(message=>message.images?.length)&&!model.capabilities.vision)throw Error('MODEL_VISION_UNAVAILABLE');
  if(request.tools?.length&&!model.capabilities.tools)throw Error('MODEL_TOOLS_UNAVAILABLE');
  const input:ModelRequest={...request,provider,model:ref.slice(ref.indexOf('/')+1),effort:limits.effort};
  const identity={promptVersion:'s1-director-v1',catalogVersion:providers.catalogVersion,ref,request:input}, key=digest(identity);
  const cached=await env.DB.prepare('SELECT response_key FROM model_responses WHERE cache_key=?').bind(key).first<{response_key:string}>();
  if(cached){const value=await getJson(env,cached.response_key);validate(value);return{value,cached:true};}
  await assertModelBudgetReady(env);
  const receiptKey=`operations/${op.id}/model-calls/${digest({callId})}.json`,budgetId=modelBudgetId(env.PIPELINE_ENVIRONMENT,callId);
  const decode=(result:Json)=>{
    if(result.failure==='MODEL_TOOL_JSON_INVALID')throw new ModelJsonOutputError(result.failure);
    if(result.failure)throw Error(result.failure);
    if(result.toolCalls.length)return{toolCalls:result.toolCalls};
    try{return parseModelJson(result.text) as Json;}catch{throw new ModelJsonOutputError();}
  };
  const finish=async(receipt:Json)=>{
    if(receipt.kind!=='metered_model_response'||receipt.callId!==callId||receipt.requestHash!==key||receipt.budgetId!==budgetId||receipt.model!==ref)throw Error('MODEL_RECEIPT_CONFLICT');
    if(receipt.quote){
      await settleModelBudget(env,budgetId,receipt.quote.usdMicros,receipt);
      await settle(env,callId,receipt.quote.usdMicros,{model:ref,usage:receipt.result.usage,quote:receipt.quote,firstTokenMs:receipt.result.firstTokenMs,totalMs:receipt.result.totalMs});
    }
    let value:Json;
    try{value=decode(receipt.result);validate(value);}catch(error){
      // A malformed completed payload can be corrected only after its actual usage is settled.
      if(!receipt.quote)throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');throw error;
    }
    const stored=await immutableJson(env,`operations/${op.id}/model/${key}.json`,value);
    await env.DB.prepare('INSERT OR IGNORE INTO model_responses(cache_key,model,response_key,created_at) VALUES(?,?,?,?)').bind(key,ref,stored.key,Date.now()).run();
    return{value,cached:false};
  };
  // A durable response may complete bookkeeping after a crash. An absent response never permits resending.
  if(await env.DB.prepare('SELECT id FROM cost_reservations WHERE id=?').bind(callId).first()){
    if(!await env.MEDIA.head(receiptKey))throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');return finish(await getJson(env,receiptKey));
  }
  // A parser/validator repair must not pay for the same completed answer again. Scope reuse to
  // the same workspace/project/purpose, exact request/model/catalog and an immutable settled receipt.
  const completed=await env.DB.prepare(`SELECT r.id,r.operation_id,s.actual_micros FROM cost_reservations r
    JOIN cost_settlements s ON s.reservation_id=r.id JOIN pipeline_operations p ON p.id=r.operation_id
    WHERE r.kind='model' AND r.request_hash=? AND r.catalog_version=? AND p.workspace_id=? AND p.project_id=? AND p.purpose=?
    ORDER BY r.created_at,r.id LIMIT 1`).bind(key,providers.catalogVersion,op.workspace_id,op.project_id,op.purpose).first<Json>();
  if(completed){
    const originalKey=`operations/${completed.operation_id}/model-calls/${digest({callId:completed.id})}.json`;
    if(await env.MEDIA.head(originalKey)){
      const receipt=await getJson(env,originalKey);
      if(receipt.kind!=='metered_model_response'||receipt.callId!==completed.id||receipt.requestHash!==key||receipt.model!==ref
        ||receipt.budgetId!==modelBudgetId(env.PIPELINE_ENVIRONMENT,completed.id)||!receipt.quote||receipt.quote.usdMicros!==completed.actual_micros)throw Error('MODEL_RECEIPT_CONFLICT');
      if(!receipt.result.failure){
        let value:Json;
        try{value=decode(receipt.result);validate(value);}catch(error){if(error instanceof Error)Object.assign(error,{completedReceiptKey:originalKey});throw error;}
        const stored=await immutableJson(env,`operations/${op.id}/model/${key}.json`,value);
        await env.DB.prepare('INSERT OR IGNORE INTO model_responses(cache_key,model,response_key,created_at) VALUES(?,?,?,?)').bind(key,ref,stored.key,Date.now()).run();
        return{value,cached:true,reusedReceiptKey:originalKey};
      }
    }
  }
  let inputTokens=new TextEncoder().encode(canonical({...input,messages:input.messages.map(message=>({...message,images:message.images?.map(image=>({...image,base64:''}))??[]}))})).length+2048;
  if(provider.kind==='anthropic'){
    const prepared=providerRequest(input), body={...prepared.body};delete body.stream;delete body.max_tokens;delete body.output_config;
    const count=await fetch(provider.baseUrl+'/v1/messages/count_tokens',{method:'POST',headers:{'x-api-key':secret,'anthropic-version':'2023-06-01','content-type':'application/json'},body:canonical(body),signal:AbortSignal.timeout(30000)});
    if(!count.ok)throw Error('MODEL_TOKEN_COUNT_UNAVAILABLE');const data=parseCanonicalJson(await count.text()) as Json;
    if(!Number.isSafeInteger(data.input_tokens)||data.input_tokens<0)throw Error('MODEL_TOKEN_COUNT_UNAVAILABLE');inputTokens=data.input_tokens+2048;
  }else{
    inputTokens+=request.messages.reduce((sum,message)=>sum+(message.images?.length??0)*131072,0);
    // Gateway Claude has added up to ~110k unrequested input tokens in the retained probes.
    // Reserve a 128k-token surcharge for registered hidden-prompt routes, not only the ~6.8k baseline.
    if(model.capabilities.hiddenPromptTokens)inputTokens+=Math.max(131072,model.capabilities.hiddenPromptTokens);
  }
  const usage=provider.kind==='anthropic'?{input_tokens:0,cache_creation:{ephemeral_1h_input_tokens:inputTokens},output_tokens:input.maxOutputTokens}
    :{prompt_tokens:inputTokens,completion_tokens:input.maxOutputTokens};
  const worst=modelCallCostMicros(ref,usage,providers).usdMicros;
  if(worst>limits.maxMicros)throw Error('MODEL_REQUEST_EXCEEDS_STAGE_BUDGET');
  // The first asset message is the original image/input; later validation feedback must not create a fresh per-asset budget.
  const budgetStage=stage==='assets'?'assets:'+digest(request.messages.slice(0,1)).slice(0,32):stage;
  const reserved=await reserveModelBudget(env,callId,op.id,worst,identity,providers.catalogVersion);
  try{
    await reserve(env,op,callId,'model',budgetStage,worst,identity,providers.catalogVersion,authorization.maxUsdMicros,limits.maxMicros,
      limits.maxCalls??limits.maxCallsPerAsset??1);
    await operation(env,op.id,op.generation);
  }catch(error){await settleModelBudget(env,reserved,0,{kind:'not_dispatched',reason:'Local admission did not reach the paid request.'},{notDispatched:true});throw error;}
  await markModelDispatched(env,reserved);
  let result;
  try{result=await streamModel({...input,secret},{timeoutMs:Math.max(1,Math.min(policy.limits.requestTimeoutMs,deadlineAt-Date.now()))});}
  catch(error){if(!(error instanceof ModelOutputError))throw error;result=error.result;}
  const receipt={kind:'metered_model_response',callId,requestHash:key,budgetId:reserved,model:ref,quote:modelUsageQuote(ref,result.usage,providers),result};
  await immutableJson(env,receiptKey,receipt);return finish(receipt);
}
