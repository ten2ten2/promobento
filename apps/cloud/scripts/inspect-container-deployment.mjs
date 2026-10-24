// Read only the metadata Wrangler needs after a staging Worker upload.
import {mkdirSync,writeFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '../../../packages/contracts/src/canonical.mjs';

const {GITHUB_ACTIONS,CLOUDFLARE_API_TOKEN:token,CLOUDFLARE_ACCOUNT_ID:account,INSPECT_VERSION_ID:version,GITHUB_SHA}=process.env;
if(GITHUB_ACTIONS!=='true'||!token||!account||!/^[a-f0-9-]{36}$/.test(version??''))throw Error('DEPLOYMENT_DIAGNOSIS_SCOPE_INVALID');
const directory='artifacts/container-deployment';mkdirSync(directory,{recursive:true});
const report={scope:'read_only_exact_staging_container_deployment',versionId:version,harnessSha:GITHUB_SHA,reads:[],modelCalls:0,renderCalls:0};
const save=()=>writeFileSync(directory+'/report.json',canonical(report)+'\n');save();
async function read(name,path,select){
  const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,
    {headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
  const value=parseCanonicalJson(await response.text()),ok=response.ok&&value.success!==false;
  report.reads.push({name,status:response.status,ok,...(ok?{result:select(value.result)}:
    {errors:(value.errors??[]).map(error=>({code:error.code??null,message:error.message??'Unknown API error'}))})});save();
  return ok?value.result:null;
}
const metadata=await read('version','/workers/scripts/promobento-staging/versions/'+version,value=>({
  id:value.id,bindings:value.resources?.bindings?.filter(binding=>binding.type==='durable_object_namespace')??[],
  containers:value.resources?.script_runtime?.containers??[]}));
const namespace=metadata?.resources?.bindings?.find(binding=>binding.type==='durable_object_namespace'&&binding.class_name==='ShardDO')?.namespace_id;
if(namespace){
  if(!/^[a-f0-9]{32}$/.test(namespace))throw Error('DEPLOYMENT_NAMESPACE_INVALID');
  await read('application','/containers/applications/'+namespace,value=>({id:value.id,name:value.name,
    scheduling_policy:value.scheduling_policy,durable_objects:value.durable_objects,configuration:value.configuration??{}}));
}
if(!namespace||report.reads.some(read=>!read.ok))throw Error('DEPLOYMENT_METADATA_UNVERIFIED');
console.log(canonical(report));
