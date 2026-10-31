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
  writeFileSync(join(source,'README.md'),'![Product](screens/first.png)\n<img src="https://example.com/remote.png">\n![Outside](../outside.png)');
  writeFileSync(join(source,'screens','style.css'),'/* #000000 */ .thing { color: #AABBCC; font-family: "Fixture Sans", sans-serif; } .other { background: #abc; font-family: "Fixture Sans"; }');
  writeFileSync(join(source,'node_modules','skip.png'),'ignored');writeFileSync(join(source,'.private','skip.svg'),'ignored');
  writeFileSync(join(local,'outside.png'),'outside');symlinkSync(join(local,'outside.png'),join(source,'escape.png'));
  const card={topicId:'fixture',status:'confirmed_for_s1_eval',confirmation:{confirmedBy:'owner',scope:'s1-first-internal-evaluation'},rights:{scope:'internal_eval_only',publicUseCleared:false},assetSources:[{kind:'local_project_media',url:'local://fixture'}]};
  const denied=join(outputs,'denied');assert.throws(()=>discoverLocalMaterials({sourceDir:source,sourceUrl:'local://wrong',outputDir:denied,card}),/LOCAL_SOURCE_APPROVAL_REQUIRED/);assert.equal(existsSync(denied),false);
  const out=join(outputs,'approved'),result=discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:out,card});
  assert.deepEqual(result.candidates.map(item=>[item.sourceFile,item.kind]),[['screens/demo.MP4','video'],['screens/first.png','image']]);
  assert.ok(result.candidates.every(item=>item.review==='pending_rights_and_visual_review'));assert.equal(result.skippedSymlinks,1);
  assert.equal(result.styleObservations,undefined,'existing discovery does not read styles unless requested');
  assert.equal(result.readmeObservation,undefined,'existing discovery does not read README unless requested');
  assert.deepEqual(JSON.parse(readFileSync(join(out,'candidates.json'))),result);assert.equal(existsSync(join(out,'first.png')),false);
  const referenced=discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:join(outputs,'readme'),card,preferReadme:true});
  assert.equal(referenced.candidates[0].sourceFile,'screens/first.png');assert.equal(referenced.candidates[0].featuredInReadme,true);
  assert.deepEqual(referenced.candidates.filter(item=>item.featuredInReadme).map(item=>item.sourceFile),['screens/first.png']);
  assert.deepEqual(referenced.readmeObservation,{sourceFile:'README.md',scope:'local_references_only_not_asset_permission'});
  const styles=discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:join(outputs,'styles'),card,observeStyles:true}).styleObservations;
  assert.deepEqual(styles.colours.map(item=>item.value),['#aabbcc','#abc']);assert.deepEqual(styles.fonts,[{value:'Fixture Sans',count:2,sources:['screens/style.css']}]);
  assert.equal(styles.filesRead,1);assert.match(styles.scope,/not_font_or_asset_permission/);
  writeFileSync(join(source,'screens','theme.scss'),'$accent: oklch(65% 0.2 140); .brand { background: rgb(10 20 30 / 0.5); font-family: "Display Fixture"; }');
  writeFileSync(join(source,'screens','theme.less'),'@ink: hsl(120 30% 40%); .button { color: rgba(1, 2, 3, .8); }');
  const extended=discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:join(outputs,'extended'),card,observeStyles:true}).styleObservations;
  assert.deepEqual(extended.colours.filter(item=>item.sources.includes('screens/theme.scss')).map(item=>item.value),['oklch(65% 0.2 140)','rgb(10 20 30 / 0.5)']);
  assert.deepEqual(extended.colours.filter(item=>item.sources.includes('screens/theme.less')).map(item=>item.value),['hsl(120 30% 40%)','rgba(1, 2, 3, .8)']);
  assert.ok(extended.fonts.some(item=>item.value==='Display Fixture'&&item.sources.includes('screens/theme.scss')));
  writeFileSync(join(source,'screens','many.css'),Array.from({length:101},(_,index)=>`.c${index}{color:#${index.toString(16).padStart(6,'0')}}`).join('\n'));
  const limited=discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:join(outputs,'limited'),card,observeStyles:true});
  assert.equal(limited.styleObservations.colours.length,100);assert.ok(limited.missing.includes('style_value_limit'));
  assert.throws(()=>discoverLocalMaterials({sourceDir:source,sourceUrl:'local://fixture',outputDir:out,card}),/NEW_PRIVATE_OUTPUT_REQUIRED/);
 }finally{rmSync(local,{recursive:true,force:true});rmSync(outputs,{recursive:true,force:true});}
});
