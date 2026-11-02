import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {privateExisting,privateNewDirectory,privateWritableDirectory,writePrivateFile} from './private-path.mjs';

test('private directory and report admission rejects symlinks and escaped parent paths',()=>{
 mkdirSync('artifacts',{recursive:true});
 const directory=mkdtempSync(join(resolve('artifacts'),'private-boundary-'));
 const outside=mkdtempSync(join(tmpdir(),'promobento-untrusted-'));
 try{
  const alias=join(directory,'escape');symlinkSync(outside,alias);
  writeFileSync(join(outside,'report.json'),'{}');
  assert.equal(privateExisting(directory),directory);
  assert.equal(privateWritableDirectory(directory),directory);
  assert.equal(privateNewDirectory(join(directory,'new','nested')),join(directory,'new','nested'));
  for(const path of [alias,join(alias,'report.json')]){
   assert.throws(()=>privateExisting(path,path.endsWith('.json')?'file':'directory'),/PRIVATE_ARTIFACT_DIRECTORY_REQUIRED/);
  }
  for(const fn of [privateNewDirectory,privateWritableDirectory]){
   assert.throws(()=>fn(join(alias,'new')),/PRIVATE_ARTIFACT_DIRECTORY_REQUIRED/);
  }
  symlinkSync(join(outside,'report.json'),join(directory,'linked.json'));
  assert.throws(()=>privateExisting(join(directory,'linked.json'),'file'),/PRIVATE_ARTIFACT_DIRECTORY_REQUIRED/);
  assert.equal(existsSync(join(outside,'new')),false);
 }finally{rmSync(directory,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('legacy capture, selection, preparation and recovery entrypoints fence symlinked directories',()=>{
 mkdirSync('artifacts',{recursive:true});
 const directory=mkdtempSync(join(resolve('artifacts'),'eval-entry-boundary-'));
 const outside=mkdtempSync(join(tmpdir(),'promobento-entry-outside-'));
 try{
  const alias=join(directory,'escape');symlinkSync(outside,alias);
  writeFileSync(join(outside,'report.json'),'{}');
  for(const [script,args,code] of [
   ['capture-materials.mjs',[alias],'PRIVATE_ARTIFACT_DIRECTORY_REQUIRED'],
   ['select-materials.mjs',[alias],'PRIVATE_ARTIFACT_DIRECTORY_REQUIRED'],
   ['prepare-inputs.mjs',[join(alias,'new'),'renderer-'+'a'.repeat(12)],'EVAL_PRIVATE_DIRECTORY_AND_PINNED_RENDERER_REQUIRED'],
   ['recover-case.mjs',[join(alias,'report.json')],'PRIVATE_CASE_REPORT_REQUIRED'],
  ]){
   const result=spawnSync(process.execPath,['research/evals/'+script,...args],{encoding:'utf8',timeout:10000});
   assert.equal(result.status,1,script);
   assert.match(result.stderr,new RegExp(code),script);
  }
  assert.equal(existsSync(join(outside,'new')),false);
 }finally{rmSync(directory,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('private output writes reject direct links, dangling links and linked parents',()=>{
 mkdirSync('artifacts',{recursive:true});
 const directory=mkdtempSync(join(resolve('artifacts'),'private-write-'));
 const outside=mkdtempSync(join(tmpdir(),'promobento-write-outside-'));
 try{
  const victim=join(outside,'victim.txt');writeFileSync(victim,'unchanged');
  const file=join(directory,'safe.txt');writePrivateFile(file,'created',{exclusive:true});
  assert.equal(readFileSync(file,'utf8'),'created');
  assert.throws(()=>writePrivateFile(file,'overwritten',{exclusive:true}),/EEXIST/);
  assert.equal(readFileSync(file,'utf8'),'created');
  writePrivateFile(file,'updated');assert.equal(readFileSync(file,'utf8'),'updated');
  symlinkSync(victim,join(directory,'linked.txt'));
  assert.throws(()=>writePrivateFile(join(directory,'linked.txt'),'overwritten'),/PRIVATE_ARTIFACT_FILE_INVALID/);
  symlinkSync(join(outside,'nonexistent.txt'),join(directory,'dangling.txt'));
  assert.throws(()=>writePrivateFile(join(directory,'dangling.txt'),'overwritten'),/PRIVATE_ARTIFACT_FILE_INVALID/);
  const hardlinkSource=join(directory,'other-owner.txt'),hardlink=join(directory,'hardlink.txt');
  writeFileSync(hardlinkSource,'untouched original');linkSync(hardlinkSource,hardlink);
  writePrivateFile(hardlink,'local replacement');
  assert.equal(readFileSync(hardlink,'utf8'),'local replacement');
  assert.equal(readFileSync(hardlinkSource,'utf8'),'untouched original');
  symlinkSync(outside,join(directory,'escape'));
  assert.throws(()=>writePrivateFile(join(directory,'escape','victim.txt'),'overwritten'),/PRIVATE_ARTIFACT_DIRECTORY_REQUIRED/);
  assert.equal(readFileSync(victim,'utf8'),'unchanged');
 }finally{rmSync(directory,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('legacy capture and selection refuse linked output manifests before launching a browser',()=>{
 mkdirSync('artifacts',{recursive:true});
 const directory=mkdtempSync(join(resolve('artifacts'),'private-manifest-'));
 const outside=mkdtempSync(join(tmpdir(),'promobento-manifest-outside-'));
 try{
  const victim=join(outside,'victim.json');writeFileSync(victim,'unchanged');
  for(const [script,name,code] of [
   ['capture-materials.mjs','capture.json','CAPTURE_REPORT_ALREADY_EXISTS'],
   ['select-materials.mjs','selected.json','PRIVATE_SELECTION_PATH_INVALID']
  ]){
   const link=join(directory,name);symlinkSync(victim,link);
   const result=spawnSync(process.execPath,['research/evals/'+script,directory],{encoding:'utf8',timeout:10000});
   assert.equal(result.status,1,script);assert.match(result.stderr,new RegExp(code),script);
   assert.equal(readFileSync(victim,'utf8'),'unchanged');
  }
 }finally{rmSync(directory,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('a new private input directory can be prepared in a checkout without artifacts yet',()=>{
 const root=mkdtempSync(join(tmpdir(),'promobento-new-checkout-')),before=process.cwd();
 try{
  process.chdir(root);
  const output=join(root,'artifacts','new-selection');
  assert.equal(privateNewDirectory('artifacts/new-selection'),output);
  assert.equal(existsSync(join(root,'artifacts')),true);
 }finally{process.chdir(before);rmSync(root,{recursive:true,force:true});}
});

test('a symlinked artifacts root is not a trusted private root',()=>{
 const checkout=mkdtempSync(join(tmpdir(),'promobento-root-checkout-'));
 const outside=mkdtempSync(join(tmpdir(),'promobento-root-outside-'));
 const before=process.cwd();
 try{
  process.chdir(checkout);symlinkSync(outside,'artifacts');
  assert.throws(()=>privateNewDirectory('artifacts/new-selection'),/PRIVATE_ARTIFACT_DIRECTORY_REQUIRED/);
  assert.throws(()=>privateWritableDirectory('artifacts/new-selection'),/PRIVATE_ARTIFACT_DIRECTORY_REQUIRED/);
  assert.equal(existsSync(join(outside,'new-selection')),false);
 }finally{process.chdir(before);rmSync(checkout,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
