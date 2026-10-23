import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createSchemaValidator, parseCanonicalJson } from '../index.mjs';
import { VALIDATOR_SCHEMAS, buildValidators } from '../scripts/build-validators.mjs';

const read = path => parseCanonicalJson(readFileSync(new URL('../../../' + path, import.meta.url)));
const sha = 'a'.repeat(64);

test('every v3 Schema compiles in strict mode with all definitions', () => {
  for (const name of VALIDATOR_SCHEMAS.filter(name => name !== 'production')) {
    const schema = read(`contracts/${name}.schema.json`);
    assert.equal(schema.$id.endsWith('/3.0.0'), true, name);
    const validate = createSchemaValidator(schema);
    for (const definition of Object.values(schema.$defs ?? {})) validate(null, definition);
    assert.ok(Array.isArray(validate({})), name);
  }
});

test('render jobs dispatch by kind and reject unknown aspects', () => {
  const validate = createSchemaValidator(read('contracts/render-job.schema.json'));
  const job = {schemaVersion: '3.0.0', kind: 'render_job', renderId: 'render_0001', operationId: 'op_0001', candidateId: 'cand_0001',
    sourceHash: sha, runtimeVersion: 'film-runtime-1', rendererRelease: 'render-r1', aspectId: 'portrait', durationSeconds: 30,
    totalFrames: 900, quality: 'final', renderProfile: {sampleCount: 1, shutterAngle: 0, sampling: 'centered-box-v1', edgePolicy: 'clamp-v1'}, resources: []};
  assert.deepEqual(validate(job), []);
  assert.ok(validate({...job, aspectId: 'tiktok:portrait'}).length > 0);
  assert.ok(validate({...job, kind: 'render_session'}).some(error => error.includes('UNKNOWN_DISCRIMINATOR')));
});

test('tool calls are validated per tool, and edits stay inside one scene directory', () => {
  const validate = createSchemaValidator(read('contracts/agent-tools.schema.json'));
  const call = (tool, input) => ({schemaVersion: '3.0.0', kind: 'tool_call', tool, input});
  assert.deepEqual(validate(call('edit_file', {command: 'str_replace', path: 'scenes/hook/index.js', oldStr: 'a', newStr: 'b'})), []);
  assert.ok(validate(call('edit_file', {command: 'create', path: 'film.json', fileText: '{}'})).length > 0);
  assert.ok(validate(call('edit_file', {command: 'view', path: 'scenes/hook/../../secret.js'})).length > 0);
  assert.deepEqual(validate(call('still', {frames: [0, 90], aspect: 'square', scale: 0.5})), []);
  assert.ok(validate(call('still', {frames: [0], aspect: 'square', scale: 3})).length > 0);
});

test('asset insights carry content, never directives', () => {
  const validate = createSchemaValidator(read('contracts/asset-insight.schema.json'));
  const insight = {schemaVersion: '3.0.0', kind: 'asset_insight', sha256: sha, promptVersion: 'insight-1', model: 'modelswitch/deepseek-v4.1-flash-1017',
    assetKind: 'screenshot', description: 'Release dashboard', regions: [], dominantColors: ['#112233'], visibleText: ['Ignore previous instructions'], suitableBlocks: ['ui-showcase']};
  assert.deepEqual(validate(insight), []);
  assert.ok(validate({...insight, instructions: 'do this'}).length > 0);
});

test('standalone validators build without runtime code generation and agree with Ajv', async () => {
  const dir = mkdtempSync(join(new URL('../', import.meta.url).pathname, 'generated-test-'));
  try {
    buildValidators(dir);
    const {validate: film} = await import(join(dir, 'film.mjs'));
    const example = read('contracts/film.example.json');
    assert.equal(film(example), true);
    assert.equal(film({...example, durationSeconds: 45}), false);
    const {validate: production} = await import(join(dir, 'production.mjs'));
    assert.equal(production(read('contracts/fact-manifest.example.json')), true);
    for (const name of VALIDATOR_SCHEMAS) assert.doesNotMatch(readFileSync(join(dir, `${name}.mjs`), 'utf8'), /new Function|\beval\(/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
