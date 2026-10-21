import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {sourceValuesBytes,parseCanonicalJson} from '@promobento/contracts';
import {readAdmissionSource,admissionQaIdentity} from '../src/admission-source.mjs';
import {sandboxArguments,verifySandboxConfiguration} from '../src/admission-sandbox.mjs';
import {admissionPolicy,admissionEnvironment} from '../src/admission-image.mjs';
import {admissionVerificationPlan} from '../src/admission-capture.mjs';
import {ADMISSION_DRAW_MAX_BYTES} from '../src/admission-commands.mjs';

function fixture(operation) {
  const dir=mkdtempSync(join(tmpdir(),'promobento-source-test-'));
  const manifest={schemaVersion:'2.7.0',kind:'admission_candidate',capabilityProfile:'canvas-commands-v1',targetId:'tiktok:portrait',durationSeconds:30,seed:'test'};
  const declarations={schemaVersion:'2.7.0',kind:'runtime_declarations',editables:[],markers:[],regions:[],videoUses:[],fonts:[]};
  writeFileSync(join(dir,'candidate.json'),JSON.stringify(manifest));
  writeFileSync(join(dir,'declarations.json'),JSON.stringify(declarations));
  writeFileSync(join(dir,'values.json'),sourceValuesBytes({}));
  writeFileSync(join(dir,'composition.mjs'),'while (true) {} // This source must never execute while inspecting metadata.');
  try {operation(dir,manifest,declarations);} finally {rmSync(dir,{recursive:true,force:true});}
}
test('source inventory, declarations and values are read as inert bounded data',()=>fixture(dir=>{
  const candidate=readAdmissionSource(dir);assert.equal(candidate.input.totalFrames,900);assert.equal(candidate.input.width,1080);
  assert.equal(candidate.files.length,4);assert.match(candidate.sourceHash,/^[a-f0-9]{64}$/u);
  writeFileSync(join(dir,'helper.mjs'),'export default 1');assert.throws(()=>readAdmissionSource(dir),/INVENTORY/);
}));
test('source symlinks, FIFO, oversized bytes and duplicate JSON keys fail without evaluation',()=>fixture(dir=>{
  const file=join(dir,'composition.mjs');rmSync(file);symlinkSync('/etc/passwd',file);
  assert.throws(()=>readAdmissionSource(dir));rmSync(file);execFileSync('mkfifo',[file]);
  assert.throws(()=>readAdmissionSource(dir),/TYPE/);rmSync(file);
  writeFileSync(file,'x'.repeat(admissionPolicy.sourceMaxBytes+1));assert.throws(()=>readAdmissionSource(dir),/SIZE/);
  writeFileSync(file,'export default {}');writeFileSync(join(dir,'candidate.json'),'{"kind":"a","kind":"b"}');
  assert.throws(()=>readAdmissionSource(dir));
}));
test('unavailable media, invalid targets and mismatched editable values fail before task start',()=>fixture((dir,manifest,declarations)=>{
  writeFileSync(join(dir,'candidate.json'),JSON.stringify({...manifest,targetId:'fake:square'}));
  assert.throws(()=>readAdmissionSource(dir),/TARGET/);writeFileSync(join(dir,'candidate.json'),JSON.stringify(manifest));
  declarations.editables=[{id:'title',label:'Title',type:'text'}];
  writeFileSync(join(dir,'declarations.json'),JSON.stringify(declarations));assert.throws(()=>readAdmissionSource(dir),/VALUES/);
}));
test('technical QA identity changes with source, execution image and verification policy',()=>fixture(dir=>{
  const candidate=readAdmissionSource(dir),plan=admissionVerificationPlan(900),image={imageId:'sha256:'+'a'.repeat(64),sourceTreeHash:'b'.repeat(64)};
  const initial=admissionQaIdentity(candidate,image,plan).qaInputHash;
  assert.notEqual(admissionQaIdentity(candidate,{...image,imageId:'sha256:'+'c'.repeat(64)},plan).qaInputHash,initial);
  assert.notEqual(admissionQaIdentity(candidate,image,{...plan,version:'next'}).qaInputHash,initial);
  writeFileSync(join(dir,'composition.mjs'),'different raw bytes');assert.notEqual(admissionQaIdentity(readAdmissionSource(dir),image,plan).qaInputHash,initial);
}));
test('sandbox command uses immutable image and mandatory limits, never host env or daemon mounts',()=>{
  const options={name:'promobento-admission-abcdef',imageId:'sha256:'+'a'.repeat(64)};
  const args=sandboxArguments(options),text=args.join(' ');
  for(const literal of ['--network none','--read-only','--user 65532:65532','--cap-drop ALL','--pids-limit 32','noexec'])assert(text.includes(literal));
  assert(!args.includes('--env'));assert(!text.includes('docker.sock'));
  assert(sandboxArguments({...options,kind:'capture'}).some(value=>value.includes('nodev,exec')));
  assert.throws(()=>sandboxArguments({...options,imageId:'ubuntu:latest'}));
  assert.throws(()=>verifySandboxConfiguration({HostConfig:{NetworkMode:'host'}}),/UNENFORCED/);
});
test('admission toolchain stays on the existing exact Node, pnpm and renderer environment',()=>{
  const pkg=parseCanonicalJson(readFileSync(new URL('../../../package.json',import.meta.url)));
  const renderer=parseCanonicalJson(readFileSync(new URL('../environment.lock.json',import.meta.url)));
  const dependencies=parseCanonicalJson(readFileSync(new URL('../package.json',import.meta.url))).dependencies;
  assert.equal(admissionEnvironment.nodeVersion,pkg.engines.node);assert.equal(admissionEnvironment.nodeVersion,renderer.nodeVersion);
  assert.equal('pnpm@'+admissionEnvironment.pnpmVersion,pkg.packageManager);
  assert.equal(admissionEnvironment.quickjsVersion,dependencies['quickjs-emscripten']);
});

test('frame, transport and engine-stage policies retain distinct bounded scopes',()=>{
  assert.equal(admissionPolicy.engine.maxOutputBytes,ADMISSION_DRAW_MAX_BYTES);
  assert(admissionPolicy.maxTransportBytes>admissionPolicy.engine.maxOutputBytes+4096);
  assert(Number.isSafeInteger(admissionPolicy.engineStageTimeoutMs));
  assert(admissionPolicy.engineStageTimeoutMs>admissionPolicy.engine.callTimeoutMs);
  assert(admissionPolicy.engineStageTimeoutMs<admissionPolicy.taskTimeoutMs);
});
