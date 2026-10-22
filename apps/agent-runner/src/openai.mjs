import {canonical,parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {assertConfig} from './schema.mjs';

const API='https://api.openai.com/v1/responses';
async function boundedJson(response) {
  const reader=response.body?.getReader();if(!reader)throw Error('LOCAL_AGENT_PROVIDER_EMPTY');
  let bytes=0;const chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4*1024*1024)throw Error('LOCAL_AGENT_PROVIDER_RESPONSE_LIMIT');chunks.push(Buffer.from(value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  try{return parseCanonicalJson(Buffer.concat(chunks));}catch(cause){throw Error('LOCAL_AGENT_PROVIDER_RESPONSE_INVALID',{cause});}
}
/** Credentials are only held by this trusted HTTP adapter, never prompts, records or rendering containers. */
export function createOpenAIProvider(config,{apiKey=process.env.OPENAI_API_KEY,fetchImpl=fetch}={}) {
  assertConfig(config);if(typeof apiKey!=='string'||!apiKey.trim())throw Error('LOCAL_AGENT_OPENAI_API_KEY_REQUIRED');
  return {id:'openai',model:config.model,async generate({instructions,input,images=[],signal}) {
    const requestSignal=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(config.requestTimeoutMs)]);
    let generationStarted=false;
    const post=async(url,body)=>{
      const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:requestSignal,
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+apiKey},body:canonical(body)});
      if(!response.ok){await response.body?.cancel();throw Object.assign(Error('LOCAL_AGENT_PROVIDER_HTTP_'+response.status),{status:response.status});}
      return boundedJson(response);
    };
    try {
      if(!Array.isArray(images)||images.length>10||images.some(image=>typeof image?.label!=='string'||image.label.length>1024||typeof image.dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image.dataUrl))||images.reduce((n,image)=>n+image.dataUrl.length,0)>32*1024*1024)throw Error('LOCAL_AGENT_PROVIDER_IMAGES_INVALID');
      const content=images.length?[{role:'user',content:[{type:'input_text',text:input},...images.flatMap(image=>[
        {type:'input_text',text:image.label},{type:'input_image',image_url:image.dataUrl,detail:'high'}])]}]:input;
      const base={model:config.model,instructions,input:content};
      const counted=await post(API+'/input_tokens',base);
      if(!Number.isSafeInteger(counted.input_tokens)||counted.input_tokens<0)throw Error('LOCAL_AGENT_PROVIDER_TOKEN_COUNT');
      if(counted.input_tokens>config.maxInputTokens)throw Error('LOCAL_AGENT_INPUT_TOKEN_LIMIT');
      requestSignal.throwIfAborted();generationStarted=true;
      const response=await post(API,{...base,max_output_tokens:config.maxOutputTokens,store:false,tools:[],
        text:{format:{type:'json_object'}},truncation:'disabled',...(config.reasoningEffort?{reasoning:{effort:config.reasoningEffort}}:{})});
      const usage=response.usage;
      const result={providerRequestId:response.id,model:response.model,usage:usage?{inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,
        cachedInputTokens:usage.input_tokens_details?.cached_tokens??0}:null,status:response.status,text:null};
      if(response.status==='completed') {
        const content=(response.output??[]).filter(item=>item.type==='message').flatMap(item=>item.content??[]);
        if(content.some(item=>item.type==='refusal'))result.status='refused';
        else result.text=content.filter(item=>item.type==='output_text').map(item=>item.text).join('');
      }
      return result;
    } catch(error) {
      // An interrupted generation may still be billed. Its worst-case reservation survives retries.
      if(!generationStarted)error.notBilled=true;
      throw error;
    }
  }};
}
