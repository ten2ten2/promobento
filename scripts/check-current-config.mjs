#!/usr/bin/env node
// Check the configuration consumed by native jobs and model admission. No cloud or model calls.
import {readFileSync} from 'node:fs';
import {canonical,parseCanonicalJson} from '../packages/contracts/src/canonical.mjs';
import {NATIVE_RUNTIME_COMMIT,NATIVE_SOURCE_LIMITS} from '../packages/contracts/src/native-project.mjs';
import {modelConfigErrors} from '../packages/contracts/src/models.mjs';
import {targets} from '../packages/contracts/src/targets.mjs';
import {validate as validModelConfig} from '../packages/contracts/generated/model-config.mjs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const load=path=>parseCanonicalJson(read(path));
const failures=[],expect=(ok,message)=>{if(!ok)failures.push(message);};
const positive=value=>Number.isSafeInteger(value)&&value>0;
const same=(a,b)=>canonical(a)===canonical(b);

try {
  const policy=load('config/agent-policy.json'),providers=load('config/model-providers.json'),authorization=load('config/model-authorization.json');
  for(const [name,value] of Object.entries({providers,authorization}))
    expect(validModelConfig(value),'Invalid model '+name+': '+JSON.stringify(validModelConfig.errors));
  failures.push(...modelConfigErrors(providers,authorization,policy));
  const stages=['facts','assets','reference','directions','treatment','script','selection','author','review','coldReview'];
  expect(same(Object.keys(providers.steps).sort(),[...stages].sort()),'Model bindings differ from native director stages');
  expect(same(Object.keys(policy.director.steps).sort(),[...stages].sort()),'Stage budgets differ from native director stages');
  for(const stage of stages) {
    const limits=policy.director.steps[stage];
    expect(positive(limits?.maxMicros)&&positive(limits?.maxCalls??limits?.maxCallsPerAsset),'Invalid native model budget: '+stage);
  }
  expect(Number.isSafeInteger(policy.limits.maxInternalRepairs)&&policy.limits.maxInternalRepairs>=0,'Invalid internal repair limit');
  expect(positive(policy.limits.requestTimeoutMs)&&positive(policy.director.activeTimeoutMs.creative)
    &&positive(policy.director.wallClockMinutes.patch),'Invalid native director timeout');
  expect(policy.patch.maxCommentsPerRound===5&&policy.patch.maxTotalCommentCodePoints===4000,'Patch comment boundaries changed');
  const worker=parseCanonicalJson(read('apps/cloud/wrangler.jsonc').replace(/^\/\/[^\n]*\n/,''));
  expect(policy.enabled===false&&worker.env.production.vars.S1_ENABLED==='off','Customer execution must remain disabled');

  const native=load('contracts/native-project.schema.json'),upstream=load('packages/native-motion/upstream.lock.json');
  const environment=load('apps/render-container/environment.lock.json'),platform=load('config/platform-presets.json');
  expect(native.properties.runtime.properties.commit.const===NATIVE_RUNTIME_COMMIT
    &&upstream.commit===NATIVE_RUNTIME_COMMIT&&environment.nativeRuntime.commit===NATIVE_RUNTIME_COMMIT,'Native runtime pins differ');
  expect(native.properties.entry.const==='index.html'&&native.properties.composition.properties.fps.const===30,'Native entry or frame rate changed');
  expect(same(native.properties.composition.properties.durationSeconds.enum,[15,30])
    &&same(platform.productLimits.durationSeconds,[15,30]),'Native delivery durations changed');
  expect(native.properties.files.maxItems===NATIVE_SOURCE_LIMITS.files
    &&native.properties.files.items.properties.byteLength.maximum===NATIVE_SOURCE_LIMITS.fileBytes,'Native source limits differ');
  const schemaDimensions=native.properties.composition.oneOf.map(shape=>shape.properties.width.const+'x'+shape.properties.height.const).sort();
  const platformDimensions=Object.values(platform.aspectLayouts).map(shape=>shape.width+'x'+shape.height).sort();
  expect(same(schemaDimensions,platformDimensions),'Native dimensions differ from platform layouts');
  const configuredTargets=targets(platform);
  expect(configuredTargets.length===7&&new Set(configuredTargets.map(target=>target.targetId)).size===7
    &&new Set(configuredTargets.map(target=>target.aspectId)).size===4,'Target/aspect invariant');
  expect(configuredTargets.every(target=>target.layout&&target.encoding?.fps===30),'Invalid native platform target');
} catch(error) { failures.push(error.message); }

if(failures.length) {
  console.error(failures.join('\n'));process.exitCode=1;
} else {
  console.log('Current configuration passed: native runtime pins, source limits, delivery targets, model bindings, budgets and disabled customer execution.');
  console.log('Scope: local configuration consistency; not model availability, rendering, cloud recovery or customer billing acceptance.');
}
