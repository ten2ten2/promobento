import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createSchemaValidator, parseCanonicalJson } from '../index.mjs';
import { VALIDATOR_SCHEMAS, buildValidators } from '../scripts/build-validators.mjs';

const read = path => parseCanonicalJson(readFileSync(new URL('../../../' + path, import.meta.url)));
const sha = 'a'.repeat(64);
const vectors = read('packages/contracts/test/schema-vectors.json').map(({schema, file, value}) => ({schema, value: file ? read(file) : value}));

test('the standalone build covers every contract Schema and every Schema has a positive vector', () => {
  const names = readdirSync(new URL('../../../contracts/', import.meta.url))
    .filter(name => name.endsWith('.schema.json')).map(name => name.replace('.schema.json', '')).sort();
  assert.deepEqual([...VALIDATOR_SCHEMAS].sort(), names);
  assert.deepEqual([...new Set(vectors.map(vector => vector.schema))].sort(), names);
});

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

test('public standalone imports validate all Schemas without runtime code generation and agree with Ajv', async () => {
  const files = buildValidators();
  const cases = [];
  for (const {schema, value} of vectors) {
    const {validate} = await import(`@promobento/contracts/validators/${schema}`);
    const reference = createSchemaValidator(read(`contracts/${schema}.schema.json`));
    // Fixed positive vectors, plus version, required-field, additional-property and type failures.
    const inputs = [value, {...value, schemaVersion: 'unknown'}, {...value, unexpected: true}, {}, null, []];
    for (const [index, input] of inputs.entries()) {
      const before = structuredClone(input), expected = index === 0;
      assert.equal(reference(input).length === 0, expected, schema + ': reference vector ' + index);
      assert.equal(validate(input), expected, schema + ': standalone vector ' + index);
      assert.deepEqual(input, before, schema + ': validation must not mutate input');
      cases.push({schema, input, expected});
    }
  }
  for (const file of files) {
    const code = readFileSync(file, 'utf8');
    assert.doesNotMatch(code, /new Function|\beval\(/);
    // Only Ajv runtime helpers/formats may be dependencies, never the compiler entry point.
    for (const [, dependency] of code.matchAll(/import \w+ from "([^"]+)"/g))
      assert.match(dependency, /^(?:ajv\/dist\/runtime\/[^/]+|ajv-formats\/dist\/formats)\.js$/);
  }
  const result = spawnSync(process.execPath, ['--disallow-code-generation-from-strings', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {readFileSync} from 'node:fs';
    import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
    for (const {schema, input, expected} of parseCanonicalJson(readFileSync(0))) {
      const {validate} = await import('@promobento/contracts/validators/' + schema);
      assert.equal(validate(parseCanonicalJson(canonical(input))), expected, schema);
    }
    assert.throws(() => parseCanonicalJson('{"a":1,"a":2}'), /DUPLICATE_JSON_KEY/);
  `], {cwd: new URL('../', import.meta.url), input: JSON.stringify(cases), encoding: 'utf8'});
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
});
