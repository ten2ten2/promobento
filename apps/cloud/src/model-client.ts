import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {modelCallCostMicros} from '../../../packages/contracts/src/models.mjs';
import {providerRequest, streamModel, type ModelRequest} from '../../../packages/models/src/adapters.mjs';
import providersInput from '../../../config/model-providers.json';
import authorization from '../../../config/model-authorization.json';
import policyInput from '../../../config/agent-policy.json';
import {operation, reserve, settle, getJson, immutableJson} from './store.ts';
import type {PipelineEnv, Json} from './pipeline-types.ts';

const providers: Json=providersInput, policy: Json=policyInput;
export async function modelStep(env: PipelineEnv, operationId: string, generation: number, stage: string, callId: string,
  request: Omit<ModelRequest,'provider'|'model'|'effort'>, validate: (value: Json) => void) {
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
  // A previous call with this id may have consumed money. Never send it again after a crash.
  if(await env.DB.prepare('SELECT id FROM cost_reservations WHERE id=?').bind(callId).first())throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');
  let inputTokens=new TextEncoder().encode(canonical({...input,messages:input.messages.map(message=>({...message,images:message.images?.map(image=>({...image,base64:''}))??[]}))})).length+2048;
  if(provider.kind==='anthropic'){
    const prepared=providerRequest(input), body={...prepared.body};delete body.stream;delete body.max_tokens;delete body.output_config;
    const count=await fetch(provider.baseUrl+'/v1/messages/count_tokens',{method:'POST',headers:{'x-api-key':secret,'anthropic-version':'2023-06-01','content-type':'application/json'},body:canonical(body),signal:AbortSignal.timeout(30000)});
    if(!count.ok)throw Error('MODEL_TOKEN_COUNT_UNAVAILABLE');const data=parseCanonicalJson(await count.text()) as Json;
    if(!Number.isSafeInteger(data.input_tokens)||data.input_tokens<0)throw Error('MODEL_TOKEN_COUNT_UNAVAILABLE');inputTokens=data.input_tokens+2048;
  }else inputTokens+=request.messages.reduce((sum,message)=>sum+(message.images?.length??0)*131072,0);
  const usage=provider.kind==='anthropic'?{input_tokens:0,cache_creation:{ephemeral_1h_input_tokens:inputTokens},output_tokens:input.maxOutputTokens}
    :{prompt_tokens:inputTokens,completion_tokens:input.maxOutputTokens};
  const worst=modelCallCostMicros(ref,usage,providers).usdMicros;
  if(worst>limits.maxMicros)throw Error('MODEL_REQUEST_EXCEEDS_STAGE_BUDGET');
  const budgetStage=stage==='assets'?'assets:'+digest(request.messages).slice(0,32):stage;
  await reserve(env,op,callId,'model',budgetStage,worst,identity,providers.catalogVersion,authorization.maxUsdMicros,limits.maxMicros,
    limits.maxCalls??limits.maxCallsPerAsset??1);
  const result=await streamModel({...input,secret},{timeoutMs:policy.limits.requestTimeoutMs});
  const actual=modelCallCostMicros(ref,result.usage,providers,{maxOutputTokens:input.maxOutputTokens});
  if(!actual.estimated)await settle(env,callId,actual.usdMicros,{model:ref,usage:result.usage,firstTokenMs:result.firstTokenMs,totalMs:result.totalMs});
  const value=(result.toolCalls.length?{toolCalls:result.toolCalls}:parseCanonicalJson(result.text)) as Json;
  validate(value);
  const stored=await immutableJson(env,`operations/${op.id}/model/${key}.json`,value);
  await env.DB.prepare('INSERT OR IGNORE INTO model_responses(cache_key,model,response_key,created_at) VALUES(?,?,?,?)').bind(key,ref,stored.key,Date.now()).run();
  return{value,cached:false};
}
