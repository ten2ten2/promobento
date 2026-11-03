import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';

test('worker-only deploy cannot reuse a renderer built with a different video-frame validator',t=>{
  const directory=mkdtempSync(join(tmpdir(),'promobento-renderer-reuse-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  for(const path of ['apps/cloud','contracts','artifacts/staging'])mkdirSync(join(directory,path),{recursive:true});
  writeFileSync(join(directory,'apps/cloud/wrangler.jsonc'),readFileSync('apps/cloud/wrangler.jsonc'));
  const schema='contracts/video-frame-manifest.schema.json';
  writeFileSync(join(directory,schema),readFileSync(schema));
  git('init');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Renderer baseline');
  const baseline=git('rev-parse','HEAD').trim();
  const config=join(directory,'worker.json');
  const deploy=()=>spawnSync(process.execPath,[resolve('apps/cloud/scripts/prepare-worker-deploy.mjs')],{
    cwd:directory,encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',RENDERER_SHA:baseline,
      RENDERER_DIGEST:'sha256:'+'a'.repeat(64),CLOUDFLARE_ACCOUNT_ID:'b'.repeat(32),WORKER_CONFIG:config},
  });
  const unchanged=deploy();
  assert.equal(unchanged.status,0,unchanged.stderr);
  assert.match(readFileSync(config,'utf8'),/sha256:aaaa/);
  const value=JSON.parse(readFileSync(join(directory,schema),'utf8'));
  value.properties.frames.maxItems--;
  writeFileSync(join(directory,schema),JSON.stringify(value)+'\n');
  git('add',schema);git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Update frame contract');
  assert.notEqual(deploy().status,0,'a changed runtime validator requires rebuilding the image');
});
