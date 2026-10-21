import test from 'node:test';
import assert from 'node:assert/strict';
import {canonical,parseCanonicalJson} from '@promobento/contracts';
import {admissionEngineOptions,admissionWasmMemoryDescriptor} from '../src/admission-engine.mjs';
import {admissionCaseDeclarations,admissionCaseInput,admissionValidSource,admissionEngineCases} from './admission-engine.cases.mjs';

// These tests deliberately do not call createAdmissionEngine. Guest execution,
// including attack fixtures, is reserved for the hard-limited container suite.
const limits={memoryBytes:32*1024*1024,stackBytes:256*1024,callTimeoutMs:1000,maxOutputBytes:1048576};
const options=()=>({source:admissionValidSource,input:structuredClone(admissionCaseInput),
  declarations:structuredClone(admissionCaseDeclarations),limits:{...limits}});

test('engine admission only snapshots inert source and shared canonical input',()=>{
  const input=options();input.source='globalThis.__admissionMustNotExecute=true;while(true){}';
  const checked=admissionEngineOptions(input);
  assert.equal(globalThis.__admissionMustNotExecute,undefined);
  assert.equal(checked.source,input.source);
  assert.equal(checked.inputText,canonical(input.input));
  assert.deepEqual(parseCanonicalJson(checked.declarationsText),input.declarations);
  input.input.values.changed=true;input.limits.callTimeoutMs=30000;
  assert.equal(parseCanonicalJson(checked.inputText).values.changed,undefined);
  assert.equal(checked.limits.callTimeoutMs,1000);
  assert(Object.isFrozen(checked));assert(Object.isFrozen(checked.limits));
});

test('all VM limits are external, finite and mandatory',()=>{
  for(const field of Object.keys(limits)) {
    const missing=options();delete missing.limits[field];
    assert.throws(()=>admissionEngineOptions(missing),/ADMISSION_ENGINE_LIMITS_INVALID/);
    for(const value of [-1,0,1.5,NaN,Infinity,'1000']) {
      const invalid=options();invalid.limits[field]=value;
      assert.throws(()=>admissionEngineOptions(invalid),/ADMISSION_ENGINE_LIMITS_INVALID/);
    }
  }
  for(const extra of [{timeout:1000},{maxOutputBytes:1048577},{callTimeoutMs:30001},
    {memoryBytes:268435457},{stackBytes:4194305},{stackBytes:32*1024*1024}]) {
    const invalid=options();Object.assign(invalid.limits,extra);
    assert.throws(()=>admissionEngineOptions(invalid),/ADMISSION_ENGINE_LIMITS_INVALID/);
  }
});

test('the physical WASM limit is exact and cannot round the declared budget up',()=>{
  assert.deepEqual(admissionWasmMemoryDescriptor(32*1024*1024),{initial:256,maximum:512});
  assert.deepEqual(admissionWasmMemoryDescriptor(16*1024*1024),{initial:256,maximum:256});
  for(const value of [0,1048576,16777215,33554433,268435457,NaN,Infinity,'33554432'])
    assert.throws(()=>admissionWasmMemoryDescriptor(value),/ADMISSION_ENGINE_LIMITS_INVALID/);
  const invalid=options();invalid.limits.memoryBytes=33554433;
  assert.throws(()=>admissionEngineOptions(invalid),/ADMISSION_ENGINE_LIMITS_INVALID/);
});

test('source bytes and author context are bounded without evaluating source',()=>{
  for(const source of ['',null,Buffer.from('source'),'\ud800','x'.repeat(1048577)])
    assert.throws(()=>admissionEngineOptions({...options(),source}),/ADMISSION_SOURCE_INVALID/);
  for(const [field,value] of [['width',0],['width',8193],['height',1.5],['fps',60],['totalFrames',451],
    ['seed','\ud800'],['seed','x'.repeat(1025)],['targetId',''],['values',[]]]) {
    const invalid=options();invalid.input[field]=value;
    assert.throws(()=>admissionEngineOptions(invalid),/ADMISSION_ENGINE_INPUT_INVALID/);
  }
  const leak=options();leak.input.surface={root:'not a DOM object'};
  assert.throws(()=>admissionEngineOptions(leak),/ADMISSION_ENGINE_INPUT_INVALID/);
  const oversized=options();oversized.input.values.text='x'.repeat(1048576);
  assert.throws(()=>admissionEngineOptions(oversized),/ADMISSION_ENGINE_INPUT_TOO_LARGE/);
  const cyclic=options();cyclic.input.values.self=cyclic.input.values;
  assert.throws(()=>admissionEngineOptions(cyclic),/CYCLIC_JSON/);
});

test('declarations keep schema identity and reject media outside the first profile',()=>{
  for(const field of ['schemaVersion','kind',...['editables','markers','regions','videoUses','fonts']]) {
    const missing=options();delete missing.declarations[field];
    assert.throws(()=>admissionEngineOptions(missing),/ADMISSION_ENGINE_DECLARATIONS_INVALID/);
  }
  for(const field of ['videoUses','fonts']) {
    const invalid=options();invalid.declarations[field]=[{id:'not-admitted'}];
    assert.throws(()=>admissionEngineOptions(invalid),/ADMISSION_CAPABILITY_UNAVAILABLE/);
  }
  const extra=options();extra.declarations.prepare='not executable metadata';
  assert.throws(()=>admissionEngineOptions(extra),/ADMISSION_ENGINE_DECLARATIONS_INVALID/);
});

test('the container attack inventory is data and covers module, prepare, draw and cleanup boundaries',()=>{
  assert.equal(new Set(admissionEngineCases.map(item=>item.name)).size,admissionEngineCases.length);
  for(const item of admissionEngineCases) {
    assert.equal(typeof item.source,'string');
    assert(['success','reject','command-reject'].includes(item.expected));
    admissionEngineOptions({...options(),source:item.source});
  }
  for(const phase of ['create','draw','dispose'])
    assert(admissionEngineCases.some(item=>item.phase===phase&&item.expected==='reject'));
  for(const name of ['module-wall-clock','module-random','module-timer','module-import','module-memory',
    'declaration-proxy-loop','draw-proxy-loop','draw-error-getter','forged-receipt-data','dispose-loop'])
    assert(admissionEngineCases.some(item=>item.name===name));
});
