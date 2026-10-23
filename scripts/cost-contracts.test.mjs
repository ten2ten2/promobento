import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSchemaValidator, parseCanonicalJson } from '../packages/contracts/index.mjs';

const schema = parseCanonicalJson(readFileSync(new URL('../contracts/production.schema.json', import.meta.url)));
const validate = createSchemaValidator(schema);
const cost = () => ({
  schemaVersion: '3.0.0', kind: 'cost_event', eventId: 'cost-1', chargeId: 'charge-1', dedupKey: 'provider-request-1-actual',
  environment: 'local', scope: 'project', workspaceId: 'workspace-1', projectId: 'project-1', actorUserId: 'user-1',
  trialOwnerUserId: 'user-1', operationId: 'operation-1', attemptId: 'attempt-1', targetId: null,
  orderId: null, releaseId: null, reservationId: 'reservation-1', purpose: 'acquisition_trial',
  provider: 'example-provider', model: 'example-model', providerRequestId: 'request-1', priceVersion: 'price-fixture-1',
  methodPackageVersion: null, rendererImageDigest: null,
  usage: [{metric: 'input_tokens', unit: 'token', quantity: 123}, {metric: 'cache_read_tokens', unit: 'token', quantity: null}],
  usdMicros: 1234, status: 'actual', occurredAt: '2026-10-21T00:00:00Z', recordedAt: '2026-10-21T00:00:01Z',
  supersedesEventId: null, reason: null
});

test('cost observations support known amounts and explicitly unknown usage', () => {
  assert.deepEqual(validate(cost()), []);
  const unknown = cost(); unknown.status = 'estimated';
  assert.deepEqual(validate(unknown), []);
});

test('cost amounts reject fractional and unsafe integer micros', () => {
  for (const usdMicros of [-1, 0.1, 9007199254740992]) {
    assert.ok(validate({...cost(), usdMicros}).length);
  }
});

test('shared costs cannot pretend to belong to a project', () => {
  assert.ok(validate({...cost(), scope: 'shared'}).length);
  assert.ok(validate({...cost(), projectId: null}).length);
  assert.deepEqual(validate({...cost(), scope: 'shared', workspaceId: null, projectId: null, operationId: null, purpose: 'shared'}), []);
});

test('a replacement observation records the original event and its reason', () => {
  assert.ok(validate({...cost(), status: 'reconciled'}).length);
  const next = {...cost(), eventId: 'cost-2', status: 'reconciled', supersedesEventId: 'cost-1'};
  assert.ok(validate(next).length);
  assert.deepEqual(validate({...next, reason: 'Provider invoice confirmed the full charge amount.'}), []);
});
