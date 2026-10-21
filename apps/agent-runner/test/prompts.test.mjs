import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionMethod} from '../src/prompts.mjs';
import {presets} from '../src/schema.mjs';
import {targets} from '../../../packages/contracts/index.mjs';

test('director method supplies requested preset dimensions and fractional safe insets from shared rules',async()=>{
  const targetIds=['youtube:landscape','tiktok:portrait'];
  const method=await compositionMethod({durationSeconds:15,targetIds});
  assert.equal(method.targetRulesVersion,presets.rulesVersion);
  assert.deepEqual(method.targets,targetIds.map(targetId=>{
    const {layout}=targets(presets).find(target=>target.targetId===targetId);
    return {targetId,width:layout.width,height:layout.height,safeInsets:layout.safeInsets};
  }));
  assert.equal(method.targets[1].safeInsets.top,0.1);assert.equal(method.targets[1].height,1920);
});
