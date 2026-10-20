import test from 'node:test';
import assert from 'node:assert/strict';
import { createSchemaValidator } from '../index.mjs';

const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://promobento.test/validator-test',
  type: 'object',
  properties: {
    intent: { enum: ['preview', 'export'] }, snapshotId: { type: 'string', minLength: 1 },
    confirmedAt: { type: 'string', format: 'date-time' }, count: { type: 'integer', default: 3 }
  },
  required: ['intent'], additionalProperties: false,
  allOf: [{ if: { properties: { intent: { const: 'export' } } }, then: { properties: { snapshotId: {} }, required: ['snapshotId'] } }],
  $defs: { value: { type: 'integer', minimum: 1 } }
};

test('full Draft 2020-12 validator enforces conditional fields and real date-time formats', () => {
  const validate = createSchemaValidator(schema);
  assert.deepEqual(validate({ intent: 'preview' }), []);
  assert.ok(validate({ intent: 'export' }).length);
  assert.deepEqual(validate({ intent: 'export', snapshotId: 's1', confirmedAt: '2026-10-20T12:00:00Z' }), []);
  assert.ok(validate({ intent: 'preview', confirmedAt: 'banana' }).length);
  assert.ok(validate({ intent: 'preview', confirmedAt: '2026-02-30T12:00:00Z' }).length);
});

test('schema validation preserves input and does not coerce, default or strip properties', () => {
  const validate = createSchemaValidator(schema);
  const value = { intent: 'preview', count: '3', extra: true }, original = structuredClone(value);
  assert.ok(validate(value).length);
  assert.deepEqual(value, original);
  const missing = { intent: 'preview' };
  assert.deepEqual(validate(missing), []);
  assert.equal(Object.hasOwn(missing, 'count'), false);
});

test('all definitions compile in strict mode even when no example references them', () => {
  const invalid = structuredClone(schema);
  invalid.$defs.unused = { type: 'string', minLenght: 2 };
  assert.throws(() => createSchemaValidator(invalid), /unknown keyword/u);
});

test('definition and ad hoc local references share the full schema vocabulary', () => {
  const validate = createSchemaValidator(schema);
  assert.deepEqual(validate(2, schema.$defs.value), []);
  assert.ok(validate(0, { $ref: '#/$defs/value' }).length);
  assert.deepEqual(validate(2, { $ref: '#/$defs/value' }), []);
  assert.ok(validate('2026-02-30T12:00:00Z', schema.properties.confirmedAt).length);
});
