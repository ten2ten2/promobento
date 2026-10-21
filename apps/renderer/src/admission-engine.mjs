import {DefaultIntrinsics,newQuickJSWASMModule,newVariant,RELEASE_SYNC} from 'quickjs-emscripten';
import {canonical,parseCanonicalJson} from '@promobento/contracts';
import {randomAt} from '@promobento/composition-runtime';
import {admissionTextMeasurement} from './admission-fonts.mjs';

const declarationNames=['editables','markers','regions','videoUses','fonts'];
const clock=performance.now.bind(performance);
const ownKeys=(value,names)=>value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).length===names.length && names.every(name=>Object.hasOwn(value,name));

/** The pinned WASM binary starts at 16 MiB. memoryBytes caps its entire linear
 * memory, including runtime/allocator overhead, not just author-visible objects.
 */
export function admissionWasmMemoryDescriptor(memoryBytes) {
  if(!Number.isSafeInteger(memoryBytes) || memoryBytes<16777216 || memoryBytes>268435456 || memoryBytes%65536)
    throw Error('ADMISSION_ENGINE_LIMITS_INVALID');
  return Object.freeze({initial:256,maximum:memoryBytes/65536});
}

/** Inert validation only: importing this module never creates a VM or evaluates source.
 * Full declarations/values/target admission belongs to the external trusted controller.
 */
export function admissionEngineOptions({source,input,declarations,limits,profile='canvas-commands-v1'}={}) {
  if(!['canvas-commands-v1','canvas-media-v1'].includes(profile))throw Error('ADMISSION_PROFILE_INVALID');
  if(typeof source!=='string' || !source.length || !source.isWellFormed() || Buffer.byteLength(source)>1048576)
    throw Error('ADMISSION_SOURCE_INVALID');
  if(!ownKeys(limits,['memoryBytes','stackBytes','callTimeoutMs','maxOutputBytes'])
    || Object.values(limits).some(value=>!Number.isSafeInteger(value))
    || limits.stackBytes<65536 || limits.stackBytes>4194304 || limits.stackBytes>=limits.memoryBytes
    || limits.callTimeoutMs<1 || limits.callTimeoutMs>30000
    || limits.maxOutputBytes<1024 || limits.maxOutputBytes>1048576)
    throw Error('ADMISSION_ENGINE_LIMITS_INVALID');
  admissionWasmMemoryDescriptor(limits.memoryBytes);
  if(!ownKeys(input,['targetId','width','height','fps','totalFrames','seed','values'])
    || typeof input.targetId!=='string' || !input.targetId.length || input.targetId.length>128
    || ![input.width,input.height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=8192)
    || input.fps!==30 || ![450,900].includes(input.totalFrames)
    || typeof input.seed!=='string' || !input.seed.isWellFormed() || input.seed.length>1024
    || !input.values || typeof input.values!=='object' || Array.isArray(input.values))
    throw Error('ADMISSION_ENGINE_INPUT_INVALID');
  const inputText=canonical(input);
  if(Buffer.byteLength(inputText)>1048576)throw Error('ADMISSION_ENGINE_INPUT_TOO_LARGE');
  if(!ownKeys(declarations,['schemaVersion','kind',...declarationNames])
    || declarations.schemaVersion!=='2.7.0' || declarations.kind!=='runtime_declarations'
    || declarationNames.some(name=>!Array.isArray(declarations[name])))
    throw Error('ADMISSION_ENGINE_DECLARATIONS_INVALID');
  if(profile==='canvas-commands-v1'&&(declarations.videoUses.length || declarations.fonts.length))throw Error('ADMISSION_CAPABILITY_UNAVAILABLE');
  const declarationsText=canonical(declarations);
  if(Buffer.byteLength(declarationsText)>1048576)throw Error('ADMISSION_ENGINE_DECLARATIONS_TOO_LARGE');
  return Object.freeze({source,inputText,declarationsText,limits:Object.freeze({...limits})});
}

// This trusted bootstrap runs before any composition. Its returned functions are
// retained as private VM handles, never installed on the guest global object.
// JSON.stringify is transport only; the host parses/canonicalizes with contracts.
const bootstrap=String.raw`(() => {
  'use strict';
  const own=Object.getOwnPropertyDescriptor, names=Object.getOwnPropertyNames;
  const symbols=Object.getOwnPropertySymbols, proto=Object.getPrototypeOf;
  const create=Object.create, define=Object.defineProperty, freeze=Object.freeze;
  const isArray=Array.isArray, finite=Number.isFinite, stringify=JSON.stringify, parse=JSON.parse;
  const apply=Reflect.apply, ObjectPrototype=Object.prototype, ArrayPrototype=Array.prototype;
  const ErrorType=Error, SetType=Set;
  const deny=()=>{throw new ErrorType('ADMISSION_CAPABILITY_UNAVAILABLE');};
  define(Math,'random',{value:deny,writable:false,configurable:false});
  for(const key of ['Date','Intl','Temporal','performance','crypto','setTimeout','setInterval',
    'setImmediate','clearTimeout','clearInterval','clearImmediate','queueMicrotask','requestAnimationFrame',
    'cancelAnimationFrame','fetch','XMLHttpRequest','WebSocket','WebTransport','EventSource','Worker',
    'SharedWorker','SharedArrayBuffer','Atomics','WeakRef','FinalizationRegistry','WebAssembly','process','require','module','Buffer',
    'window','document','navigator','location','console','print','std','os']) {
    define(globalThis,key,{value:undefined,writable:false,configurable:false});
  }
  // Prevent prototype replacement from altering the trusted adapters. This is
  // defense within the VM; its separate heap, not freezing, is the host boundary.
  const frozen=new SetType();
  const harden=value=>{
    if((typeof value!=='object' || value===null) && typeof value!=='function')return value;
    if(frozen.has(value))return value;
    frozen.add(value);
    for(const key of names(value)) {
      const descriptor=own(value,key);
      if(descriptor && 'value' in descriptor)harden(descriptor.value);
      if(descriptor?.get)harden(descriptor.get);
      if(descriptor?.set)harden(descriptor.set);
    }
    for(const key of symbols(value)) {
      const descriptor=own(value,key);
      if(descriptor && 'value' in descriptor)harden(descriptor.value);
    }
    harden(proto(value));return freeze(value);
  };
  for(const key of names(globalThis)) {
    const descriptor=own(globalThis,key);
    if(descriptor && 'value' in descriptor && descriptor.value!==globalThis)harden(descriptor.value);
  }
  freeze(globalThis);
  const data=(object,key)=>{
    if(!object || (typeof object!=='object' && typeof object!=='function'))throw new ErrorType('DATA_OBJECT_REQUIRED');
    const descriptor=own(object,key);
    if(!descriptor || !('value' in descriptor))throw new ErrorType('DATA_PROPERTY_REQUIRED');
    return descriptor.value;
  };
  const exact=(object,keys)=>{
    const actual=names(object);
    if(symbols(object).length || actual.length!==keys.length)throw new ErrorType('UNEXPECTED_PROPERTIES');
    for(const key of actual)if(!keys.includes(key))throw new ErrorType('UNEXPECTED_PROPERTIES');
  };
  const serialize=(value,maxBytes)=>{
    const parents=new SetType();let size=0,nodes=0;
    const charge=count=>{size+=count;if(size>maxBytes)throw new ErrorType('OUTPUT_TOO_LARGE');};
    const copy=(item,depth)=>{
      if(depth>64 || ++nodes>100000)throw new ErrorType('OUTPUT_TOO_COMPLEX');
      if(item===null || typeof item==='boolean'){charge(5);return item;}
      if(typeof item==='number'){if(!finite(item))throw new ErrorType('FINITE_NUMBER_REQUIRED');charge(24);return item;}
      if(typeof item==='string') {if(item.length>maxBytes)throw new ErrorType('OUTPUT_TOO_LARGE');charge(stringify(item).length);return item;}
      if(typeof item!=='object' || parents.has(item) || symbols(item).length)throw new ErrorType('JSON_DATA_REQUIRED');
      const array=isArray(item),prototype=proto(item);
      if(prototype!==(array?ArrayPrototype:ObjectPrototype) && prototype!==null)throw new ErrorType('JSON_DATA_REQUIRED');
      parents.add(item);charge(2);
      const result=array?[]:create(null),keys=names(item);
      if(array) {
        const length=data(item,'length');
        if(!Number.isSafeInteger(length) || length<0 || length>100000 || keys.length!==length+1)
          throw new ErrorType('JSON_ARRAY_REQUIRED');
        for(let index=0;index<length;index++) {
          const descriptor=own(item,String(index));
          if(!descriptor?.enumerable || !('value' in descriptor))throw new ErrorType('JSON_ARRAY_REQUIRED');
          result.push(copy(descriptor.value,depth+1));charge(1);
        }
      } else for(const key of keys) {
        const descriptor=own(item,key);
        if(!descriptor?.enumerable || !('value' in descriptor))throw new ErrorType('JSON_DATA_REQUIRED');
        charge(stringify(key).length+2);
        define(result,key,{value:copy(descriptor.value,depth+1),enumerable:true});
      }
      parents.delete(item);return result;
    };
    return stringify(copy(value,0));
  };
  let definition,prepared,draw,release,outputLimit,assertSync;
  return freeze({
    inspect(namespace,maxBytes) {
      definition=data(namespace,'default');
      exact(definition,['apiVersion','editables','markers','regions','videoUses','fonts','prepare']);
      if(data(definition,'apiVersion')!=='2.7.0' || typeof data(definition,'prepare')!=='function')
        throw new ErrorType('COMPOSITION_INVALID');
      const declarations=create(null);
      define(declarations,'schemaVersion',{value:'2.7.0',enumerable:true});
      define(declarations,'kind',{value:'runtime_declarations',enumerable:true});
      for(const name of ['editables','markers','regions','videoUses','fonts'])
        define(declarations,name,{value:data(definition,name),enumerable:true});
      return serialize(declarations,maxBytes);
    },
    prepare(contextText,randomAt,maxBytes,checkSync,measureText) {
      const context=parse(contextText);outputLimit=maxBytes;assertSync=checkSync;
      define(context,'randomAt',{value:randomAt,enumerable:true});
      if(measureText)define(context,'measureText',{value:(fontId,text,fontSize,weight)=>harden(parse(measureText(fontId,text,fontSize,weight))),enumerable:true});
      harden(context);
      prepared=apply(data(definition,'prepare'),definition,[context]);
      assertSync(prepared);
      exact(prepared,['draw','dispose']);
      draw=data(prepared,'draw');release=data(prepared,'dispose');
      if(typeof draw!=='function' || typeof release!=='function')throw new ErrorType('PREPARED_COMPOSITION_INVALID');
    },
    draw(frameIndex) {
      const result=apply(draw,prepared,[freeze({numerator:frameIndex,denominator:30})]);
      assertSync(result);
      return serialize(result,outputLimit);
    },
    dispose() {
      const result=apply(release,prepared,[]);
      if(result!==undefined)throw new ErrorType('DISPOSE_MUST_BE_SYNCHRONOUS_VOID');
      prepared=undefined;draw=undefined;release=undefined;definition=undefined;
    }
  });
})()`;

/** Execute only inside the independently limited, credential-free task container.
 * No composition executes in Node or the capture browser: every guest operation,
 * including property inspection and serialization, stays in this private WASM VM.
 * The caller owns the OS deadline, command schema/regions, frame IDs and receipts.
 */
export async function createAdmissionEngine(options) {
  const checked=admissionEngineOptions(options),{source,inputText,declarationsText,limits}=checked;
  const input=parseCanonicalJson(inputText);
  // 0.32.0's Emscripten malloc_usable_size is unavailable: QuickJS's reported
  // allocation counter can count only per-block overhead. Its runtime limit is
  // supplementary; the supplied WebAssembly.Memory enforces the actual bytes.
  const wasmMemory=new WebAssembly.Memory(admissionWasmMemoryDescriptor(limits.memoryBytes));
  const QuickJS=await newQuickJSWASMModule(newVariant(RELEASE_SYNC,{wasmMemory})),runtime=QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);runtime.setMaxStackSize(limits.stackBytes);
  let deadline=0,interrupted=false,closed=false,failed=false,importAttempted=false,vm;
  const handles=[];
  runtime.setInterruptHandler(()=>interrupted || (interrupted=clock()>=deadline));
  // Static and dynamic imports have no filesystem or network resolver.
  const rejectImport=()=>{importAttempted=true;throw Error('ADMISSION_IMPORT_FORBIDDEN');};
  runtime.setModuleLoader(rejectImport,rejectImport);
  const retain=handle=>{handles.push(handle);return handle;};
  const close=()=>{
    if(closed)return;closed=true;
    for(const handle of handles.reverse())if(handle.alive)handle.dispose();
    try {if(vm?.alive)vm.dispose();}finally {if(runtime.alive)runtime.dispose();}
  };
  const assertSynchronous=handle=>{
    // Native promise-brand inspection, not guest instanceof/then/constructor.
    const state=vm.getPromiseState(handle);
    if(state.notAPromise)return;
    state.value?.dispose();
    if(state.type==='rejected')state.error.dispose();
    throw Error('ADMISSION_ASYNC_FORBIDDEN');
  };
  const run=(stage,operation)=>{
    if(closed || failed)throw Error('ADMISSION_ENGINE_CLOSED');
    deadline=clock()+limits.callTimeoutMs;interrupted=false;
    let result;
    try {
      result=operation();
      if(result.error) {
        result.error.dispose();result=undefined;
        throw Error(interrupted?'ADMISSION_CALL_TIMEOUT: '+stage:'ADMISSION_GUEST_REJECTED: '+stage);
      }
      const handle=result.value;
      assertSynchronous(handle);
      if(interrupted || clock()>=deadline)throw Error('ADMISSION_CALL_TIMEOUT: '+stage);
      if(importAttempted)throw Error('ADMISSION_IMPORT_FORBIDDEN');
      if(runtime.hasPendingJob())throw Error('ADMISSION_ASYNC_FORBIDDEN: '+stage);
      result=undefined;return handle;
    } catch(error) {
      result?.value?.dispose();failed=true;throw error;
    }
  };
  const readText=(handle,maximum)=>{
    try {
      if(vm.typeof(handle)!=='string')throw Error('ADMISSION_JSON_OUTPUT_REQUIRED');
      const text=vm.getString(handle);
      if(Buffer.byteLength(text)>maximum)throw Error('ADMISSION_OUTPUT_TOO_LARGE');
      return text;
    } finally {handle.dispose();}
  };
  const invoke=(stage,method,args)=>run(stage,()=>vm.callFunction(method,vm.undefined,...args));
  try {
    // Never install the native clock intrinsic. A guest may invent a same-name
    // pure function; global freezing is auxiliary, not capability isolation.
    vm=runtime.newContext({intrinsics:{...DefaultIntrinsics,Date:false}});
    const host=retain(run('bootstrap',()=>vm.evalCode(bootstrap,'admission-bootstrap.js',{type:'global'})));
    const methods=Object.fromEntries(['inspect','prepare','draw','dispose'].map(name=>[name,retain(vm.getProp(host,name))]));
    const random=retain(vm.newFunction('randomAt',key=>{
      if(vm.typeof(key)!=='string')throw Error('RANDOM_KEY_INVALID');
      const text=vm.getString(key);
      if(text.length>65536)throw Error('RANDOM_KEY_TOO_LONG');
      return vm.newNumber(randomAt(input.seed,text));
    }));
    const synchronous=retain(vm.newFunction('assertSynchronous',handle=>{assertSynchronous(handle);return vm.undefined;}));
    const module=retain(run('module',()=>vm.evalCode(source,'composition.mjs',{type:'module'})));
    const declarationLimit=retain(vm.newNumber(1048576));
    const actual=parseCanonicalJson(readText(invoke('declarations',methods.inspect,[module,declarationLimit]),1048576));
    if(canonical(actual)!==declarationsText)throw Error('ADMISSION_DECLARATIONS_MISMATCH');
    const context=retain(vm.newString(inputText)),outputLimit=retain(vm.newNumber(limits.maxOutputBytes));
    const measurement=options.profile==='canvas-media-v1'?retain(vm.newFunction('measureText',(fontId,text,fontSize,weight)=>{
      if(vm.typeof(fontId)!=='string'||vm.typeof(text)!=='string'||vm.typeof(fontSize)!=='number'||vm.typeof(weight)!=='number')throw Error('ADMISSION_TEXT_INVALID');
      const {width,ascent,descent}=admissionTextMeasurement(options.declarations,vm.getString(fontId),vm.getString(text),vm.getNumber(fontSize),vm.getNumber(weight));
      return vm.newString(canonical({width,ascent,descent}));
    })):vm.undefined;
    invoke('prepare',methods.prepare,[context,random,outputLimit,synchronous,measurement]).dispose();
    return Object.freeze({
      draw(frameIndex) {
        if(closed || failed)throw Error('ADMISSION_ENGINE_CLOSED');
        if(!Number.isSafeInteger(frameIndex)||frameIndex<0||frameIndex>=input.totalFrames)throw Error('FRAME_OUT_OF_RANGE');
        const frame=vm.newNumber(frameIndex);
        try {
          try {
            const text=readText(invoke('draw',methods.draw,[frame]),limits.maxOutputBytes);
            return parseCanonicalJson(text);
          } finally {if(frame.alive)frame.dispose();}
        } catch(error) {failed=true;close();throw error;}
      },
      dispose() {
        if(closed)return;
        try {if(!failed)invoke('dispose',methods.dispose,[]).dispose();}
        finally {close();}
      }
    });
  } catch(error) {close();throw error;}
}
