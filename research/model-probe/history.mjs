// Converts primary reports to an opening inventory, never an assertion that unknown usage cost zero.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {modelUsageQuote} from '../../packages/contracts/src/models.mjs';

export const probeRuns=['39904369687','39904908372','39919957207','39920866987'];
export function historicalModelSpend(root=new URL('../../',import.meta.url)){
 const authorization=parseCanonicalJson(readFileSync(new URL('config/model-authorization.json',root))),providers=parseCanonicalJson(readFileSync(new URL('docs/evidence/2026-10-23-model-probe/pricing-catalog.json',root)));
 const entries=[],sources=[];
 for(const[index,run]of probeRuns.entries()){
  const source=`docs/evidence/2026-10-23-model-probe/run${index+1}.json`,report=parseCanonicalJson(readFileSync(new URL(source,root)));sources.push(source);
  const visit=(value,path,model)=>{
   if(!value||typeof value!=='object')return;
   if(Number.isInteger(value.status)){
    const ref='modelswitch/'+model,usage=value.usage??null,quote=providers.models[ref]?modelUsageQuote(ref,usage,providers):null;
    entries.push({id:`probe/${run}/${model}/${path.join('/')}`,source:source+'#/models/'+model+'/'+path.join('/'),model:ref,status:value.status,usage,quote});return;
   }
   for(const[key,child]of Object.entries(value))visit(child,[...path,key],model);
  };
  for(const[model,value]of Object.entries(report.models))visit(value,[],model);
 }
 return{kind:'historical_model_spend',authorizationId:digest({approvedBy:authorization.approvedBy,approvedAt:authorization.approvedAt}),scope:'all_model_spend_before_shared_ledger',sources,entries};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const inventory=historicalModelSpend();if(!process.argv[2])throw Error('OUTPUT_PATH_REQUIRED');writeFileSync(process.argv[2],canonical(inventory)+'\n');
 console.log(canonical({calls:inventory.entries.length,catalogEstimateMicros:inventory.entries.reduce((sum,entry)=>sum+(entry.quote?.usdMicros??0),0),unpriced:inventory.entries.filter(entry=>entry.quote===null).map(entry=>entry.id)}));
}
