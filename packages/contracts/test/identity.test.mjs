import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  digest, parseCanonicalJson, contentIdentity, factContentIdentity,
  resourceContentIdentity, variantIdentity, artifactIdentity, audioIdentity
} from '../index.mjs';

const read = path => parseCanonicalJson(readFileSync(new URL('../../../' + path, import.meta.url)));
const composition = read('contracts/composition.example.json');
const facts = read('contracts/fact-manifest.example.json');
const resources = read('contracts/resource-manifest.example.json');
const rules = read('config/platform-presets.json');

function withFacts(manifest) {
  const result = structuredClone(composition);
  result.factManifestHash = digest(manifest);
  result.factContentHash = digest(factContentIdentity(manifest));
  for (const variant of result.variants) variant.variantHash = digest(variantIdentity(result, variant, rules));
  return result;
}

test('A to B to A restores billing identity while retaining a different confirmation receipt', () => {
  const changed = structuredClone(facts);
  changed.facts[0].text = 'Changed offer'; changed.facts[0].version = 2;
  for (const binding of changed.bindings) binding.expectedText = changed.facts[0].text;
  assert.notEqual(digest(contentIdentity(withFacts(changed))), digest(contentIdentity(composition)));
  changed.facts[0].text = facts.facts[0].text; changed.facts[0].version = 3;
  for (const binding of changed.bindings) binding.expectedText = changed.facts[0].text;
  assert.equal(digest(contentIdentity(withFacts(changed))), digest(contentIdentity(composition)));
  assert.notEqual(digest(changed), digest(facts));
});

test('fact and binding collections have stable order, including bindings whose factIds differ', () => {
  const first = structuredClone(facts);
  first.facts.push({...first.facts[0], factId:'fact_other'});
  first.bindings.push({...first.bindings[0], bindingId:'other', factIds:['fact_other','fact_name']});
  const reordered = structuredClone(first);
  reordered.facts.reverse(); reordered.bindings.reverse();
  for (const binding of reordered.bindings) { binding.factIds.reverse(); binding.bindingId += '_regenerated'; }
  assert.equal(digest(factContentIdentity(first)), digest(factContentIdentity(reordered)));
  reordered.bindings[0].factIds = ['fact_name'];
  assert.notEqual(digest(factContentIdentity(first)), digest(factContentIdentity(reordered)));
});

test('protocol and descriptive metadata do not leak into billing through nested manifests', () => {
  const nextFacts = structuredClone(facts), nextResources = structuredClone(resources), next = structuredClone(composition);
  nextFacts.schemaVersion = nextResources.schemaVersion = next.schemaVersion = 'future-protocol';
  nextResources.resources.reverse(); nextFacts.facts.reverse(); nextFacts.bindings.reverse();
  next.factManifestHash = digest(nextFacts); next.factContentHash = digest(factContentIdentity(nextFacts));
  next.resourceManifestHash = digest(nextResources); next.resourceContentHash = digest(resourceContentIdentity(nextResources));
  next.textMetadata = [{label:'Only descriptive metadata',language:'mul'}];
  for (const variant of next.variants) {
    variant.resourceManifestHash = next.resourceManifestHash; variant.resourceContentHash = next.resourceContentHash;
    variant.variantHash = digest(variantIdentity(next, variant, rules));
  }
  assert.equal(digest(contentIdentity(next)), digest(contentIdentity(composition)));
  assert.notEqual(digest(artifactIdentity(next, next.variants[0], rules)), digest(artifactIdentity(composition, composition.variants[0], rules)));
});

test('renderer changes invalidate artifacts without creating a new billing identity', () => {
  const next = structuredClone(composition);
  next.rendererImageDigest = 'sha256:' + digest('replacement renderer');
  assert.equal(digest(contentIdentity(next)), digest(contentIdentity(composition)));
  assert.notEqual(digest(artifactIdentity(next, next.variants[0], rules)), digest(artifactIdentity(composition, composition.variants[0], rules)));
});

test('actual target layout and resource bytes remain content changes', () => {
  const next = structuredClone(composition), nextRules = structuredClone(rules);
  nextRules.aspectLayouts.portrait.width += 2;
  for (const variant of next.variants) variant.variantHash = digest(variantIdentity(next, variant, nextRules));
  assert.notEqual(digest(contentIdentity(next)), digest(contentIdentity(composition)));
  const changedResource = structuredClone(resources); changedResource.resources[0].sha256 = digest('new visual bytes');
  assert.notEqual(digest(resourceContentIdentity(changedResource)), digest(resourceContentIdentity(resources)));
});

test('mixer bookkeeping is separate from the ordered audio events and actual mixed WAV', () => {
  const next = structuredClone(resources); next.mixedAudio.mixerVersion = 'new implementation';
  assert.equal(digest(audioIdentity(next)), digest(audioIdentity(resources)));
  next.mixedAudio.sha256 = digest('different mixed WAV');
  assert.notEqual(digest(audioIdentity(next)), digest(audioIdentity(resources)));
});

test('audio rights registration and descriptive cue labels do not create indirect billing changes', () => {
  const nextResources = structuredClone(resources), next = structuredClone(composition);
  for (const resource of nextResources.resources) resource.licenseRef += '_reregistered';
  for (const event of nextResources.audioEvents) {
    event.licenseRef += '_reregistered'; event.mark = 'Descriptive catalog cue';
  }
  next.resourceManifestHash = digest(nextResources);
  next.resourceContentHash = digest(resourceContentIdentity(nextResources));
  for (const variant of next.variants) {
    variant.resourceManifestHash = next.resourceManifestHash;
    variant.resourceContentHash = next.resourceContentHash;
    variant.audioHash = digest(audioIdentity(nextResources));
    variant.variantHash = digest(variantIdentity(next, variant, rules));
  }
  assert.equal(digest(contentIdentity(next)), digest(contentIdentity(composition)));
  assert.notEqual(digest(nextResources), digest(resources));
  const ordered = structuredClone(resources);
  ordered.audioEvents.push({...ordered.audioEvents[0], gainDb:-6});
  const reversed = structuredClone(ordered); reversed.audioEvents.reverse();
  assert.notEqual(digest(audioIdentity(ordered)), digest(audioIdentity(reversed)));
});
