// Fixed internal calibration probes. No caller-supplied code, hosts, paths or commands.
import {readFileSync,readdirSync,openSync,closeSync} from 'node:fs';
import {Resolver} from 'node:dns/promises';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {sha256Bytes} from '@promobento/contracts/digest';

export async function collectIsolation({sandbox,token,probes}){
 const report={scope:'S1_fixed_network_token_uid_and_browser_corpus_not_S2_arbitrary_code_faults',passed:true,sandbox};
 for(const [stage,probe]of Object.entries(probes)){
  try{report[stage]=await probe();}
  catch(error){
   // Fixed probe code/hosts only: no input, headers, environment values or complete stack.
   report[stage]={passed:false,error:{name:String(error.name??'Error'),code:String(error.code??error.cause?.code??'UNKNOWN'),
    message:String(error.message??error).split(token).join('[redacted]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi,'Bearer [redacted]').slice(0,500)}};
  }
  if(report[stage].passed!==true)report.passed=false;
 }
 return report;
}

export async function pageIsolation(page,evaluate=page.evaluate.bind(page)){
 const expected=parseCanonicalJson(readFileSync(new URL('../../../tests/attacks/film-v1/isolation.json',import.meta.url))).expected;
 await evaluate(()=>{
  const script=document.createElement('script');script.id='pb-isolation-script';script.src='/runtime/isolation-probe.js';
  window.__pbIsolationState='loading';script.onload=()=>window.__pbIsolationState='loaded';script.onerror=()=>window.__pbIsolationState='failed';
  document.head.appendChild(script);
 });
 let actual;
 try{
  const until=Date.now()+5000;
  while(Date.now()<until){
   const value=await evaluate(()=>({state:window.__pbIsolationState,actual:window.__pbIsolationProbe??null}));
   if(value.state==='failed')throw Error('ISOLATION_PAGE_LOAD_FAILED');
   if(value.state==='loaded'){if(!value.actual)throw Error('ISOLATION_PAGE_RESULTS_MISSING');actual=value.actual;break;}
   await delay(25); // Let the normal script run between debugger evaluations, not inside one.
  }
  if(!actual)throw Error('ISOLATION_PAGE_TIMEOUT');
 }finally{await evaluate(()=>{document.getElementById('pb-isolation-script')?.remove();delete window.__pbIsolationProbe;delete window.__pbIsolationState;}).catch(()=>{});}
 const images=await evaluate(async()=>{
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
 return{passed,execution:'normal_same_origin_script_not_CDP_string_compilation',expected,actual,images};
}

/** Detect the token without giving the uid-10002 probe its bearer value. Inspect all bytes, not guessed env fields. */
export function inspectChromiumEnvironment(bytes,{fingerprint,tokenByteLength,browser}){
 let tokenFound=false;
 for(let offset=0;offset+tokenByteLength<=bytes.length;offset++)if(sha256Bytes(bytes.subarray(offset,offset+tokenByteLength))===fingerprint){tokenFound=true;break;}
 const report={readable:true,browser,byteLength:bytes.length,tokenFound};
 if(browser){
  const entries=bytes.toString('utf8').split('\0').filter(Boolean),allowed=['PATH','HOME','LANG','FONTCONFIG_FILE'];
  const names=entries.map(value=>value.includes('=')?value.slice(0,value.indexOf('=')):null);
  report.environmentKeys=names.filter(name=>allowed.includes(name)).sort();
  report.unexpectedEntryCount=names.filter(name=>!allowed.includes(name)).length;
  report.onlyWhitelistedKeys=names.length===allowed.length&&new Set(names).size===allowed.length&&report.unexpectedEntryCount===0;
 }
 return report;
}

// Called by the already separated launcher uid, not by the controller or a root helper.
export function uidIsolation({fingerprint,tokenByteLength}){
 if(process.platform!=='linux'||process.getuid()!==10002)throw Error('CHROMIUM_UID_REQUIRED');
 if(!/^[a-f0-9]{64}$/.test(fingerprint??'')||!Number.isSafeInteger(tokenByteLength)||tokenByteLength<16||tokenByteLength>16384)throw Error('ISOLATION_SCOPE_INVALID');
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
    const raw=readFileSync('/proc/'+pid+'/environ');
    try{chrome.push(inspectChromiumEnvironment(raw,{fingerprint,tokenByteLength,browser:!cmd.includes('--type=')}));}finally{raw.fill(0);}
   }catch(error){chrome.push({readable:false,code:error.code??'UNKNOWN'});}
  }
 }
 const browsers=chrome.filter(item=>item.browser);
 return{passed:controllers.length===1&&controllers.every(item=>item.environ.blocked&&item.memory.blocked)&&chrome.length>0
  &&browsers.length===1&&browsers[0].onlyWhitelistedKeys===true&&chrome.every(item=>item.readable&&item.tokenFound===false),
  tokenCheck:'SHA256_fingerprint_scan_of_all_readable_process_environment_bytes_no_bearer_transfer',uid:process.getuid(),controllers,chromium:chrome};
}

export async function hostIsolation(task,signal){
 // Positive/scope controls precede deliberate unreachable connections, whose pools may linger.
 const key=task.inputs.find(item=>item.name==='film')?.key;if(!key)throw Error('TASK_INPUT_MISSING');
 const film=task.inputs.find(item=>item.name==='film'),path=key.split('/').map(encodeURIComponent).join('/'),auth='Bearer '+task.brokerToken,broker={},brokerDiagnostics={};
 const brokerDeadline=Date.now()+15000;
 for(const [name,url,headers,method,body]of [
  ['authorizedRead','r/'+path,{authorization:auth},'GET'],
  ['missingToken','r/'+path,{},'GET'],['wrongToken','r/'+path,{authorization:'Bearer deliberately-invalid'},'GET'],
  ['outsideRead','r/evals/g1-isolation-outside-scope',{authorization:auth},'GET'],
  ['outsideWrite','w/evals/g1-isolation-outside-scope',{authorization:auth,'content-length':'1'},'PUT','x']
 ]){
  const started=Date.now();broker[name]=null;
  if(started>=brokerDeadline){brokerDiagnostics[name]={status:'not_run',reason:'host_probe_deadline'};continue;}
  try{
   const response=await fetch('http://broker.internal/'+url,{headers,method,body,signal:AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(5000,brokerDeadline-started)))])});
   broker[name]=response.status;
   // Drain the small, fixed probe response. Cancelling a proxied R2 stream can itself stall.
   const bytes=new Uint8Array(await response.arrayBuffer());
   brokerDiagnostics[name]={status:'completed',elapsedMs:Date.now()-started,bodyBytes:bytes.length};
   if(name==='authorizedRead'&&bytes.length!==film.byteLength)brokerDiagnostics[name]={status:'failed',code:'BROKER_BODY_LENGTH_MISMATCH',elapsedMs:Date.now()-started};
  }catch(error){brokerDiagnostics[name]={status:'failed',name:String(error.name??'Error'),code:String(error.cause?.code??error.code??'UNKNOWN'),elapsedMs:Date.now()-started};}
 }
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
 return{passed:Object.values(network).every(item=>item.blocked)&&broker.authorizedRead===200
  &&['missingToken','wrongToken','outsideRead','outsideWrite'].every(name=>broker[name]===403)
  &&Object.values(brokerDiagnostics).every(item=>item.status==='completed'),network,broker,brokerDiagnostics};
}
