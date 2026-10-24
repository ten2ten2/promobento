// Loaded as a normal same-origin script: CSP string-compilation checks must not inherit CDP privileges.
(() => {
 'use strict';
 const code=fn=>{try{fn();return'ALLOWED';}catch(error){return error.name==='EvalError'?'EvalError':error.message;}};
 const engine=window.__omEngine;try{window.__omEngine={};}catch{}
 const actual={
  fetch:code(()=>fetch('https://example.com/')),fileFetch:code(()=>fetch('file:///proc/self/environ')),
  webSocket:code(()=>new WebSocket('wss://example.com/')),beacon:code(()=>navigator.sendBeacon('https://example.com/','')),
  storage:code(()=>localStorage.getItem('x')),indexedDb:code(()=>indexedDB.open('x')),cookie:code(()=>document.cookie),
  iframe:code(()=>document.createElement('iframe')),worker:code(()=>new Worker('data:text/javascript,0')),
  eval:code(()=>eval('1+1')),functionConstructor:code(()=>new Function('return 1')()),
  wasm:typeof WebAssembly==='undefined'?'unavailable':'ALLOWED',
  nodeGlobals:typeof process==='undefined'&&typeof require==='undefined'&&typeof Buffer==='undefined'?'unavailable':'ALLOWED',
  engineMutation:engine===window.__omEngine&&Object.isFrozen(engine)?'locked':'ALLOWED'
 };
 Object.defineProperty(window,'__pbIsolationProbe',{value:Object.freeze(actual),configurable:true});
})();
