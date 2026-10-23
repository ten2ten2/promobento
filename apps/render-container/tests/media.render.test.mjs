// Necessary repair scope: the failing journey/CDP path, one real movie, and owner listening artifacts.
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '@promobento/contracts/canonical';
import {mediaFixture} from './media-fixture.mjs';
import {audioSamples} from './audio-samples.mjs';
if(process.platform!=='linux'||process.getuid()!==10001||process.env.PROMOBENTO_BROWSER_TEST_CONTAINER!=='1')throw Error('BROWSER_TEST_REQUIRES_ISOLATED_CI_CONTAINER');
const output='/work/film-runtime';mkdirSync(output,{recursive:true});
const root=new URL('../../../',import.meta.url),read=path=>parseCanonicalJson(readFileSync(new URL(path,root)));
const report={scope:'media_repair_not_full_browser_matrix_or_G1',status:'running'};
const failures=[];
try{
  try{report.media=await mediaFixture(output,read('config/platform-presets.json'),read('apps/render-container/environment.lock.json'));}
  catch(error){failures.push(String(error.stack??error));}
  try{report.programStyleSamples=await audioSamples(output+'/audio-samples');}
  catch(error){failures.push(String(error.stack??error));}
  report.status=failures.length?'failed':'passed';report.failures=failures;
  if(failures.length)throw Error('MEDIA_REPAIR_CHECK_FAILED');
}finally{writeFileSync(output+'/report.json',canonical(report));}
