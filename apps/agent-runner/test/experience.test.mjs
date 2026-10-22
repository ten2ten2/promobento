import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeProject,createWork} from '../src/runner.mjs';
import {manageExperience,recallProjectExperience} from '../src/experience.mjs';
import {withStore} from '../src/store.mjs';
import {parseCanonicalJson} from '../../../packages/contracts/index.mjs';
import {project,config,provider,mockRender,mockMethod} from './fixtures.mjs';
const entry=()=>({id:'pace',kind:'preference',topics:['rhythm'],text:'“留足读图时间，不要每个字弹跳。”',evidence:[{kind:'user_quote',ref:'Current project feedback, operator supplied.'}]});
async function setup(t){const directory=mkdtempSync(join(tmpdir(),'experience-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));const p=project();await initializeProject({directory,project:p});return {directory,p,args:{directory,projectId:p.id,actorUserId:p.actorUserId,workspaceId:p.workspaceId}};}
const recall=(directory,p)=>withStore(directory,store=>recallProjectExperience(store,p,['rhythm']));
test('experience is opt-in, project/owner isolated, CAS edited, reversible and actually deleted',async t=>{
  const {directory,p,args}=await setup(t);
  let state=await manageExperience({...args,action:'put',entry:entry(),expectedGeneration:0});assert.equal(state.enabled,false);assert.equal((await recall(directory,p)).entries.length,0);
  await assert.rejects(manageExperience({...args,actorUserId:'another-owner'}),/SCOPE/);
  await assert.rejects(manageExperience({...args,workspaceId:'another-workspace'}),/SCOPE/);
  await assert.rejects(manageExperience({...args,action:'enable',expectedGeneration:0}),/CONFLICT/);
  await manageExperience({...args,action:'enable',expectedGeneration:1});assert.equal((await recall(directory,p)).entries.length,1);
  const other={...p,id:'another-project'};await initializeProject({directory,project:other});assert.equal((await recall(directory,other)).entries.length,0);
  const separate=mkdtempSync(join(tmpdir(),'experience-other-'));t.after(()=>rmSync(separate,{recursive:true,force:true}));await initializeProject({directory:separate,project:p});assert.equal((await recall(separate,p)).entries.length,0);
  await manageExperience({...args,action:'disable',expectedGeneration:2});assert.equal((await recall(directory,p)).entries.length,0);
  await manageExperience({...args,action:'enable',expectedGeneration:3});assert.equal((await recall(directory,p)).entries.length,1);
  await manageExperience({...args,action:'delete',entryId:'pace',expectedGeneration:4});assert.deepEqual((await manageExperience(args)).entries,[]);
});
test('verified entries need checkable evidence; superseded entries never return',async t=>{
  const {directory,p,args}=await setup(t);
  await assert.rejects(manageExperience({...args,action:'put',expectedGeneration:0,entry:{...entry(),kind:'verified',evidence:[{kind:'observation',ref:'one film'}]}}),/EVIDENCE/);
  await manageExperience({...args,action:'put',expectedGeneration:0,entry:{...entry(),kind:'verified',evidence:[{kind:'measurement',ref:'measured frame sequence'}]}});
  await manageExperience({...args,action:'enable',expectedGeneration:1});assert.equal((await recall(directory,p)).entries[0].kind,'verified');
  await manageExperience({...args,action:'put',expectedGeneration:2,entry:{...entry(),kind:'superseded',replacement:'New brief chooses brisk montage.'}});
  assert.deepEqual((await recall(directory,p)).entries,[]);
});
test('enabled experience is consumed by actual director input, revoked text is absent on the next operation',async t=>{
  const {directory,p,args}=await setup(t);await manageExperience({...args,action:'put',expectedGeneration:0,entry:entry()});await manageExperience({...args,action:'enable',expectedGeneration:1});
  const inputs=[],api=provider(),generate=api.generate;api.generate=async input=>{inputs.push(parseCanonicalJson(input.input));return generate(input);};
  const work={directory,projectId:p.id,config:config(),provider:api,render:mockRender,method:mockMethod};
  await createWork({...work,operationId:'enabled'});assert.equal(inputs[0].experience.entries[0].text,entry().text);
  await manageExperience({...args,action:'disable',expectedGeneration:2});await createWork({...work,operationId:'disabled'});assert.deepEqual(inputs[1].experience.entries,[]);
});

test('experience refuses symlink substitution into another directory',async t=>{
  const {directory,args}=await setup(t),outside=mkdtempSync(join(tmpdir(),'experience-private-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  writeFileSync(join(outside,'private.json'),'{}');symlinkSync(join(outside,'private.json'),join(directory,'projects',args.projectId+'.experience.json'));
  await assert.rejects(manageExperience(args),/EVIDENCE_PATH/);
});
