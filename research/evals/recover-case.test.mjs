import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

test('terminal recovery revokes a secret after an unacknowledged remote write',()=>{
 mkdirSync('artifacts',{recursive:true});
 const directory=mkdtempSync(resolve('artifacts/.recovery-secret-test-'));
 try{
  const reportPath=join(directory,'report.json'),marker=join(directory,'remote-secret'),calls=join(directory,'calls.jsonl');
  writeFileSync(reportPath,JSON.stringify({scope:'internal_eval_only',publicUseCleared:false,status:'failed',operationId:'eval-fixture-1234567890123'}));
  // Simulate a remote write that succeeded before the CLI lost its response.
  // The stub never records the key or makes a network call.
  writeFileSync(join(directory,'pnpm'),`#!${process.execPath}\nimport {appendFileSync,writeFileSync,unlinkSync} from 'node:fs';
const action=process.argv[process.argv.indexOf('secret')+1];
appendFileSync(${JSON.stringify(calls)},JSON.stringify(action)+'\\n');
if(action==='list')console.log('[]');
else if(action==='put'){writeFileSync(${JSON.stringify(marker)},'created');process.exit(1);}
else if(action==='delete')unlinkSync(${JSON.stringify(marker)});
else process.exit(2);
`,{mode:0o700});
  const result=spawnSync(process.execPath,['research/evals/recover-case.mjs',reportPath],{
   env:{...process.env,PATH:directory+delimiter+process.env.PATH},encoding:'utf8',timeout:10000});
  assert.equal(result.status,1,'the failed recovery remains a failure');
  assert.deepEqual(readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse),['list','put','delete'],result.stderr);
  assert.equal(existsSync(marker),false);
  const report=JSON.parse(readFileSync(reportPath,'utf8'));
  assert.equal(report.internalKeyRevoked,true);assert.equal(report.cleanupStatus,'unconfirmed');
 }finally{rmSync(directory,{recursive:true,force:true});}
});
