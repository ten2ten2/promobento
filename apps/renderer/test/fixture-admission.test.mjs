import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {parseFixtureDeclarations,readFixtureDeclarations,fixtureDeclarationsPath} from '../src/fixture-declarations.mjs';
import {fixtureLicenseEvidence,readFixtureLicense,verifyFixtureLicense} from '../src/fixture-license.mjs';
import {prepareFixtureMedia} from '../src/media-assets.mjs';
import {prepareFixtureAudio} from '../src/audio.mjs';

const repository=fileURLToPath(new URL('../../../',import.meta.url));

test('only fixed declaration paths are accepted and complete JSON schema checks remain mandatory',()=>{
  for(const fixture of ['square','inplace','media']) {
    const declarations=readFixtureDeclarations(fixture);
    assert(Object.isFrozen(declarations));assert(Object.isFrozen(declarations.fonts));
    assert.equal(declarations.schemaVersion,'2.7.0');
  }
  for(const fixture of ['../source','https://example.test/source','__proto__',{},null])
    assert.throws(()=>fixtureDeclarationsPath(fixture),/RENDER_FIXTURE_UNKNOWN/);
  const declarations=structuredClone(readFixtureDeclarations('media'));
  declarations.markers[0].frame=-1;
  assert.throws(()=>parseFixtureDeclarations(JSON.stringify(declarations)),/FIXTURE_DECLARATIONS_INVALID/);
  declarations.markers[0].frame=30;declarations.execute='import("node:fs")';
  assert.throws(()=>parseFixtureDeclarations(JSON.stringify(declarations)),/FIXTURE_DECLARATIONS_INVALID/);
  assert.throws(()=>parseFixtureDeclarations('export default {}'));
});

test('original fixture licenses require reviewed evidence bytes, identity and source scope',()=>{
  const evidenceBytes=fs.readFileSync(join(repository,fixtureLicenseEvidence.evidencePath));
  for(const sourcePath of ['tests/fixtures/render/audio-fixture.mjs','apps/renderer/src/media-assets.mjs']) {
    const license=readFixtureLicense(sourcePath);
    assert.equal(license.license,'CC0-1.0');assert.equal(license.evidenceSha256,fixtureLicenseEvidence.evidenceSha256);
    assert.equal(license.generatorPath,sourcePath);assert(Object.isFrozen(license));
  }
  const claim={license:'CC0-1.0',sourcePath:'tests/fixtures/render/audio-fixture.mjs',evidenceBytes};
  for(const bytes of [Buffer.from('CC0 1.0 Universal\nNo audio rights granted.'),Buffer.concat([evidenceBytes,Buffer.from('\nChanged scope.')])])
    assert.throws(()=>verifyFixtureLicense({...claim,evidenceBytes:bytes}),/FIXTURE_LICENSE_HASH_MISMATCH/);
  assert.throws(()=>verifyFixtureLicense({...claim,license:'MIT'}),/FIXTURE_LICENSE_ID_UNVERIFIED/);
  for(const sourcePath of ['customer/upload.wav','tests/fixtures/render/fonts/geist-sans-latin-600-normal.woff.base64',
    'tests/fixtures/render/../render/audio-fixture.mjs','__proto__'])
    assert.throws(()=>verifyFixtureLicense({...claim,sourcePath}),/FIXTURE_LICENSE_SOURCE_UNVERIFIED/);
});

test('audio and video preparation reject changed license evidence before creating or decoding media',()=>{
  const directory=fs.mkdtempSync(join(tmpdir(),'promobento-license-'));
  const outputDirectory=join(directory,'must-not-exist');
  const evidencePath=join(repository,fixtureLicenseEvidence.evidencePath),read=fs.readFileSync;
  // Affect only this process's evidence read; never rewrite the shared repository.
  fs.readFileSync=(path,...args)=>{
    if(typeof path==='string'&&resolve(path)===evidencePath)return Buffer.from('CC0 1.0 Universal\nChanged license for audio and screen frames.');
    return read(path,...args);
  };
  syncBuiltinESMExports();
  try {
    assert.throws(()=>prepareFixtureMedia({outputDirectory}),/FIXTURE_LICENSE_HASH_MISMATCH/);
    assert.throws(()=>prepareFixtureAudio({outputDirectory}),/FIXTURE_LICENSE_HASH_MISMATCH/);
    assert.equal(fs.existsSync(outputDirectory),false);
  } finally {
    fs.readFileSync=read;syncBuiltinESMExports();fs.rmSync(directory,{recursive:true,force:true});
  }
});
