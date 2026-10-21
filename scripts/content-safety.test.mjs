import assert from 'node:assert/strict';
import test from 'node:test';
import { contentSafetyConfig, generationScanInput, scanGenerationPrompt, scanReceiptMatches, nextScanRetry } from './content-safety-reference.mjs';

const enabled = () => ({...structuredClone(contentSafetyConfig),enabled:true});
const input = () => ({operationId:'operation_creative',operationKind:'creative_generate',generationId:'generation_1',prompt:'  A product card with cafe\u0301 lettering.  ',locale:'en'});
const allow = () => ({action:'allow',reasonCode:'allowed',matchedCategories:[],requestId:'REQ_test',semanticStatus:'scored'});
const now = () => Date.parse('2026-10-21T00:00:00Z');

test('the default-disabled switch does not call a scanner or manufacture an allow receipt', async () => {
  let calls=0;
  const result=await scanGenerationPrompt(input(),{scanner:async () => { calls++; return allow(); }});
  assert.equal(contentSafetyConfig.enabled,false);
  assert.deepEqual(result,{status:'provider_disabled',providerAllowsGeneration:false,reasonCode:'PROVIDER_DISABLED',scanAttempted:false,receipt:null,nextRetry:null});
  assert.equal(calls,0);
  assert.equal(result.providerAllowsGeneration,false);
});

test('enabled scanning sends the exact final prompt with enforce and binds the resulting allow', async () => {
  const source=input(),config=enabled(); let request;
  const result=await scanGenerationPrompt(source,{config,scanner:async body => { request=body; return allow(); },now});
  assert.deepEqual(request,{prompt:source.prompt,locale:'en',semantic:'enforce'});
  assert.equal(result.status,'allowed'); assert.equal(result.providerAllowsGeneration,true);
  assert.equal(scanReceiptMatches(result.receipt,source,config),true);
  assert.equal(scanReceiptMatches(result.receipt,{...source,prompt:source.prompt.trim()},config),false);
  assert.equal(scanReceiptMatches(result.receipt,{...source,prompt:source.prompt.normalize('NFC')},config),false);
  assert.equal(scanReceiptMatches(result.receipt,{...source,operationId:'operation_other'},config),false);
  assert.equal(scanReceiptMatches(result.receipt,{...source,operationKind:'agent_patch'},config),false);
  assert.equal(scanReceiptMatches(result.receipt,{...source,generationId:'generation_2'},config),false);
  assert.equal(scanReceiptMatches(result.receipt,{...source,locale:'zh'},config),false);
  assert.equal(scanReceiptMatches(result.receipt,source,contentSafetyConfig),false);
});

test('review, block and degraded review retain recoverable decisions and never allow generation', async () => {
  for (const verdict of [
    {...allow(),action:'review',reasonCode:'review_required'},
    {...allow(),action:'review',reasonCode:'service_degraded',semanticStatus:'provider_error'},
    {...allow(),action:'block',reasonCode:'restricted_content',matchedCategories:['restricted']}
  ]) {
    const result=await scanGenerationPrompt(input(),{config:enabled(),scanner:async () => verdict,now});
    assert.equal(result.providerAllowsGeneration,false);
    assert.ok(['review_required','blocked','retry_wait'].includes(result.status));
    assert.equal(result.receipt.requestId,'REQ_test');
    if (verdict.reasonCode === 'service_degraded') {
      assert.equal(result.status,'retry_wait'); assert.equal(result.nextRetry.delayMs,5000);
    } else assert.equal(result.nextRetry,null);
  }
  const exhausted=await scanGenerationPrompt(input(),{config:enabled(),retryCount:3,
    scanner:async () => ({...allow(),action:'review',reasonCode:'service_degraded',semanticStatus:'provider_error'}),now});
  assert.equal(exhausted.status,'review_required'); assert.equal(exhausted.providerAllowsGeneration,false);
  assert.equal(exhausted.nextRetry,null); assert.equal(exhausted.receipt.decision,'review');
});

test('unknown actions, missing fields, wrapped SDK data and an unenforced allow are withheld', async () => {
  for (const verdict of [null,{},'allow',{data:allow()},
    {...allow(),action:'unknown'},{...allow(),requestId:null},
    {...allow(),matchedCategories:['unexpected']},{...allow(),semanticStatus:'provider_error'},
    {...allow(),semanticStatus:'disabled'},{...allow(),semanticStatus:'shadow_scored'}]) {
    const result=await scanGenerationPrompt(input(),{config:enabled(),scanner:async () => verdict,now});
    assert.equal(result.status,'unavailable'); assert.equal(result.providerAllowsGeneration,false); assert.equal(result.receipt,null);
  }
});

test('invalid and oversized prompts are rejected in full without truncation or a scanner call', async () => {
  let calls=0;
  const scanner=async () => { calls++; return allow(); };
  for (const value of [
    {...input(),prompt:''},{...input(),prompt:' \n\t '},{...input(),prompt:'x'.repeat(10001)},
    {...input(),prompt:'\ud800'},{...input(),locale:'zh-hans'},
    {...input(),operationKind:'autosave'},{...input(),generationId:undefined}
  ]) {
    const result=await scanGenerationPrompt(value,{config:enabled(),scanner,now});
    assert.equal(result.status,'invalid_input'); assert.equal(result.scanAttempted,false);
  }
  assert.equal(calls,0);
  let sent;
  const source={...input(),prompt:'x'.repeat(10000)};
  const result=await scanGenerationPrompt(source,{config:enabled(),scanner:async body => {sent=body.prompt;return allow();},now});
  assert.equal(result.providerAllowsGeneration,true); assert.equal(sent,source.prompt);
});

test('429 uses Retry-After without starting an immediate retry or discarding the request', async () => {
  let calls=0;
  const scanner=async () => { calls++; throw {status:429,retryAfter:'17'}; };
  const result=await scanGenerationPrompt(input(),{config:enabled(),scanner,now});
  assert.equal(result.status,'retry_wait'); assert.equal(result.providerAllowsGeneration,false); assert.equal(calls,1);
  assert.deepEqual(result.nextRetry,{reason:'rate_limited',delayMs:17000,notBefore:now()+17000,retryCount:0});
  assert.equal(nextScanRetry({status:429,retryAfter:'garbage',nowMs:now()}),null);
  assert.equal(nextScanRetry({status:429,retryAfter:'Wed, 21 Oct 2026 00:00:20 GMT',nowMs:now()}).delayMs,20000);
});

test('5xx retries start at five seconds, stop after three retries, and other 4xx do not retry', async () => {
  for (const [retryCount,delay] of [[0,5000],[1,10000],[2,20000]]) {
    const result=await scanGenerationPrompt(input(),{config:enabled(),scanner:async () => {throw {status:503};},retryCount,now});
    assert.equal(result.providerAllowsGeneration,false); assert.equal(result.nextRetry.delayMs,delay);
    assert.equal(result.nextRetry.retryCount,retryCount+1);
  }
  const exhausted=await scanGenerationPrompt(input(),{config:enabled(),scanner:async () => {throw {status:503};},retryCount:3,now});
  assert.equal(exhausted.status,'unavailable'); assert.equal(exhausted.nextRetry,null);
  for (const status of [400,401,403,404,422]) {
    const result=await scanGenerationPrompt(input(),{config:enabled(),scanner:async () => {throw {status};},now});
    assert.equal(result.providerAllowsGeneration,false); assert.equal(result.nextRetry,null);
  }
});

test('a scanner deadline aborts the request and cannot be converted into an allow by a late response', async () => {
  let signal;
  const result=await scanGenerationPrompt(input(),{config:{...enabled(),timeoutMs:5},scanner:async (_body,options) => {
    signal=options.signal; return new Promise(() => {});
  },now});
  assert.equal(signal.aborted,true); assert.equal(result.reasonCode,'SCAN_TIMEOUT');
  assert.equal(result.providerAllowsGeneration,false); assert.equal(result.nextRetry.delayMs,5000);
});

test('receipts and failures never return the raw prompt, provider payload or thrown message', async () => {
  const source={...input(),prompt:'PRIVATE CUSTOMER MATERIAL '.repeat(15)};
  const allowed=await scanGenerationPrompt(source,{config:enabled(),scanner:async () => ({...allow(),echo:source.prompt}),now});
  const failed=await scanGenerationPrompt(source,{config:enabled(),scanner:async () => {
    const error=new Error(source.prompt); error.status=500; error.body={echo:source.prompt}; throw error;
  },now});
  for (const result of [allowed,failed]) {
    assert.equal(JSON.stringify(result).includes(source.prompt),false);
    assert.equal(JSON.stringify(result).includes('echo'),false);
  }
});

test('client input cannot enable a disabled operator switch or downgrade enforce', async () => {
  let called=false;
  const result=await scanGenerationPrompt({...input(),enabled:true,semantic:'off'},{scanner:async () => {called=true;return allow();}});
  assert.equal(result.status,'provider_disabled'); assert.equal(called,false);
  const invalid=await scanGenerationPrompt(input(),{config:{...enabled(),semantic:'shadow'},scanner:async () => {called=true;return allow();}});
  assert.equal(invalid.status,'unavailable'); assert.equal(called,false);
  const weakened=await scanGenerationPrompt(input(),{config:{...enabled(),allowRequiresSemanticStatus:'disabled'},
    scanner:async () => {called=true;return {...allow(),semanticStatus:'disabled'};}});
  assert.equal(weakened.status,'unavailable'); assert.equal(called,false);
});


test('all generating business operations scan their exact text; rendering and autosave are not generation operations', async () => {
  const config=enabled();
  for (const operationKind of ['creative_generate','agent_patch','prepare_targets']) {
    const source=generationScanInput({operationId:'operation_1',generationId:'generation_1',operationKind,
      instruction:'  Keep the cafe\u0301 name.  ',facts:['Product: $19'],transcript:['The exact spoken line.'],comments:['Move this text.'],locale:'en'});
    let body;
    const result=await scanGenerationPrompt(source,{config,scanner:async sent => {body=sent;return allow();},now});
    assert.equal(result.providerAllowsGeneration,true);
    assert.equal(body.prompt,source.prompt);
    assert.deepEqual(JSON.parse(body.prompt),{instruction:'  Keep the cafe\u0301 name.  ',facts:['Product: $19'],transcript:['The exact spoken line.'],comments:['Move this text.']});
  }
  for (const operationKind of ['render_export','autosave','image_generation','video_generation']) {
    assert.throws(() => generationScanInput({operationId:'operation_1',generationId:'generation_1',operationKind,instruction:'Create.'}),/INVALID_GENERATION_OPERATION/);
  }
});

test('text assembly validates the total request including facts, transcript and comments without dropping sections', () => {
  const request={operationId:'operation_1',generationId:'generation_1',operationKind:'agent_patch',instruction:'Change the pace.'};
  assert.throws(() => generationScanInput({...request,facts:['x'.repeat(6000)],transcript:['y'.repeat(6000)]}),/PROMPT_TOO_LONG/);
  assert.throws(() => generationScanInput({...request,comments:[null]}),/INVALID_SCAN_TEXT_PARTS/);
  assert.throws(() => generationScanInput({...request,instruction:' '}),/INVALID_SCAN_TEXT_PARTS/);
  const source=generationScanInput({...request,comments:['Same text','Same text']});
  assert.deepEqual(JSON.parse(source.prompt).comments,['Same text','Same text']);
});

test('the assembled boundary counts Unicode code points including structure, not UTF-16 units', async () => {
  const request={operationId:'operation_1',generationId:'generation_1',operationKind:'creative_generate',instruction:'x'};
  const structureLength=[...generationScanInput(request).prompt].length-1;
  const instruction='😀'.repeat(contentSafetyConfig.maxPromptCharacters-structureLength);
  const source=generationScanInput({...request,instruction});
  assert.equal([...source.prompt].length,contentSafetyConfig.maxPromptCharacters);
  assert.ok(source.prompt.length>contentSafetyConfig.maxPromptCharacters);
  let sent;
  const result=await scanGenerationPrompt(source,{config:enabled(),scanner:async body => {sent=body.prompt;return allow();},now});
  assert.equal(result.providerAllowsGeneration,true);
  assert.equal(sent,source.prompt);
  assert.throws(() => generationScanInput({...request,instruction:instruction+'😀'}),/PROMPT_TOO_LONG/);
});
