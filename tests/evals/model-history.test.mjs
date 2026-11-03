import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest} from '@promobento/contracts/digest';
import {modelUsageQuote} from '../../packages/contracts/src/models.mjs';
import {historicalModelSpend} from '../../research/model-probe/history.mjs';

test('historical opening stays frozen when current pricing cannot settle an old cache-write estimate',()=>{
 const history=historicalModelSpend(),base='docs/evidence/2026-10-23-model-probe/';
 const opening=parseCanonicalJson(readFileSync(base+'opening-spend.json'));
 const authorization=parseCanonicalJson(readFileSync('config/model-authorization.json'));
 assert.equal(canonical(history),canonical(opening));
 assert.equal(digest(history),authorization.unreconciledHistoryAllowance.openingManifestHash);
 const entry=history.entries.find(entry=>entry.id==='probe/39920866987/claude-opus-5-5/stream');
 assert.equal(entry.quote.usdMicros,42224,'the original estimate remains historical evidence');
 assert.equal(modelUsageQuote(entry.model,entry.usage,parseCanonicalJson(readFileSync(base+'pricing-catalog.json'))),null,
  'unspecified cache TTL is unknown under the current rules, not a new zero-cost settlement');
});

test('historical opening refuses changed primary reports and a rewritten frozen quote',()=>{
 const root=mkdtempSync(join(tmpdir(),'promobento-model-history-')),base='docs/evidence/2026-10-23-model-probe/';
 try{
  for(const file of ['config/model-authorization.json',...['opening-spend.json','run1.json','run2.json','run3.json','run4.json'].map(name=>base+name)]){
   const target=join(root,file);mkdirSync(dirname(target),{recursive:true});copyFileSync(file,target);
  }
  const url=pathToFileURL(root+'/'),reportPath=join(root,base,'run1.json');
  const report=parseCanonicalJson(readFileSync(reportPath));report.models['deepseek-v4.1-flash-1017'].basic.usage.prompt_tokens++;
  writeFileSync(reportPath,canonical(report));
  assert.throws(()=>historicalModelSpend(url),/HISTORICAL_SPEND_SNAPSHOT_MISMATCH/);
  copyFileSync(base+'run1.json',reportPath);
  const openingPath=join(root,base,'opening-spend.json'),opening=parseCanonicalJson(readFileSync(openingPath));
  opening.entries[0].quote.usdMicros=0;writeFileSync(openingPath,canonical(opening));
  assert.throws(()=>historicalModelSpend(url),/HISTORICAL_SPEND_SNAPSHOT_MISMATCH/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
