// Fixed internal calibration probes. No caller-supplied code, hosts, paths or commands.
import {readFileSync,readdirSync,openSync,closeSync} from 'node:fs';
import {Resolver} from 'node:dns/promises';
import net from 'node:net';
import {parseCanonicalJson} from '@promobento/contracts/canonical';

export async function pageIsolation(page){
 const expected=parseCanonicalJson(readFileSync(new URL('../../../tests/attacks/film-v1/isolation.json',import.meta.url))).expected;
 const actual=await page.evaluate(()=>{
  const code=fn=>{try{fn();return'ALLOWED';}catch(error){return error.name==='EvalError'?'EvalError':error.message;}};
  const engine=window.__omEngine;try{window.__omEngine={};}catch{}
  return{
   fetch:code(()=>fetch('https://example.com/')),fileFetch:code(()=>fetch('file:///proc/self/environ')),
   webSocket:code(()=>new WebSocket('wss://example.com/')),beacon:code(()=>navigator.sendBeacon('https://example.com/','')),
   storage:code(()=>localStorage.getItem('x')),indexedDb:code(()=>indexedDB.open('x')),cookie:code(()=>document.cookie),
   iframe:code(()=>document.createElement('iframe')),worker:code(()=>new Worker('data:text/javascript,0')),
   eval:code(()=>eval('1+1')),functionConstructor:code(()=>new Function('return 1')()),
   wasm:typeof WebAssembly==='undefined'?'unavailable':'ALLOWED',
   nodeGlobals:typeof process==='undefined'&&typeof require==='undefined'&&typeof Buffer==='undefined'?'unavailable':'ALLOWED',
   engineMutation:engine===window.__omEngine&&Object.isFrozen(engine)?'locked':'ALLOWED'
  };
 });
 const images=await page.evaluate(async()=>{
  const violations=[],listener=event=>violations.push({directive:event.effectiveDirective,blockedUri:event.blockedURI});
  document.addEventListener('securitypolicyviolation',listener);
  try{
   const samples=[];
   for(const url of ['https://example.com/g1-isolation.png','http://127.0.0.1:8080/healthz','file:///proc/self/environ']){
    const image=document.createElement('img');
    const outcome=await new Promise(resolve=>{image.onload=()=>resolve('loaded');image.onerror=()=>resolve('blocked');image.src=url;});
    image.remove();samples.push({url,outcome});
   }
   return{samples,violations};
  }finally{document.removeEventListener('securitypolicyviolation',listener);}
 });
 const passed=Object.keys(expected).every(key=>actual[key]===expected[key])&&images.samples.every(item=>item.outcome==='blocked')
  &&images.violations.some(item=>item.directive==='img-src'&&item.blockedUri==='https://example.com/g1-isolation.png');
 return{passed,expected,actual,images};
}

// Called by the already separated launcher uid, not by the controller or a root helper.
export function uidIsolation(){
 if(process.platform!=='linux'||process.getuid()!==10002)throw Error('CHROMIUM_UID_REQUIRED');
 const processes=readdirSync('/proc').filter(pid=>/^\d+$/.test(pid)),controllers=[],chrome=[];
 const blocked=(pid,file)=>{
  try{
   if(file==='mem'){const fd=openSync('/proc/'+pid+'/mem','r');closeSync(fd);}
   else{const bytes=readFileSync('/proc/'+pid+'/environ');bytes.fill(0);}
   return{blocked:false,code:'READABLE'};
  }catch(error){return{blocked:['EACCES','EPERM'].includes(error.code),code:error.code??'UNKNOWN'};}
 };
 for(const pid of processes){
  let cmd;try{cmd=readFileSync('/proc/'+pid+'/cmdline','utf8');}catch{continue;}
  if(cmd.includes('apps/render-container/src/controller.mjs'))controllers.push({environ:blocked(pid,'environ'),memory:blocked(pid,'mem')});
  if(cmd.includes('/opt/chrome-headless-shell-linux64/chrome-headless-shell')){
   try{
    const raw=readFileSync('/proc/'+pid+'/environ'),names=raw.toString().split('\0').filter(Boolean).map(value=>value.split('=',1)[0]);raw.fill(0);
    chrome.push({readable:true,environmentKeys:names.sort(),onlyWhitelistedKeys:names.every(key=>['PATH','HOME','LANG','FONTCONFIG_FILE'].includes(key))});
   }catch(error){chrome.push({readable:false,code:error.code??'UNKNOWN'});}
  }
 }
 return{passed:controllers.length===1&&controllers.every(item=>item.environ.blocked&&item.memory.blocked)&&chrome.length>0
  &&chrome.some(item=>item.readable)&&chrome.filter(item=>item.readable).every(item=>item.onlyWhitelistedKeys),uid:process.getuid(),controllers,chromium:chrome};
}

export async function hostIsolation(task,signal){
 const denied=async name=>{
  try{await fetch(name,{signal:AbortSignal.any([signal,AbortSignal.timeout(1500)])});return{blocked:false,outcome:'response_received'};}
  catch(error){return{blocked:true,outcome:error.cause?.code??error.name};}
 };
 const resolver=new Resolver({timeout:1200,tries:1});
 const dns=resolver.resolve4('example.com').then(()=>({blocked:false,outcome:'resolved'}),error=>({blocked:true,outcome:error.code??error.name})).finally(()=>resolver.cancel());
 const tcp=new Promise(resolve=>{
  const socket=net.createConnection({host:'1.1.1.1',port:443});
  const finish=(blocked,outcome)=>{socket.destroy();resolve({blocked,outcome});};
  socket.setTimeout(1500,()=>finish(true,'timeout'));socket.once('connect',()=>finish(false,'connected'));socket.once('error',error=>finish(true,error.code??error.name));
 });
 const [http,https,ip,dnsResult,tcpResult]=await Promise.all([denied('http://example.com/'),denied('https://example.com/'),denied('http://1.1.1.1/'),dns,tcp]);
 const network={http,https,directIp:ip,dns:dnsResult,tcp443:tcpResult};
 const key=task.inputs.find(item=>item.name==='film')?.key;if(!key)throw Error('TASK_INPUT_MISSING');
 const path=key.split('/').map(encodeURIComponent).join('/'),auth='Bearer '+task.brokerToken,broker={};
 for(const [name,url,headers,method,body]of [
  ['authorizedRead','r/'+path,{authorization:auth},'GET'],
  ['missingToken','r/'+path,{},'GET'],['wrongToken','r/'+path,{authorization:'Bearer deliberately-invalid'},'GET'],
  ['outsideRead','r/evals/g1-isolation-outside-scope',{authorization:auth},'GET'],
  ['outsideWrite','w/evals/g1-isolation-outside-scope',{authorization:auth,'content-length':'1'},'PUT','x']
 ]){
  const response=await fetch('http://broker.internal/'+url,{headers,method,body,signal:AbortSignal.any([signal,AbortSignal.timeout(5000)])});
  broker[name]=response.status;await response.body?.cancel();
 }
 return{passed:Object.values(network).every(item=>item.blocked)&&broker.authorizedRead===200
  &&['missingToken','wrongToken','outsideRead','outsideWrite'].every(name=>broker[name]===403),network,broker};
}
