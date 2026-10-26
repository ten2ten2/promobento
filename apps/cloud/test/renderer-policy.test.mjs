import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseCanonicalJson} from '@promobento/contracts/canonical';
import {assertRendererPolicyCompatible} from '../scripts/renderer-policy.mjs';

test('renderer reuse permits model policies and Worker review deadline, not budgets or container rendering changes',()=>{
 const before=parseCanonicalJson(readFileSync('config/agent-policy.json')),after=structuredClone(before);
 after.director.steps.facts.maxCalls++;after.cost.catalogVersion='catalog-for-a-different-model-binding';after.render.totalMs.review=90000;
 assert.doesNotThrow(()=>assertRendererPolicyCompatible(before,after));
 for(const change of [value=>value.render.captureFormat='png',value=>value.render.frameTimeoutMs++,value=>value.render.totalMs.final15++,value=>value.render.totalMs.final30++,value=>value.render.totalMs.webglExtra++,value=>value.limits.workspaceShardInstances++,value=>value.cost.maxMicrosPerCreativeRun++]){
  const changed=structuredClone(after);change(changed);assert.throws(()=>assertRendererPolicyCompatible(before,changed),/RENDERER_POLICY_CHANGED/);
 }
 assert.notEqual(before.cost.catalogVersion,after.cost.catalogVersion);
});
