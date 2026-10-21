/** Source strings only. Importing this inventory does not execute a composition.
 * The isolated integration runner, never the ordinary host unit suite, consumes it.
 */
export const admissionCaseDeclarations=Object.freeze({schemaVersion:'2.7.0',kind:'runtime_declarations',
  editables:[],markers:[],regions:[],videoUses:[],fonts:[]});
export const admissionCaseInput=Object.freeze({targetId:'instagram_feed:square',width:1080,height:1080,
  fps:30,totalFrames:450,seed:'admission-test-1',values:{}});

const definition=({before='',prepare='',draw='',dispose='',fields=''}={})=>`${before}
export default {
  apiVersion:'2.7.0',editables:[],markers:[],regions:[],videoUses:[],fonts:[],${fields}
  prepare(context) {${prepare}
    return {
      draw(time) {${draw}
        return {commands:[{op:'rect',x:time.numerator,y:context.randomAt('y')*10,width:100,height:100,color:'#ff0000',opacity:1}],regions:[]};
      },
      dispose() {${dispose}}
    };
  }
};`;

export const admissionValidSource=definition();

export const admissionEngineCases=Object.freeze([
  {name:'normal-source',source:admissionValidSource,expected:'success'},
  {name:'same-frame-random-at',source:definition({draw:"if(context.randomAt('x')!==context.randomAt('x'))throw Error('unstable');"}),expected:'success'},
  {name:'no-ambient-capabilities',source:definition({before:`
    for (const key of ['Date','Intl','Temporal','performance','crypto','setTimeout','setInterval','queueMicrotask',
      'requestAnimationFrame','fetch','XMLHttpRequest','WebSocket','Worker','SharedArrayBuffer','Atomics','WeakRef','FinalizationRegistry',
      'process','require','window','document','navigator','std','os']) {
      if(globalThis[key]!==undefined)throw Error(key+' leaked');
    }
    if((()=>{}).constructor('return globalThis')()!==globalThis)throw Error('wrong realm');
    let blocked=false;try {Math.random();}catch {blocked=true;}if(!blocked)throw Error('random exposed');
  `}),expected:'success'},
  {name:'host-callback-no-host-global',source:definition({prepare:`
    const global=context.randomAt.constructor('return globalThis')();
    if(global.process!==undefined || global.fetch!==undefined || global.Date!==undefined)throw Error('host global leaked');
  `}),expected:'success'},
  {name:'date-name-is-not-clock-capability',source:definition({before:`
    const replacement=()=>1;
    try {Object.defineProperty(globalThis,'Date',{value:replacement});}catch {}
    if(globalThis.Date!==undefined && globalThis.Date!==replacement)throw Error('native Date recovered');
    if(globalThis.Date?.now!==undefined)throw Error('native clock recovered');
    if(globalThis.Date===replacement && globalThis.Date()!==1)throw Error('unexpected Date implementation');
  `}),expected:'success'},
  {name:'module-wall-clock',source:definition({before:'Date.now();'}),expected:'reject',phase:'create'},
  {name:'module-intl-wall-clock',source:definition({before:'new Intl.DateTimeFormat().format();'}),expected:'reject',phase:'create'},
  {name:'module-random',source:definition({before:'Math.random();'}),expected:'reject',phase:'create'},
  {name:'module-timer',source:definition({before:'setTimeout(()=>{},0);'}),expected:'reject',phase:'create'},
  {name:'module-animation-loop',source:definition({before:'requestAnimationFrame(()=>{});'}),expected:'reject',phase:'create'},
  {name:'module-network',source:definition({before:"fetch('https://example.com');"}),expected:'reject',phase:'create'},
  {name:'module-file-access',source:definition({before:"require('node:fs').readFileSync('/etc/passwd');"}),expected:'reject',phase:'create'},
  {name:'module-import',source:"import 'node:fs';\n"+admissionValidSource,expected:'reject',phase:'create'},
  {name:'module-data-import',source:"import 'data:text/javascript,export default 1';\n"+admissionValidSource,expected:'reject',phase:'create'},
  {name:'module-dynamic-import',source:definition({before:"import('node:fs');"}),expected:'reject',phase:'create'},
  {name:'module-promise-job',source:definition({before:'Promise.resolve().then(()=>{globalThis.hidden=1;});'}),expected:'reject',phase:'create'},
  {name:'module-top-level-await',source:definition({before:'await Promise.resolve();'}),expected:'reject',phase:'create'},
  {name:'module-loop',source:definition({before:'while(true){}'}),expected:'reject',phase:'create',timeout:true},
  {name:'module-memory',source:definition({before:'const retained=[];while(true)retained.push(new Array(65536).fill(123));'}),expected:'reject',phase:'create'},
  {name:'module-large-arraybuffer',source:definition({before:'const retained=new ArrayBuffer(64*1024*1024);'}),expected:'reject',phase:'create'},
  {name:'prototype-tamper',source:definition({before:'Object.prototype.trusted=true;'}),expected:'reject',phase:'create'},
  {name:'json-tamper',source:definition({before:"JSON.stringify=()=>'{\"commands\":[]}';"}),expected:'reject',phase:'create'},
  {name:'date-recovery',source:definition({before:"try {Object.defineProperty(globalThis,'Date',{value:()=>1});}catch {} Date.now();"}),expected:'reject',phase:'create'},
  {name:'declaration-getter',source:definition({fields:'get markers(){while(true){}} ,'}),expected:'reject',phase:'create'},
  {name:'declaration-mismatch',source:admissionValidSource.replace('regions:[]','regions:[{id:"unexpected",label:"Unexpected"}]'),expected:'reject',phase:'create'},
  {name:'declaration-proxy-loop',source:`const value=${admissionValidSource.replace('export default ','').trim().replace(/;$/u,'')};
    export default new Proxy(value,{ownKeys(){while(true){}}});`,expected:'reject',phase:'create',timeout:true},
  {name:'prepare-loop',source:definition({prepare:'while(true){}'}),expected:'reject',phase:'create',timeout:true},
  {name:'prepare-never-promise',source:definition({prepare:'return new Promise(()=>{});'}),expected:'reject',phase:'create'},
  {name:'prepare-async',source:admissionValidSource.replace('prepare(context)','async prepare(context)'),expected:'reject',phase:'create'},
  {name:'prepare-disguised-promise',source:definition({prepare:`
    const promise=Promise.resolve();Object.setPrototypeOf(promise,Object.prototype);
    promise.draw=()=>({commands:[]});promise.dispose=()=>{};return promise;
  `}),expected:'reject',phase:'create'},
  {name:'context-mutation',source:definition({prepare:'context.values.extra=1;'}),expected:'reject',phase:'create'},
  {name:'draw-loop',source:definition({draw:'while(true){}'}),expected:'reject',phase:'draw',timeout:true},
  {name:'draw-recursion',source:definition({draw:'function recurse(){return recurse();}recurse();'}),expected:'reject',phase:'draw'},
  {name:'draw-memory',source:definition({draw:'const retained=[];while(true)retained.push(new Array(65536).fill(123));'}),expected:'reject',phase:'draw'},
  {name:'draw-large-arraybuffer',source:definition({draw:'const retained=new ArrayBuffer(64*1024*1024);'}),expected:'reject',phase:'draw'},
  {name:'draw-promise',source:definition({draw:'return Promise.resolve({commands:[]});'}),expected:'reject',phase:'draw'},
  {name:'draw-disguised-promise',source:definition({draw:`
    const promise=Promise.resolve();Object.setPrototypeOf(promise,Object.prototype);promise.commands=[];return promise;
  `}),expected:'reject',phase:'draw'},
  {name:'draw-microtask',source:definition({draw:'Promise.resolve().then(()=>{});'}),expected:'reject',phase:'draw'},
  {name:'draw-getter',source:definition({draw:'return {get commands(){while(true){}}};'}),expected:'reject',phase:'draw'},
  {name:'draw-proxy-loop',source:definition({draw:'return new Proxy({commands:[]},{ownKeys(){while(true){}}});'}),expected:'reject',phase:'draw',timeout:true},
  {name:'draw-tojson-loop',source:definition({draw:'return {commands:[],toJSON(){while(true){}}};'}),expected:'reject',phase:'draw'},
  {name:'draw-cycle',source:definition({draw:'const result={commands:[]};result.loop=result;return result;'}),expected:'reject',phase:'draw'},
  {name:'draw-infinite-number',source:definition({draw:'return {commands:[Infinity]};'}),expected:'reject',phase:'draw'},
  {name:'draw-output-limit',source:definition({draw:"return {commands:[],padding:'x'.repeat(1048577)};"}),expected:'reject',phase:'draw'},
  {name:'draw-error-getter',source:definition({draw:'throw new Proxy({},{get(){while(true){}}});'}),expected:'reject',phase:'draw'},
  {name:'dispose-loop',source:definition({dispose:'while(true){}'}),expected:'reject',phase:'dispose',timeout:true},
  {name:'dispose-promise',source:definition({dispose:'return Promise.resolve();'}),expected:'reject',phase:'dispose'},
  // Valid JSON is still untrusted draw data. The external command validator must
  // reject extra fields rather than treating this as a host-generated receipt.
  {name:'forged-receipt-data',source:definition({draw:"return {commands:[],event:'frame-ready',frameIndex:0,manifestHash:'forged'};"}),
    expected:'command-reject',phase:'draw'}
].map(item=>Object.freeze(item)));
