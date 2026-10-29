import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest,sha256Bytes} from '@promobento/contracts/digest';
import {modelCallCostMicros,modelUsageQuote} from '../../../packages/contracts/src/models.mjs';
import {providerRequest, streamModel, ModelOutputError, parseModelJson, type ModelRequest} from '../../../packages/models/src/adapters.mjs';
import providersInput from '../../../config/model-providers.json';
import authorization from '../../../config/model-authorization.json';
import policyInput from '../../../config/agent-policy.json';
import {operation, reserve, settle, getJson, immutableJson, immutableBytes} from './store.ts';
import {assertModelBudgetReady,reserveModelBudget,markModelDispatched,settleModelBudget,modelBudgetId} from './model-budget.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';

const providers: Json=providersInput, policy: Json=policyInput;
/** A complete, durably recorded response with invalid text/tool JSON; never a transport failure. */
export class ModelJsonOutputError extends Error {
  constructor(code='MODEL_OUTPUT_JSON_INVALID',readonly completedOutput?:{text:string;toolCalls:Json[]}){super(code);}
}
class SceneUpstream502 extends Error {constructor(){super('MODEL_UPSTREAM_502');}}
type ModelContext={directingMethod?:{id:string;version:string;contentHash:string};sceneId?:string};
export async function modelStep(env: PipelineEnv, operationId: string, generation: number, stage: string, callId: string,
  request: Omit<ModelRequest,'provider'|'model'|'effort'>, validate: (value: Json) => void, deadlineAt = Date.now()+policy.limits.requestTimeoutMs,
  context:ModelContext={}) {
  const fallback=stage==='scenes'&&providers.steps.scenes==='modelswitch/claude-opus-5-5'
    &&request.tools?.some(tool=>tool.name==='edit_file')&&!request.toolChoice;
  try{return await modelStepOnce(env,operationId,generation,stage,callId,request,validate,deadlineAt,context,undefined,Boolean(fallback));}
  catch(error){
    if(!fallback||!(error instanceof SceneUpstream502))throw error;
    // This is a separate paid call, fenced by its own ID and the original scene/operation limits.
    return modelStepOnce(env,operationId,generation,stage,callId+'-deepseek-502',
      {...request,toolChoice:'edit_file'},validate,deadlineAt,context,'modelswitch/deepseek-v4.1-flash-1017',false,'none',true);
  }
}
async function modelStepOnce(env: PipelineEnv, operationId: string, generation: number, stage: string, callId: string,
  request: Omit<ModelRequest,'provider'|'model'|'effort'>, validate: (value: Json) => void, deadlineAt:number,
  context:ModelContext,overrideRef?:string,allow502Fallback=false,overrideEffort?:string,preventPendingReplay=allow502Fallback) {
  if(Date.now()>=deadlineAt)throw Error('OPERATION_DEADLINE');
  const op=await operation(env,operationId,generation), ref=overrideRef??providers.steps[stage], model=providers.models[ref], provider=providers.providers[ref?.split('/')[0]];
  if(!ref||!model?.capabilities.verified||!authorization.models.includes(ref)||!authorization.purposes.includes(op.purpose)
    ||Date.now()>=Date.parse(authorization.expiresAt)||providers.catalogVersion!==authorization.catalogVersion)throw Error('MODEL_NOT_AUTHORIZED');
  const secret=provider.secret==='ANTHROPIC_API_KEY'?env.ANTHROPIC_API_KEY:env.MODEL_COMPAT_API_KEY;
  if(!secret)throw Error('MODEL_SECRET_MISSING');
  const limits=policy.director.steps[stage];
  if(!limits)throw Error('MODEL_STAGE_UNKNOWN');
  if(stage==='scenes'&&!/^[a-z][a-z0-9-]{0,47}$/.test(context.sceneId??''))throw Error('MODEL_SCENE_REQUIRED');
  const stageLimit=stage==='scenes'?limits.maxMicrosPerScene:limits.maxMicros;
  const methodEvidence=context.directingMethod?{directingMethod:context.directingMethod}:{};
  if(request.messages.some(message=>message.images?.length)&&!model.capabilities.vision)throw Error('MODEL_VISION_UNAVAILABLE');
  if(request.tools?.length&&!model.capabilities.tools)throw Error('MODEL_TOOLS_UNAVAILABLE');
  const input:ModelRequest={...request,provider,model:ref.slice(ref.indexOf('/')+1),effort:overrideEffort??limits.effort};
  const requestSettings={providerKind:provider.kind,effort:input.effort,toolChoice:input.toolChoice??null,maxOutputTokens:input.maxOutputTokens};
  const identity={promptVersion:'s1-director-v1',catalogVersion:providers.catalogVersion,ref,request:input,...methodEvidence}, key=digest(identity);
  const cacheKey=digest({kind:'model-response-cache-v2',requestHash:key,workspaceId:op.workspace_id,projectId:op.project_id,purpose:op.purpose});
  const receiptKey=`operations/${op.id}/model-calls/${digest({callId})}.json`,budgetId=modelBudgetId(env.PIPELINE_ENVIRONMENT,callId);
  const fallbackKey=`operations/${op.id}/model-fallbacks/${digest({callId})}.json`;
  const decode=(result:Json)=>{
    if(result.failure==='MODEL_TOOL_JSON_INVALID')throw new ModelJsonOutputError(result.failure,{text:result.text,toolCalls:result.toolCalls});
    if(result.failure)throw Error(result.failure);
    if(result.toolCalls.length)return{toolCalls:result.toolCalls};
    try{return parseModelJson(result.text) as Json;}catch{throw new ModelJsonOutputError('MODEL_OUTPUT_JSON_INVALID',{text:result.text,toolCalls:result.toolCalls});}
  };
  const finish=async(receipt:Json,replayed=false)=>{
    if(receipt.kind!=='metered_model_response'||receipt.callId!==callId||receipt.requestHash!==key||receipt.budgetId!==budgetId||receipt.model!==ref)throw Error('MODEL_RECEIPT_CONFLICT');
    if(receipt.quote){
      await settleModelBudget(env,budgetId,receipt.quote.usdMicros,receipt);
      await settle(env,callId,receipt.quote.usdMicros,{model:ref,usage:receipt.result.usage,quote:receipt.quote,firstTokenMs:receipt.result.firstTokenMs,totalMs:receipt.result.totalMs,...methodEvidence,...(receipt.requestSettings?{requestSettings:receipt.requestSettings}:{})});
    }
    if(allow502Fallback&&receipt.result.failure==='MODEL_STREAM_FAILED'&&receipt.result.upstreamStatus===502)throw new SceneUpstream502();
    let value:Json;
    try{value=decode(receipt.result);validate(value);}catch(error){
      // A malformed completed payload can be corrected only after its actual usage is settled.
      if(!receipt.quote)throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');throw error;
    }
    const stored=await immutableJson(env,`operations/${op.id}/model/${key}.json`,value);
    if(receipt.quote)await env.DB.prepare('INSERT OR IGNORE INTO model_responses(cache_key,model,response_key,created_at) VALUES(?,?,?,?)').bind(cacheKey,ref,stored.key,Date.now()).run();
    return{value,cached:replayed};
  };
  // A durable response may complete bookkeeping after a crash. An absent response never permits resending.
  if(await env.DB.prepare('SELECT id FROM cost_reservations WHERE id=?').bind(callId).first()){
    if(!await env.MEDIA.head(receiptKey)){
      const diagnosticKey=receiptKey.replace(/\.json$/,'-request-failure.json');
      if(allow502Fallback&&await env.MEDIA.head(diagnosticKey)){
        const diagnostic=await getJson(env,diagnosticKey);
        if(diagnostic.callId===callId&&diagnostic.requestHash===key&&diagnostic.budgetId===budgetId&&diagnostic.model===ref
          &&diagnostic.code==='MODEL_REQUEST_FAILED'&&diagnostic.httpStatus===502)throw new SceneUpstream502();
      }
      throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');
    }return finish(await getJson(env,receiptKey),true);
  }
  if(allow502Fallback&&await env.MEDIA.head(fallbackKey)){
    const trigger=await getJson(env,fallbackKey);
    if(trigger.kind!=='prior_scene_502_fallback'||trigger.callId!==callId||trigger.requestHash!==key||trigger.model!==ref)throw Error('MODEL_RECEIPT_CONFLICT');
    throw new SceneUpstream502();
  }
  const cached=await env.DB.prepare('SELECT response_key FROM model_responses WHERE cache_key=?').bind(cacheKey).first<{response_key:string}>();
  if(cached){const value=await getJson(env,cached.response_key);validate(value);return{value,cached:true};}
  // A parser/validator repair must not pay for the same completed answer again. Scope reuse to
  // the same workspace/project/purpose, exact request/model/catalog and an immutable settled receipt.
  const completed=await env.DB.prepare(`SELECT r.id,r.operation_id,s.actual_micros FROM cost_reservations r
    JOIN cost_settlements s ON s.reservation_id=r.id JOIN pipeline_operations p ON p.id=r.operation_id
    WHERE r.kind='model' AND r.request_hash=? AND r.catalog_version=? AND p.workspace_id=? AND p.project_id=? AND p.purpose=?
    ORDER BY r.created_at,r.id`).bind(key,providers.catalogVersion,op.workspace_id,op.project_id,op.purpose).all<Json>();
  let missingReceipt=false;
  for(const previous of completed.results){
    const originalKey=`operations/${previous.operation_id}/model-calls/${digest({callId:previous.id})}.json`;
    if(!await env.MEDIA.head(originalKey)){missingReceipt=true;continue;}
    const receipt=await getJson(env,originalKey);
    if(receipt.kind!=='metered_model_response'||receipt.callId!==previous.id||receipt.requestHash!==key||receipt.model!==ref
      ||receipt.budgetId!==modelBudgetId(env.PIPELINE_ENVIRONMENT,previous.id)||!receipt.quote||receipt.quote.usdMicros!==previous.actual_micros)throw Error('MODEL_RECEIPT_CONFLICT');
    if(!receipt.result.failure){
      let value:Json;
      try{value=decode(receipt.result);validate(value);}catch(error){if(error instanceof Error)Object.assign(error,{completedReceiptKey:originalKey});throw error;}
      const stored=await immutableJson(env,`operations/${op.id}/model/${key}.json`,value);
      await env.DB.prepare('INSERT OR IGNORE INTO model_responses(cache_key,model,response_key,created_at) VALUES(?,?,?,?)').bind(cacheKey,ref,stored.key,Date.now()).run();
      return{value,cached:true,reusedReceiptKey:originalKey};
    }
  }
  if(missingReceipt)throw Error('MODEL_RECEIPT_UNAVAILABLE');
  if(preventPendingReplay){
    const pending=await env.DB.prepare(`SELECT r.id,r.operation_id,p.status FROM cost_reservations r JOIN pipeline_operations p ON p.id=r.operation_id
      LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.kind='model' AND r.request_hash=? AND r.catalog_version=?
      AND p.workspace_id=? AND p.project_id=? AND p.purpose=? AND s.reservation_id IS NULL ORDER BY r.created_at,r.id`)
      .bind(key,providers.catalogVersion,op.workspace_id,op.project_id,op.purpose).all<Json>();
    if(pending.results.length){
      // Only a terminal same-scope exact-request receipt can authorize a new fallback.
      // An active competing operation or an unknown failure must not trigger another call.
      if(allow502Fallback&&pending.results.every(row=>['failed','cancelled'].includes(row.status))){
        for(const previous of pending.results){
          const originalKey=`operations/${previous.operation_id}/model-calls/${digest({callId:previous.id})}.json`;
          if(!await env.MEDIA.head(originalKey))continue;
          const receipt=await getJson(env,originalKey);
          if(receipt.kind!=='metered_model_response'||receipt.callId!==previous.id||receipt.requestHash!==key||receipt.model!==ref
            ||receipt.budgetId!==modelBudgetId(env.PIPELINE_ENVIRONMENT,previous.id))throw Error('MODEL_RECEIPT_CONFLICT');
          if(receipt.result?.failure!=='MODEL_STREAM_FAILED')continue;
          let confirmed=receipt.result.upstreamStatus===502;
          // Older 502 receipts predate upstreamStatus; inspect their original immutable stream.
          const raw=receipt.rawStreamRef;
          if(!confirmed&&receipt.result.upstreamStatus===undefined&&raw?.key===`operations/${previous.operation_id}/model-streams/${digest({callId:previous.id})}.sse`
            &&Number.isSafeInteger(raw.byteLength)&&raw.byteLength>=0&&raw.byteLength<=(16<<20)&&/^[a-f0-9]{64}$/.test(raw.sha256??'')){
            const object=await env.MEDIA.get(raw.key);
            if(!object||object.size!==raw.byteLength)throw Error('MODEL_RECEIPT_UNAVAILABLE');
            const bytes=new Uint8Array(await object.arrayBuffer());if(sha256Bytes(bytes)!==raw.sha256)throw Error('MODEL_RECEIPT_CONFLICT');
            const stream=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);
            for(const line of stream.split('\n'))if(line.startsWith('data:')){
              const payload=line.slice(5).trim();if(payload==='[DONE]')continue;
              const data=parseCanonicalJson(payload) as Json;if(data.error?.code===502)confirmed=true;
            }
          }
          if(confirmed){
            await immutableJson(env,fallbackKey,{kind:'prior_scene_502_fallback',callId,requestHash:key,model:ref,sourceReceiptKey:originalKey,sourceCallId:previous.id});
            throw new SceneUpstream502();
          }
        }
      }
      throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');
    }
  }
  await assertModelBudgetReady(env);
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
  if(worst>stageLimit)throw Error('MODEL_REQUEST_EXCEEDS_STAGE_BUDGET');
  // The first asset message is the original image/input; later validation feedback must not create a fresh per-asset budget.
  const budgetStage=stage==='assets'?'assets:'+digest(request.messages.slice(0,1)).slice(0,32):stage==='scenes'?'scenes:'+context.sceneId:stage;
  const reserved=await reserveModelBudget(env,callId,op.id,worst,identity,providers.catalogVersion);
  try{
    await reserve(env,op,callId,'model',budgetStage,worst,identity,providers.catalogVersion,authorization.maxUsdMicros,stageLimit,
      limits.maxCalls??limits.maxCallsPerAsset??limits.maxCallsPerScene??1,preventPendingReplay);
    await operation(env,op.id,op.generation);
  }catch(error){await settleModelBudget(env,reserved,0,{kind:'not_dispatched',reason:'Local admission did not reach the paid request.'},{notDispatched:true});throw error;}
  await markModelDispatched(env,reserved);
  let result;
  try{result=await streamModel({...input,secret},{timeoutMs:Math.max(1,Math.min(policy.limits.requestTimeoutMs,deadlineAt-Date.now()))});}
  catch(error){
    if(!(error instanceof ModelOutputError)){
      const status=(error as {status?:unknown})?.status;
      const diagnostic={
        kind:'model_request_failure',callId,requestHash:key,budgetId:reserved,model:ref,...methodEvidence,requestSettings,
        code:error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'MODEL_ADAPTER_FAILED',
        httpStatus:Number.isInteger(status)&&Number(status)>=100&&Number(status)<=599?status:null,usageStatus:'unknown'
      };
      if(allow502Fallback&&diagnostic.code==='MODEL_REQUEST_FAILED'&&diagnostic.httpStatus===502){
        await immutableJson(env,receiptKey.replace(/\.json$/,'-request-failure.json'),diagnostic);throw new SceneUpstream502();
      }
      await immutableJson(env,receiptKey.replace(/\.json$/,'-request-failure.json'),diagnostic).catch(()=>{}); // Optional diagnosis must not replace the original provider/transport failure.
      throw error;
    }
    result=error.result;
  }
  // Keep the original complete stream separately: receipts remain within getJson's size limit.
  const {rawStream,...parsedResult}=result;
  const rawStreamRef=await immutableBytes(env,`operations/${op.id}/model-streams/${digest({callId})}.sse`,rawStream,'text/event-stream');
  const receipt={kind:'metered_model_response',callId,requestHash:key,budgetId:reserved,model:ref,...methodEvidence,requestSettings,rawStreamRef,quote:modelUsageQuote(ref,result.usage,providers),result:parsedResult};
  await immutableJson(env,receiptKey,receipt);return finish(receipt);
}
