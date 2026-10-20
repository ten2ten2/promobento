import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {generateReference} from './build-agent-reference.mjs';
import {load,targets} from './contract-validation.mjs';
const ui=load('config/ui-tokens.json'),html=readFileSync(new URL('../'+ui.reference.output,import.meta.url),'utf8'),failures=[];
const policy=load('config/agent-policy.json');
if(html!==generateReference())failures.push('Reference output differs from current sources');
for(const s of ['Offline design reference.','STATIC DESIGN SAMPLE — NOT A VIDEO FRAME','no generated video','no external network requests','value="15"','value="30"','max="899"','Buy &amp; export']){
 if(!html.includes(s))failures.push('Missing reference boundary/control: '+s);
}
for(const t of targets())if(!html.includes('value="'+t.targetId+'"'))failures.push('Missing legal target '+t.targetId);
const data=html.match(/<script id="reference-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
try{
 const boot=JSON.parse(data),skus=Object.entries(policy.quota).filter(([,q])=>Number.isSafeInteger(q?.priceMinor)).map(([sku])=>sku).sort();
 if(JSON.stringify(Object.keys(boot.offers).sort())!==JSON.stringify(skus))failures.push('Reference saleable offers differ from catalog');
 for(const sku of skus){
  if(!html.includes('<option value="'+sku+'">'))failures.push('Missing offer selector '+sku);
  for(const field of ['priceMinor','versionUnits','creative_generate','agent_patch'])if(boot.offers[sku][field]!==policy.quota[sku][field])failures.push('Reference entitlement drift: '+sku+'.'+field);
 }
 if(boot.trial.creative_generate!==policy.quota.free.creative_generate||boot.trial.agent_patch!==policy.quota.free.agent_patch||boot.trial.directionCards!==policy.quota.free.directionCardsPerCreativeRun)failures.push('Reference trial differs from policy');
 if(boot.editLimits.maxComments!==policy.patch.maxCommentsPerRound||boot.editLimits.maxCharacters!==policy.patch.maxTotalCommentCodePoints)failures.push('Reference edit limits differ from policy');
}catch(e){failures.push('Invalid reference data: '+e.message);}
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g))if(!match[1].includes('application/json')){
 try{new Script(match[2],{filename:ui.reference.output});}catch(e){failures.push('Reference JavaScript syntax: '+e.message);}
}
for(const id of ['state','offer','also-export','purchase','comments','comment-count','submit-round'])if(!html.includes('id="'+id+'"'))failures.push('Missing current purchase/edit control: '+id);
if(/\b(?:src|href)\s*=\s*["']https?:/i.test(html)||/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/.test(html))failures.push('Offline reference makes an external request');
if(/@@[A-Z_]+@@/.test(html))failures.push('Unresolved template token');
if(!html.includes('--rail:'+ui.layout.editorSceneWidth+'px')||!html.includes('--inspector:'+ui.layout.editorInspectorWidth+'px'))failures.push('Reference dimensions differ from tokens');
if(!html.includes('--font-mono:'+ui.typography.monospaceFontFamily)||!html.includes('--wordmark-weight:'+ui.typography.styles.wordmark.fontWeight)||!html.includes('--section-weight:'+ui.typography.styles.sectionTitle.fontWeight))failures.push('Reference typography differs from tokens');
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Current Studio reference passed source, target, catalog, trial, edit-limit, JavaScript syntax, token and offline-boundary checks. Browser rendering is a separate test.');
