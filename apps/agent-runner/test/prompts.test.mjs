import test from 'node:test';
import assert from 'node:assert/strict';
import {compositionMethod,DIRECTOR_INSTRUCTIONS} from '../src/prompts.mjs';
import {presets} from '../src/schema.mjs';
import {targets} from '../../../packages/contracts/index.mjs';
import {allAdmittedFontDeclarations} from '../../renderer/src/admission-fonts.mjs';
import {mediaDeclarations,validateAdmissionResources} from '../../renderer/src/admission-media.mjs';

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

const right=resourceId=>({resourceId,evidenceRef:'unit-test-only',confirmedBy:'unit-test',confirmedAt:'2026-01-01T00:00:00Z'});
test('approved CJK font supplies the exact declaration accepted by the renderer without changing project rights',async()=>{
  const rights=[right('hm-noto-sans-sc')],before=structuredClone(rights);
  const method=await compositionMethod({durationSeconds:15,targetIds:['tiktok:portrait'],rights});
  const expected=allAdmittedFontDeclarations().find(font=>font.fontId==='hm-noto-sans-sc');
  assert.deepEqual(method.declarations.fonts,[expected]);assert.deepEqual(expected.weights,[500,700,800,900]);assert.deepEqual(expected.fallbackFontIds,[]);
  assert.deepEqual(method.approvedResourceIds,['hm-noto-sans-sc']);assert.deepEqual(rights,before);
  assert.equal(method.catalog.resources.find(resource=>resource.id==='hm-noto-sans-sc').projectApproved,true);
  assert.equal(method.catalog.resources.find(resource=>resource.id==='hm-lxgw-wenkai').projectApproved,false);
  const selected=validateAdmissionResources({schemaVersion:'2.7.0',kind:'admission_resources',resourceIds:method.approvedResourceIds,audioEvents:[]},
    {declarations:{markers:[],fonts:method.declarations.fonts,videoUses:[]},totalFrames:450});
  assert.deepEqual(selected.map(resource=>resource.id),['hm-noto-sans-sc']);
});
test('unapproved fonts and missing fallbacks are not recommended; legacy default declarations stay unchanged',async()=>{
  const empty=await compositionMethod({durationSeconds:15,targetIds:['tiktok:portrait']});
  assert.deepEqual(empty.declarations,{fonts:[],videoUses:[]});assert.deepEqual(empty.approvedResourceIds,[]);
  assert.equal(empty.catalog.resources.find(resource=>resource.id==='hm-noto-sans-sc').projectApproved,false);
  assert.match(DIRECTOR_INSTRUCTIONS,/only method.approvedResourceIds/);assert.match(DIRECTOR_INSTRUCTIONS,/do not copy unapproved fonts from API examples/);
  const sansOnly=await compositionMethod({durationSeconds:15,targetIds:['tiktok:portrait'],rights:[right('geist-sans-fixture')]});
  assert.deepEqual(sansOnly.declarations.fonts,[]);
  const oldFonts=mediaDeclarations({durationSeconds:15}).fonts;
  assert.deepEqual(oldFonts.map(font=>font.fontId),['geist-sans-fixture','geist-mono-fixture']);
  const legacy=await compositionMethod({durationSeconds:15,targetIds:['tiktok:portrait'],rights:oldFonts.map(font=>right(font.fontId))});
  assert.deepEqual(legacy.declarations.fonts,oldFonts);assert.ok(!legacy.declarations.fonts.some(font=>font.fontId==='hm-noto-sans-sc'));
});
