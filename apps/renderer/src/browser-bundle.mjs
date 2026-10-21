import {createHash} from 'node:crypto';
import {copyFileSync,existsSync,lstatSync,mkdirSync,mkdtempSync,openSync,readSync,closeSync,readFileSync,readdirSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Hash large archives/binaries without retaining their bytes in the Node heap. */
export function sha256File(path) {
  const descriptor=openSync(path,'r'),hash=createHash('sha256'),buffer=Buffer.allocUnsafe(64*1024);
  try {
    let length;
    while ((length=readSync(descriptor,buffer,0,buffer.length,null))>0) hash.update(buffer.subarray(0,length));
    return hash.digest('hex');
  } finally { closeSync(descriptor); }
}
export const browserCacheDirectory = lock => process.env.PROMOBENTO_BROWSER_DIR || join(
  process.env.XDG_CACHE_HOME || join(homedir(),'.cache'),'promobento','browsers',lock.version+'-'+lock.archiveSha256.slice(0,12));

function privateDirectory(directory) {
  mkdirSync(directory,{recursive:true,mode:0o700});
  const stat=lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)
    || (process.getuid && stat.uid!==process.getuid()))
    throw new Error('BROWSER_CACHE_NOT_PRIVATE: use an owned, non-symlink directory with mode 0700');
}

export function verifyArchive(path,lock) {
  const stat=lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('BROWSER_ARCHIVE_NOT_REGULAR');
  if (sha256File(path)!==lock.archiveSha256) throw new Error('BROWSER_ARCHIVE_HASH_MISMATCH');
}

export function installBrowserArchive(lock,{sourceArchive=process.env.PROMOBENTO_BROWSER_ARCHIVE}={}) {
  const cache=browserCacheDirectory(lock);
  privateDirectory(cache);
  const destination=join(cache,'browser.zip');
  if (existsSync(destination)) {
    verifyArchive(destination,lock);
    return destination;
  }
  const temporary=mkdtempSync(join(cache,'download-'));
  try {
    const archive=join(temporary,'browser.zip');
    if (sourceArchive) copyFileSync(sourceArchive,archive);
    else execFileSync('curl',['--fail','--location','--silent','--show-error','--proto','=https','--max-time','180',lock.url,'-o',archive],{stdio:'inherit',timeout:185000});
    verifyArchive(archive,lock);
    renameSync(archive,destination);
    return destination;
  } finally { rmSync(temporary,{recursive:true,force:true}); }
}

function assertSafeEntries(archive,rootName) {
  const entries=execFileSync('unzip',['-Z1',archive],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024}).trim().split('\n');
  if (!entries.length || entries.some(path=>!path.startsWith(rootName+'/') || isAbsolute(path)
    || path.includes('\\') || path.includes('\0') || path.split('/').some(part=>part==='..' || part==='.')))
    throw new Error('BROWSER_ARCHIVE_PATH_INVALID');
}

function assertRegularTree(directory) {
  for (const item of readdirSync(directory,{withFileTypes:true})) {
    const path=join(directory,item.name),stat=lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('BROWSER_BUNDLE_ENTRY_INVALID');
    if (stat.isDirectory()) assertRegularTree(path);
  }
}

const xmlText=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');

/** Absolute paths avoid fontconfig's cwd-relative cache and XDG system-directory expansion. */
export function prepareFontEnvironment(directory) {
  if (!isAbsolute(directory)) throw new Error('FONT_DIRECTORY_NOT_ABSOLUTE');
  const fontDirectory=join(directory,'fonts'),fontCacheDirectory=join(directory,'font-cache');
  mkdirSync(fontDirectory,{mode:0o700});
  mkdirSync(fontCacheDirectory,{mode:0o700});
  const template=readFileSync(new URL('../fontconfig.conf',import.meta.url),'utf8');
  const fontconfig=template.replace('@FONT_DIRECTORY@',()=>xmlText(fontDirectory))
    .replace('@CACHE_DIRECTORY@',()=>xmlText(fontCacheDirectory));
  const configPath=join(directory,'fonts.conf');
  writeFileSync(configPath,fontconfig,{mode:0o600});
  return {fontconfigSha256:sha256(fontconfig),fontconfigTemplateSha256:sha256(template),fontDirectory,fontCacheDirectory,
    fontEnvironment:{FONTCONFIG_FILE:configPath,FONTCONFIG_PATH:directory,
      XDG_DATA_HOME:directory,XDG_DATA_DIRS:directory,XDG_CACHE_HOME:directory}};
}

/** Every run uses a fresh extraction of the entire pinned archive, never an existing executable tree. */
export function prepareBrowserBundle(lock) {
  const cache=browserCacheDirectory(lock);
  privateDirectory(cache);
  const cachedArchive=join(cache,'browser.zip');
  if (!existsSync(cachedArchive)) throw new Error('BROWSER_ARCHIVE_MISSING: run install:renderer');
  const directory=mkdtempSync(join(tmpdir(),'promobento-browser-run-'));
  try {
    const archive=join(directory,'browser.zip');
    // Verify our private copy, so replacing the cache during extraction cannot change this run.
    copyFileSync(cachedArchive,archive);
    verifyArchive(archive,lock);
    assertSafeEntries(archive,lock.relativeExecutable.split('/')[0]);
    execFileSync('unzip',['-q',archive,'-d',directory],{timeout:60000});
    rmSync(archive);
    assertRegularTree(directory);
    const executablePath=join(directory,lock.relativeExecutable);
    if (sha256File(executablePath)!==lock.executableSha256) throw new Error('BROWSER_EXECUTABLE_HASH_MISMATCH');
    const fonts=prepareFontEnvironment(directory);
    return {directory,executablePath,archiveSha256:lock.archiveSha256,...fonts,
      cleanup:()=>rmSync(directory,{recursive:true,force:true})};
  } catch(error) {
    rmSync(directory,{recursive:true,force:true});
    throw error;
  }
}
