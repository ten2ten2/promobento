import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installBrowserArchive,verifyArchive,sha256,sha256File,prepareFontEnvironment} from '../src/browser-bundle.mjs';

test('fontconfig uses escaped absolute private directories without XDG directory expansion',()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-font-&-test-'));
  try {
    const fonts=prepareFontEnvironment(directory),config=readFileSync(fonts.fontEnvironment.FONTCONFIG_FILE,'utf8');
    assert(config.includes('<dir>'+directory.replaceAll('&','&amp;')+'/fonts</dir>'));
    assert(config.includes('<cachedir>'+directory.replaceAll('&','&amp;')+'/font-cache</cachedir>'));
    assert.equal(fonts.fontconfigSha256,sha256(config));
    assert.equal(fonts.fontEnvironment.XDG_DATA_DIRS,directory);
    assert(!config.includes('prefix="xdg"'));
    assert.throws(()=>prepareFontEnvironment('relative'),/FONT_DIRECTORY_NOT_ABSOLUTE/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('bounded file hashing matches byte hashing across empty, exact and partial chunks',()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-file-hash-test-'));
  try {
    for (const size of [0,1,65535,65536,65537,196613]) {
      const bytes=Buffer.alloc(size);
      for (let index=0;index<size;index++) bytes[index]=(index*17+index%53)%256;
      const path=join(directory,'input');writeFileSync(path,bytes);
      assert.equal(sha256File(path),sha256(bytes));
    }
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('browser cache verifies complete archive bytes, including a pre-existing cache',()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-cache-test-'));
  const previous=process.env.PROMOBENTO_BROWSER_DIR;
  try {
    process.env.PROMOBENTO_BROWSER_DIR=join(directory,'private-cache');
    const source=join(directory,'source.zip'),bytes=Buffer.from('pinned complete browser archive');
    writeFileSync(source,bytes);
    const lock={version:'test',archiveSha256:sha256(bytes)};
    const archive=installBrowserArchive(lock,{sourceArchive:source});
    verifyArchive(archive,lock);
    writeFileSync(archive,Buffer.from('changed pak or library inside archive'));
    assert.throws(()=>installBrowserArchive(lock,{sourceArchive:source}),/BROWSER_ARCHIVE_HASH_MISMATCH/);
  } finally {
    if (previous===undefined) delete process.env.PROMOBENTO_BROWSER_DIR;
    else process.env.PROMOBENTO_BROWSER_DIR=previous;
    rmSync(directory,{recursive:true,force:true});
  }
});

test('a symlink cannot stand in for the cached browser archive',{skip:process.platform==='win32'},()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-cache-test-'));
  try {
    const source=join(directory,'source.zip'),link=join(directory,'link.zip'),bytes=Buffer.from('archive');
    writeFileSync(source,bytes);symlinkSync(source,link);
    assert.throws(()=>verifyArchive(link,{archiveSha256:sha256(bytes)}),/BROWSER_ARCHIVE_NOT_REGULAR/);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

test('shared or preplaced cache directories are rejected',{skip:process.platform==='win32'},()=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-cache-test-')),previous=process.env.PROMOBENTO_BROWSER_DIR;
  try {
    process.env.PROMOBENTO_BROWSER_DIR=join(directory,'shared');
    mkdirSync(process.env.PROMOBENTO_BROWSER_DIR,{mode:0o755});
    assert.throws(()=>installBrowserArchive({version:'test',archiveSha256:'test'}),/BROWSER_CACHE_NOT_PRIVATE/);
  } finally {
    if (previous===undefined) delete process.env.PROMOBENTO_BROWSER_DIR;
    else process.env.PROMOBENTO_BROWSER_DIR=previous;
    rmSync(directory,{recursive:true,force:true});
  }
});
