import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {discoverLocalMaterials} from './discover-local-materials.mjs';

test('local media discovery lists private candidates without copying bytes or granting rights',()=>{
 const local=mkdtempSync(join(tmpdir(),'pb-discovery-')),outputs=mkdtempSync(resolve('artifacts/.local-discovery-test-'));
 try{
  const source=join(local,'project');mkdirSync(source);mkdirSync(join(source,'screens'));mkdirSync(join(source,'node_modules'));mkdirSync(join(source,'.private'));
  writeFileSync(join(source,'screens','first.png'),'unread media');writeFileSync(join(source,'screens','demo.MP4'),'unread video');
  writeFileSync(join(source,'node_modules','skip.png'),'ignored');writeFileSync(join(source,'.private','skip.svg'),'ignored');
  writeFileSync(join(local,'outside.png'),'outside');symlinkSync(join(local,'outside.png'),join(source,'escape.png'));
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}]};
  const denied=join(outputs,'denied');assert.throws(()=>discoverLocalMaterials({sourceDir:source,sourceUrl:'local://wrong',outputDir:denied,card}),/LOCAL_SOURCE_APPROVAL_REQUIRED/);assert.equal(existsSync(denied),false);
  const out=join(outputs,'approved'),result=discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:out,card});
  assert.deepEqual(result.candidates.map(item=>[item.sourceFile,item.kind]),[['screens/demo.MP4','video'],['screens/first.png','image']]);
  assert.ok(result.candidates.every(item=>item.review==='pending_rights_and_visual_review'));assert.equal(result.skippedSymlinks,1);
  assert.deepEqual(JSON.parse(readFileSync(join(out,'candidates.json'))),result);assert.equal(existsSync(join(out,'first.png')),false);
  assert.throws(()=>discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:out,card}),/NEW_PRIVATE_OUTPUT_REQUIRED/);
 }finally{rmSync(local,{recursive:true,force:true});rmSync(outputs,{recursive:true,force:true});}
});
