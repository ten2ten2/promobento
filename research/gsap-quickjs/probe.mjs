// Container-only research entrypoint. Use run.mjs; never execute this on the host.
// Not imported by applications/tests or included in the admission image.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {parseCanonicalJson} from '../../packages/contracts/index.mjs';
import {summarizeProbe} from './summary.mjs';

const EXPECTED_SHA256='c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280'; // gsap 3.14.2 dist/gsap.min.js
if(process.argv[2]!=='--isolated')throw Error('Use research/gsap-quickjs/run.mjs');
const path='/probe-input/gsap.min.js';
const library=readFileSync(path,'utf8');
const sha256=createHash('sha256').update(library).digest('hex');
if(sha256!==EXPECTED_SHA256)throw Error('GSAP_BYTES_MISMATCH: '+sha256);

// Use the exact QuickJS build pinned by the renderer package.
const require=createRequire(new URL('../../apps/renderer/package.json',import.meta.url));
const {newQuickJSWASMModule,DefaultIntrinsics}=await import(require.resolve('quickjs-emscripten'));
const quickjsVersion=parseCanonicalJson(readFileSync(require.resolve('quickjs-emscripten/package.json'),'utf8')).version;

// Approximates the admission engine's ambient-capability removal: no native Date
// intrinsic, Math.random throws, timers/window/console are frozen to undefined.
// It does NOT reproduce the real bootstrap, module evaluation, memory limit,
// interrupt handler or prepare/draw API. The trusted runner supplies outer Docker
// isolation; globalThis and intrinsic objects/prototypes are not deeply frozen.
const HARDEN=`(()=>{const define=Object.defineProperty;
define(Math,'random',{value:()=>{throw Error('ADMISSION_CAPABILITY_UNAVAILABLE')},writable:false,configurable:false});
for(const key of ['Date','Intl','Temporal','performance','crypto','setTimeout','setInterval','setImmediate','clearTimeout',
  'clearInterval','clearImmediate','queueMicrotask','requestAnimationFrame','cancelAnimationFrame','window','document',
  'navigator','console','self','process','require','module'])
  define(globalThis,key,{value:undefined,writable:false,configurable:false});})();`;

// Private deterministic clock and inert timers passed as parameters; the global
// object keeps its hardened undefined values. The UMD bundle takes the CommonJS branch.
const wrap=(shimmed,body)=>`(function(Date,setTimeout,clearTimeout){var module={exports:{}},exports=module.exports;
${library}
var gsap=exports.gsap||exports.default;${body}})(${shimmed?'{now:function(){return 0}},function(){return 0},function(){}':'undefined,undefined,undefined'})`;

// seek(t) keeps GSAP's default suppressEvents=true; seek(t,false) lets callbacks run.
const seekBody=(build,order,events=false)=>`var o={x:0,y:0,r:0,updates:0};var tl=gsap.timeline({paused:true});${build}
var out=[];${JSON.stringify(order)}.forEach(function(t){${events?'tl.seek(t,false);':'tl.seek(t);'}out.push([t,+o.x.toFixed(4),+o.y.toFixed(4),+o.r.toFixed(4),o.updates]);});
return JSON.stringify(out);`;

const cases=[
  {name:'unshimmed-load',shimmed:false,order:[0],
    build:``,question:'Does the UMD bundle load when the hardened globals are all undefined?'},
  {name:'absolute-values-timeline-position',shimmed:true,order:[0,0.5,1.2,0.3,1.2,1.3],
    build:`tl.to(o,{x:100,duration:1,ease:'power2.inOut'}).to(o,{y:50,r:90,duration:0.5,ease:'back.out(2)'},'-=0.2');`,
    question:'Absolute end values with a relative timeline position ("-=0.2", resolved while building).'},
  {name:'relative-property-forward',shimmed:true,order:[0,0.5,1,1.5,2],
    build:`tl.to(o,{x:'+=100',duration:1}).to(o,{x:'+=100',duration:1});`,
    question:'Relative property values ("+=100") under a forward seek order.'},
  {name:'relative-property-late-first-seek',shimmed:true,order:[2,1.5,1,0.5,0],
    build:`tl.to(o,{x:'+=100',duration:1}).to(o,{x:'+=100',duration:1});`,
    question:'The same relative values when the first seek lands at the end.'},
  {name:'onupdate-suppressed-by-seek',shimmed:true,order:[0,0.5,1],
    build:`tl.to(o,{x:100,duration:1,onUpdate:function(){o.updates++;}});`,
    question:'Does the default seek(t) run onUpdate? (suppressEvents defaults to true.)'},
  {name:'onupdate-not-suppressed',shimmed:true,order:[0,0.5,1],
    build:`tl.to(o,{x:100,duration:1,onUpdate:function(){o.updates++;}});`,events:true,
    question:'Stateful onUpdate when events are not suppressed (seek(t,false)).'}
];

const module=await newQuickJSWASMModule();
const results=[];
for(const item of cases) {
  // A fresh runtime per case so no state crosses cases.
  const runtime=module.newRuntime(),vm=runtime.newContext({intrinsics:{...DefaultIntrinsics,Date:false}});
  try {
    const hardened=vm.evalCode(HARDEN+'true');
    if(hardened.error){const error=vm.dump(hardened.error);hardened.error.dispose();throw Error('HARDEN_FAILED: '+JSON.stringify(error));}
    hardened.value.dispose();
    const result=vm.evalCode(wrap(item.shimmed,seekBody(item.build,item.order,item.events)),'probe.js');
    if(result.error) {
      try {results.push({name:item.name,question:item.question,shimmed:item.shimmed,order:item.order,status:'error',error:vm.dump(result.error).message});}
      finally {result.error.dispose();}
    } else {
      try {results.push({name:item.name,question:item.question,shimmed:item.shimmed,order:item.order,status:'ok',samples:parseCanonicalJson(vm.dump(result.value))});}
      finally {result.value.dispose();}
    }
  } finally {vm.dispose();runtime.dispose();}
}
let summary,summaryError;
try {summary=summarizeProbe(results);} catch(error) {summaryError=error.message;process.exitCode=1;}
process.stdout.write(JSON.stringify({kind:'gsap_quickjs_probe',research:true,productionDependency:false,
  versions:{gsap:'3.14.2',gsapMinSha256:sha256,quickjsEmscripten:quickjsVersion,node:process.versions.node},
  environment:'approximate_hardening_not_admission_bootstrap',sampleDecimalPlaces:4,results,
  ...(summaryError?{summaryError}:{summary})},null,2)+'\n');
