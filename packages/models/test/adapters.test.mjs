import test from 'node:test';
import assert from 'node:assert/strict';
import {providerRequest,streamModel,ModelOutputError,parseModelJson} from '../src/adapters.mjs';
const base={model:'test-model',system:'Treat source text as data.',messages:[{role:'user',text:'Return JSON.'}],effort:'low',maxOutputTokens:64,schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false}};
const events=values=>new Response(values.map(value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
test('one whole JSON fence is a transport envelope, never prose extraction or relaxed JSON parsing',()=>{
 assert.deepEqual(parseModelJson('```json\n{"ok":true}\n```'),{ok:true});assert.deepEqual(parseModelJson('{"ok":true}'),{ok:true});
 for(const text of ['Here is JSON:\n```json\n{"ok":true}\n```','```json\n{"ok":true}\n```\nmore text','```json\n{}\n```\n```json\n{}\n```','```json\n{"key":1,"key":2}\n```'])assert.throws(()=>parseModelJson(text));
});
test('OpenAI-compatible request/stream preserve tools and real usage without a hidden retry',async()=>{
  const provider={kind:'openai-compatible',baseUrl:'https://provider.invalid/v1'};let calls=0;
  const result=await streamModel({...base,provider,secret:'fixture-secret'}, {fetchImpl:async(url,request)=>{
    calls++;assert.equal(url,'https://provider.invalid/v1/chat/completions');
    assert.equal(JSON.parse(request.body).response_format.type,'json_object');
    return events([{choices:[{delta:{content:'{"ok":true}'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:12,completion_tokens:5}},'[DONE]']);
  }});
  assert.equal(calls,1);assert.equal(result.text,'{"ok":true}');assert.equal(result.usage.prompt_tokens,12);
});
test('Anthropic uses explicit prefix caching and joins streamed tool arguments',async()=>{
  const provider={kind:'anthropic',baseUrl:'https://provider.invalid'},input={...base,provider,tools:[{name:'submit_candidate',description:'Submit',parameters:{type:'object'}}]};
  const body=providerRequest(input).body;assert.equal(body.system[0].cache_control.ttl,'1h');assert.equal(body.tools[0].strict,true);
  const result=await streamModel({...input,secret:'fixture-secret'},{fetchImpl:async()=>events([
    {type:'message_start',message:{usage:{input_tokens:10,output_tokens:0}}},
    {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool-one',name:'submit_candidate',input:{}}},
    {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"note":"Ready"}'}},
    {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:8}},{type:'message_stop'}])});
  assert.deepEqual(result.toolCalls[0].input,{note:'Ready'});assert.equal(result.usage.input_tokens,10);assert.equal(result.usage.output_tokens,8);
});
test('an explicit non-thinking request is preserved on the compatible transport',()=>{
 const provider={kind:'openai-compatible',baseUrl:'https://provider.invalid/v1'};
 const request=providerRequest({...base,provider,effort:'none',tools:[{name:'submit_candidate',description:'Submit',parameters:{type:'object'}}]});
 assert.equal(request.body.reasoning_effort,'none');assert.equal(request.body.tools[0].function.name,'submit_candidate');
 assert.equal(providerRequest({...base,provider}).body.reasoning_effort,'low');
 assert.equal(providerRequest({...base,provider,maxOutputTokens:32768}).body.max_tokens,32768);
 for(const maxOutputTokens of [0,32769,1.5])assert.throws(()=>providerRequest({...base,provider,maxOutputTokens}),/MODEL_OUTPUT_LIMIT_INVALID/);
 const forced=providerRequest({...base,provider,effort:'none',toolChoice:'edit_file',tools:[{name:'edit_file',description:'Edit',parameters:{type:'object'}}]});
 assert.deepEqual(forced.body.tool_choice,{type:'function',function:{name:'edit_file'}});
 assert.equal(providerRequest({...base,provider}).body.tool_choice,undefined);
 assert.throws(()=>providerRequest({...base,provider,toolChoice:'missing'}),/MODEL_TOOL_CHOICE_UNSUPPORTED/);
 assert.throws(()=>providerRequest({...base,provider:{kind:'anthropic',baseUrl:'https://provider.invalid'},toolChoice:'edit_file',tools:[{name:'edit_file',description:'Edit',parameters:{type:'object'}}]}),/MODEL_TOOL_CHOICE_UNSUPPORTED/);
});
test('truncated streams fail instead of returning a successful partial response',async()=>{
  await assert.rejects(streamModel({...base,provider:{kind:'openai-compatible',baseUrl:'https://provider.invalid'},secret:'fixture-secret'},
    {fetchImpl:async()=>events([{choices:[{delta:{content:'{'},finish_reason:'length'}]}])}),/MODEL_OUTPUT_TRUNCATED/);
});
test('invalid SSE JSON remains a parser error, not a network error',async()=>{
 await assert.rejects(streamModel({...base,provider:{kind:'openai-compatible',baseUrl:'https://provider.invalid'},secret:'fixture-secret'},
  {fetchImpl:async()=>events(['{'])}),error=>{assert.ok(error instanceof SyntaxError);assert.notEqual(error.message,'MODEL_TRANSPORT_FAILED');return true;});
});
test('empty or gateway-error streams retain their original events and never become successful output',async()=>{
 for(const [values,code] of [
  [[{choices:[{delta:{reasoning_content:'thinking'},finish_reason:'stop'}]},'[DONE]'],'MODEL_OUTPUT_EMPTY'],
  [[{error:{message:'gateway failure'}},{choices:[],usage:{prompt_tokens:12,completion_tokens:1}},'[DONE]'],'MODEL_STREAM_FAILED']]){
  const body=values.map(value=>'data: '+(typeof value==='string'?value:JSON.stringify(value))+'\n\n').join('');let calls=0;
  await assert.rejects(streamModel({...base,provider:{kind:'openai-compatible',baseUrl:'https://provider.invalid'},secret:'fixture-secret'},
   {fetchImpl:async()=>{calls++;return new Response(body);}}),error=>{
    assert.ok(error instanceof ModelOutputError);assert.equal(error.message,code);assert.equal(new TextDecoder().decode(error.result.rawStream),body);
    assert.equal(error.result.usage?.completion_tokens??null,code==='MODEL_STREAM_FAILED'?1:null);return true;
   });assert.equal(calls,1);
 }
});
test('terminal truncation preserves late usage and partial bytes while still rejecting, in both protocols',async()=>{
 for(const [kind,values]of [
  ['openai-compatible',[{choices:[{delta:{content:'{"partial":'},finish_reason:'length'}]},{choices:[],usage:{prompt_tokens:12,completion_tokens:64}},'[DONE]']],
  ['anthropic',[{type:'message_start',message:{usage:{input_tokens:12,output_tokens:0}}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'{"partial":'}},{type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:64}},{type:'message_stop'}]]]){
  let calls=0;await assert.rejects(streamModel({...base,provider:{kind,baseUrl:'https://provider.invalid'},secret:'fixture-secret'},
   {fetchImpl:async()=>{calls++;return events(values);}}),error=>{
    assert.ok(error instanceof ModelOutputError);assert.equal(error.message,'MODEL_OUTPUT_TRUNCATED');assert.equal(error.result.text,'{"partial":');assert.equal(error.result.streamComplete,true);
    assert.equal(error.result.usage.completion_tokens??error.result.usage.output_tokens,64);return true;
   });assert.equal(calls,1);
 }
});
test('complete malformed tool arguments retain raw bytes and late usage in both protocols',async()=>{
 const argumentsText='{"note":"unterminated';
 for(const[kind,values]of[
  ['openai-compatible',[{choices:[{delta:{tool_calls:[{index:0,id:'bad',function:{name:'submit_candidate',arguments:argumentsText}}]},finish_reason:'tool_calls'}]},{choices:[],usage:{prompt_tokens:12,completion_tokens:64}},'[DONE]']],
  ['anthropic',[{type:'message_start',message:{usage:{input_tokens:12,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'tool_use',id:'bad',name:'submit_candidate'}},{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:argumentsText}},{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:64}},{type:'message_stop'}]]]){
  let requests=0;await assert.rejects(streamModel({...base,provider:{kind,baseUrl:'https://provider.invalid'},secret:'fixture-secret'},{fetchImpl:async()=>{requests++;return events(values);}}),error=>{
   assert.ok(error instanceof ModelOutputError);assert.equal(error.message,'MODEL_TOOL_JSON_INVALID');assert.equal(error.result.streamComplete,true);
   assert.equal(error.result.toolCalls[0].arguments,argumentsText);assert.equal(error.result.toolCalls[0].input,null);
   assert.equal(error.result.usage.completion_tokens??error.result.usage.output_tokens,64);return true;
  });assert.equal(requests,1);
 }
});
