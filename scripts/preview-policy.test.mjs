import test from 'node:test';
import assert from 'node:assert/strict';
import {previewPolicy,trustedPreviewErrors} from './preview-policy.mjs';

const request = {mediaKind:'clip',revisionId:'rev-1',targetId:'tiktok:portrait',frameStart:60,frameEndExclusive:150};
const context = () => ({
  authorized:true, executionEnabled:true, budgetAvailable:true, previewEntitled:true, isTrial:true,projectId:'project_1',
  composition:{projectId:'project_1',revisionId:'rev-1',totalFrames:450,renderProfile:{sampleCount:1,shutterAngle:0},variants:[{targetId:'tiktok:portrait'}]},
  usage:{project:{requests:0,clipFrames:0},trial:{requests:0,clipFrames:0}},
  // Test-only limits; production limits stay unset until measured.
  policy:{trustedCapture:{enabled:true,limits:{maxClipFrames:90,maxRequestsPerProjectWindow:4,
    maxClipFramesPerProjectWindow:180,maxRequestsPerTrial:3,maxClipFramesPerTrial:180}}}
});

test('unmeasured production previews stay disabled even when other gates pass', () => {
  const errors=trustedPreviewErrors(request,{...context(),policy:previewPolicy});
  assert.ok(errors.includes('TRUSTED_PREVIEW_DISABLED'));
  assert.ok(errors.includes('PREVIEW_LIMITS_UNMEASURED'));
});
test('clip admission uses its length, not the absolute end frame', () => {
  assert.deepEqual(trustedPreviewErrors(request,context()),[]);
  assert.ok(trustedPreviewErrors({...request,frameEndExclusive:151},context()).includes('PREVIEW_CLIP_TOO_LONG'));
  assert.ok(trustedPreviewErrors({...request,frameStart:0,frameEndExclusive:450},context()).includes('PREVIEW_CLIP_TOO_LONG'));
});
test('ranges belong to the actual frozen target and duration', () => {
  for (const invalid of [
    {...request,frameEndExclusive:undefined}, {...request,frameEndExclusive:60},
    {...request,frameStart:440,frameEndExclusive:451}, {...request,frameStart:-1}
  ]) assert.ok(trustedPreviewErrors(invalid,context()).includes('PREVIEW_FRAME_RANGE_INVALID'));
  assert.ok(trustedPreviewErrors({...request,revisionId:'rev-other'},context()).includes('PREVIEW_SOURCE_MISMATCH'));
  assert.ok(trustedPreviewErrors({...request,targetId:'tiktok:square'},context()).includes('PREVIEW_SOURCE_MISMATCH'));
});
test('capture requires the authorized project and separately measured render profile', () => {
  assert.ok(trustedPreviewErrors(request,{...context(),projectId:'other_project'}).includes('PREVIEW_PROJECT_MISMATCH'));
  const c=context(); delete c.projectId;
  assert.ok(trustedPreviewErrors(request,c).includes('PREVIEW_PROJECT_MISMATCH'));
  for (const sampleCount of [4,8]) {
    const motion=context();motion.composition.renderProfile={sampleCount,shutterAngle:180};
    assert.ok(trustedPreviewErrors(request,motion).includes('PREVIEW_PROFILE_UNMEASURED'));
  }
});
test('screenshots capture one frame and still consume request allowance', () => {
  const image={...request,mediaKind:'screenshot'}; delete image.frameEndExclusive;
  assert.deepEqual(trustedPreviewErrors(image,context()),[]);
  assert.ok(trustedPreviewErrors({...image,frameEndExclusive:61},context()).includes('PREVIEW_FRAME_RANGE_INVALID'));
  const c=context(); c.usage.project.requests=4;
  assert.ok(trustedPreviewErrors(image,c).includes('PREVIEW_PROJECT_REQUEST_LIMIT'));
});
test('project and original trial counters include existing reservations', () => {
  const c=context(); c.usage.project.clipFrames=91;
  assert.ok(trustedPreviewErrors(request,c).includes('PREVIEW_PROJECT_FRAME_LIMIT'));
  c.usage.project.clipFrames=0; c.usage.trial.requests=3;
  assert.ok(trustedPreviewErrors(request,c).includes('PREVIEW_TRIAL_REQUEST_LIMIT'));
  c.usage.trial.requests=0; c.usage.trial.clipFrames=91;
  assert.ok(trustedPreviewErrors(request,c).includes('PREVIEW_TRIAL_FRAME_LIMIT'));
});
test('paid captures still have project caps and cannot omit usage evidence', () => {
  const c=context(); c.isTrial=false; delete c.usage.trial;
  assert.deepEqual(trustedPreviewErrors(request,c),[]);
  delete c.usage.project;
  assert.ok(trustedPreviewErrors(request,c).includes('PREVIEW_USAGE_REQUIRED'));
});
test('a non-trial classification does not establish paid preview entitlement', () => {
  const c=context(); c.isTrial=false; c.previewEntitled=false;
  assert.ok(trustedPreviewErrors(request,c).includes('PREVIEW_ENTITLEMENT_REQUIRED'));
});
test('missing authorization, budget, activation or entitlement never grants capture', () => {
  for (const [field,code] of [['authorized','PREVIEW_AUTHORIZATION_REQUIRED'],['budgetAvailable','PREVIEW_BUDGET_REQUIRED'],
    ['executionEnabled','TRUSTED_PREVIEW_DISABLED'],['previewEntitled','PREVIEW_ENTITLEMENT_REQUIRED'],['isTrial','PREVIEW_ENTITLEMENT_REQUIRED']]) {
    const c=context(); delete c[field];
    assert.ok(trustedPreviewErrors(request,c).includes(code));
  }
});
