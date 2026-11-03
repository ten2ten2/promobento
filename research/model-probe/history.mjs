// Revalidates the frozen opening inventory against its primary reports. New
// pricing rules must not rewrite previously recorded estimates or its identity.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';

const probeRuns=['39904369687','39904908372','39919957207','39920866987'];
export function historicalModelSpend(root=new URL('../../',import.meta.url)){
 const authorization=parseCanonicalJson(readFileSync(new URL('config/model-authorization.json',root)));
 const opening=parseCanonicalJson(readFileSync(new URL('docs/evidence/2026-10-23-model-probe/opening-spend.json',root)));
 const invalid=()=>{throw Error('HISTORICAL_SPEND_SNAPSHOT_MISMATCH');};
 if(!Array.isArray(opening.entries)||new Set(opening.entries.map(entry=>entry.id)).size!==opening.entries.length
  ||authorization.unreconciledHistoryAllowance?.openingManifestHash&&digest(opening)!==authorization.unreconciledHistoryAllowance.openingManifestHash)invalid();
 const recorded=new Map(opening.entries.map(entry=>[entry.id,entry]));
 const entries=[],sources=[];
 for(const[index,run]of probeRuns.entries()){
  const source=`docs/evidence/2026-10-23-model-probe/run${index+1}.json`,report=parseCanonicalJson(readFileSync(new URL(source,root)));sources.push(source);
  const visit=(value,path,model)=>{
   if(!value||typeof value!=='object')return;
   if(Number.isInteger(value.status)){
    const entry={id:`probe/${run}/${model}/${path.join('/')}`,source:source+'#/models/'+model+'/'+path.join('/'),model:'modelswitch/'+model,status:value.status,usage:value.usage??null};
    const prior=recorded.get(entry.id);if(!prior)invalid();
    const {quote,...identity}=prior;if(canonical(identity)!==canonical(entry))invalid();
    entries.push({...entry,quote});return;
   }
   for(const[key,child]of Object.entries(value))visit(child,[...path,key],model);
  };
  for(const[model,value]of Object.entries(report.models))visit(value,[],model);
 }
 const inventory={kind:'historical_model_spend',authorizationId:digest({approvedBy:authorization.approvedBy,approvedAt:authorization.approvedAt}),scope:'all_model_spend_before_shared_ledger',sources,entries};
 if(canonical(inventory)!==canonical(opening))invalid();return inventory;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const inventory=historicalModelSpend();if(!process.argv[2])throw Error('OUTPUT_PATH_REQUIRED');writeFileSync(process.argv[2],canonical(inventory)+'\n');
 console.log(canonical({calls:inventory.entries.length,catalogEstimateMicros:inventory.entries.reduce((sum,entry)=>sum+(entry.quote?.usdMicros??0),0),unpriced:inventory.entries.filter(entry=>entry.quote===null).map(entry=>entry.id)}));
}
