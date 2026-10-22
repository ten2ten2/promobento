import {canonical,parseCanonicalJson,digest} from '../../../packages/contracts/index.mjs';
import {usageCost} from './costs.mjs';

export function modelIdentity(config,provider=config.provider,id=config.model) {
  return {provider,id,settingsHash:digest({model:config.model,reasoningEffort:config.reasoningEffort??null,
    maxInputTokens:config.maxInputTokens,maxOutputTokens:config.maxOutputTokens})};
}

/** Shared paid-call boundary for both experimental arms. No automatic HTTP retry. */
export async function runModelCall({config,ledger,provider,instructions,input,signal,images=[]}) {
  signal?.throwIfAborted();
  const reservation=ledger.reserve({usdMicros:usageCost({inputTokens:config.maxInputTokens,outputTokens:config.maxOutputTokens},config.prices),
    provider:provider.id,model:config.model});
  let result;
  try {result=await provider.generate({instructions,input:canonical(input),images,signal});}
  catch(error) {
    if(error.notBilled)ledger.settle(reservation,{usdMicros:0,usage:[],reason:'Generation was not dispatched; token-count/preflight failed.'});
    throw error;
  }
  if(!result.usage)throw Error('LOCAL_AGENT_USAGE_UNKNOWN');
  const usdMicros=usageCost(result.usage,config.prices);
  const event=ledger.settle(reservation,{usdMicros,providerRequestId:result.providerRequestId??null,
    usage:[{metric:'input_tokens',unit:'token',quantity:result.usage.inputTokens},
      {metric:'cached_input_tokens',unit:'token',quantity:result.usage.cachedInputTokens??0},
      {metric:'output_tokens',unit:'token',quantity:result.usage.outputTokens}]});
  const returnedModel=typeof result.model==='string'&&result.model.length?{provider:provider.id,id:result.model}:null;
  try {
    // Always record actual usage, including a late response, before refusing to publish it.
    signal?.throwIfAborted();
    if(!returnedModel)throw Error('LOCAL_AGENT_PROVIDER_MODEL_REQUIRED');
    if(usdMicros>reservation.usdMicros||result.usage.inputTokens>config.maxInputTokens||result.usage.outputTokens>config.maxOutputTokens)
      throw Error('LOCAL_AGENT_PROVIDER_EXCEEDED_RESERVATION');
    if(result.status!=='completed'||typeof result.text!=='string')throw Error(['incomplete','refused','failed'].includes(result.status)?'LOCAL_AGENT_PROVIDER_'+result.status.toUpperCase():'LOCAL_AGENT_PROVIDER_STATUS_INVALID');
    let value;try{value=parseCanonicalJson(result.text);}catch(cause){throw Error('LOCAL_AGENT_MODEL_RESPONSE_INVALID',{cause});}
    return {value,event,model:modelIdentity(config,provider.id),returnedModel};
  } catch(error){error.returnedModel=returnedModel;throw error;}
}
