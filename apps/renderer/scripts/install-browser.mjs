import {mkdtempSync,readFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {environmentLock,browserDirectory,browserExecutable,sha256} from '../src/environment.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('M0a renderer requires Linux x64; use its CI job on other hosts');
const lock=environmentLock.browser;
if (existsSync(browserExecutable()) && sha256(readFileSync(browserExecutable()))===lock.executableSha256) {
  console.log('Pinned Chrome Headless Shell is installed and its executable hash matches.');
} else {
  const temporary=mkdtempSync(join(tmpdir(),'promobento-browser-download-'));
  try {
    const archive=join(temporary,'browser.zip');
    execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','180',lock.url,'-o',archive],{stdio:'inherit',timeout:185000});
    if (sha256(readFileSync(archive))!==lock.archiveSha256) throw new Error('BROWSER_ARCHIVE_HASH_MISMATCH');
    mkdirSync(browserDirectory(),{recursive:true});
    execFileSync('unzip',['-q','-o',archive,'-d',browserDirectory()],{stdio:'inherit',timeout:60000});
    if (sha256(readFileSync(browserExecutable()))!==lock.executableSha256) throw new Error('BROWSER_EXECUTABLE_HASH_MISMATCH');
    console.log('Installed pinned Chrome Headless Shell from Google Chrome for Testing; archive and executable hashes verified.');
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}
