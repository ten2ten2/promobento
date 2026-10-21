import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIProvider} from '../src/openai.mjs';
import {parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {config} from './fixtures.mjs';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('mock HTTP: exact count precedes bounded stateless generation, real usage fields retained',async()=>{
  const requests=[];
  const provider=createOpenAIProvider(config(),{apiKey:'mock-key',fetchImpl:async(url,options)=>{
    requests.push({url,body:parseCanonicalJson(options.body),headers:options.headers});
    return requests.length===1?json({input_tokens:12}):json({id:'response-test',model:'mock-model',status:'completed',usage:{input_tokens:12,output_tokens:9,input_tokens_details:{cached_tokens:4}},
      output:[{type:'reasoning'},{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]});
  }});
  const result=await provider.generate({instructions:'Return JSON.',input:'hello'});
  assert.match(requests[0].url,/input_tokens$/);assert.equal(requests[1].body.store,false);assert.deepEqual(requests[1].body.tools,[]);
  assert.equal(requests[1].body.max_output_tokens,2000);assert.deepEqual(result.usage,{inputTokens:12,outputTokens:9,cachedInputTokens:4});
  assert.equal(result.text,'{"ok":true}');assert.ok(!JSON.stringify(result).includes('mock-key'));
});
test('mock HTTP: excessive input never dispatches generation',async()=>{
  let requests=0;const provider=createOpenAIProvider(config(),{apiKey:'mock-key',fetchImpl:async()=>{requests++;return json({input_tokens:10001});}});
  await assert.rejects(provider.generate({instructions:'JSON',input:'a'}),error=>error.message==='LOCAL_AGENT_INPUT_TOKEN_LIMIT'&&error.notBilled===true);
  assert.equal(requests,1);
});
test('mock HTTP: interrupted generation is not asserted free and is never retried',async()=>{
  let requests=0;const provider=createOpenAIProvider(config(),{apiKey:'mock-key',fetchImpl:async()=>{if(++requests===1)return json({input_tokens:1});throw Error('network unavailable');}});
  await assert.rejects(provider.generate({instructions:'JSON',input:'a'}),error=>!error.notBilled);assert.equal(requests,2);
});
test('mock HTTP: refusal/incomplete retain usage for settlement; missing credentials fail closed',async()=>{
  assert.throws(()=>createOpenAIProvider(config(),{apiKey:''}),/API_KEY_REQUIRED/);
  let requests=0;const provider=createOpenAIProvider(config(),{apiKey:'mock-key',fetchImpl:async()=>++requests===1?json({input_tokens:1}):json({status:'incomplete',usage:{input_tokens:1,output_tokens:2000},output:[]})});
  const result=await provider.generate({instructions:'JSON',input:'a'});assert.equal(result.status,'incomplete');assert.equal(result.usage.outputTokens,2000);assert.equal(result.text,null);
});
