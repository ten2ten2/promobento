import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import type {PipelineEnv, Operation, BlobRef, Json} from './pipeline-types.ts';

export async function readJson(request: Request, limit = 4 << 20): Promise<Json> {
  if (!request.body) throw Error('BODY_REQUIRED');
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const {done, value} = await reader.read(); if (done) break; size += value.length;
    if (size > limit) throw Error('BODY_TOO_LARGE'); chunks.push(value); } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return parseCanonicalJson(bytes) as Json;
}
export async function operation(env: PipelineEnv, id: string, generation?: number): Promise<Operation> {
  const row = await env.DB.prepare('SELECT * FROM pipeline_operations WHERE id=?').bind(id).first<Operation>();
  if (!row || !['active', 'awaiting_user'].includes(row.status) || generation !== undefined && row.generation !== generation) throw Error('OPERATION_FENCED');
  return row;
}
export async function rights(env: PipelineEnv, op: Operation, resources: Json[]) {
  for (const resource of resources) {
    const row = await env.DB.prepare('SELECT evidence_key,license_ref FROM pipeline_rights WHERE operation_id=? AND resource_id=? AND sha256=? AND revoked_at IS NULL')
      .bind(op.id, resource.resourceId, resource.sha256).first<{evidence_key: string; license_ref: string}>();
    if (!row || !await env.MEDIA.head(row.evidence_key)) throw Error('ASSET_RIGHTS_PENDING');
  }
}
export async function immutableJson(env: PipelineEnv, key: string, value: unknown): Promise<BlobRef> {
  const text = canonical(value), bytes = new TextEncoder().encode(text), hash = sha256Bytes(bytes);
  const existing = await env.MEDIA.head(key);
  if (existing && existing.customMetadata?.sha256 !== hash) throw Error('IMMUTABLE_OBJECT_CONFLICT');
  if (!existing) await env.MEDIA.put(key, bytes, {onlyIf: new Headers({'If-None-Match': '*'}), httpMetadata: {contentType: 'application/json'}, customMetadata: {sha256: hash}});
  const actual = await env.MEDIA.head(key);
  if (actual?.customMetadata?.sha256 !== hash || actual.size !== bytes.length) throw Error('IMMUTABLE_OBJECT_CONFLICT');
  return {name: key.split('/').at(-1)!, key, sha256: hash, byteLength: bytes.length, mediaType: 'application/json'};
}
export async function getJson(env: PipelineEnv, key: string): Promise<Json> {
  const object = await env.MEDIA.get(key); if (!object || object.size > 8 << 20) throw Error('SOURCE_UNAVAILABLE');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (object.customMetadata?.sha256 && sha256Bytes(bytes) !== object.customMetadata.sha256) throw Error('SOURCE_IDENTITY_MISMATCH');
  return parseCanonicalJson(bytes) as Json;
}
/** One atomic INSERT reserves against operation + global model authorization, including unresolved costs. */
export async function reserve(env: PipelineEnv, op: Operation, id: string, kind: 'model' | 'compute', stage: string,
  max: number, request: unknown, catalogVersion: string, globalLimit: number, stageLimit = max, maxCalls = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(max) || max < 0) throw Error('COST_RESERVATION_INVALID');
  const hash = digest(request), existing = await env.DB.prepare('SELECT request_hash FROM cost_reservations WHERE id=?').bind(id).first<{request_hash: string}>();
  if (existing) { if (existing.request_hash !== hash) throw Error('IDEMPOTENCY_CONFLICT'); return; }
  const sum = 'SELECT COALESCE(SUM(COALESCE(s.actual_micros,r.reserved_micros)),0) FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id';
  const result = await env.DB.prepare(`INSERT INTO cost_reservations(id,operation_id,request_hash,kind,stage,reserved_micros,catalog_version,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')
    AND (${sum} WHERE r.operation_id=?) + ? <= ? AND (${sum} WHERE r.kind=?) + ? <= ?
    AND (${sum} WHERE r.operation_id=? AND r.kind=? AND r.stage=?) + ? <= ?
    AND (SELECT COUNT(*) FROM cost_reservations WHERE operation_id=? AND kind=? AND stage=?) < ?`)
    .bind(id, op.id, hash, kind, stage, max, catalogVersion, Date.now(), op.id, op.generation,
      op.id, max, op.max_micros, kind, max, globalLimit, op.id, kind, stage, max, stageLimit, op.id, kind, stage, maxCalls).run();
  if (result.meta.changes !== 1) throw Error('COST_BUDGET_EXHAUSTED');
}
export async function settle(env: PipelineEnv, id: string, actualMicros: number, usage: unknown) {
  if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) throw Error('COST_SETTLEMENT_INVALID');
  const value = canonical(usage);
  const previous = await env.DB.prepare('SELECT actual_micros,usage_json FROM cost_settlements WHERE reservation_id=?').bind(id).first<{actual_micros: number; usage_json: string}>();
  if (previous) { if (previous.actual_micros !== actualMicros || previous.usage_json !== value) throw Error('COST_SETTLEMENT_CONFLICT'); return; }
  await env.DB.prepare('INSERT INTO cost_settlements(reservation_id,actual_micros,usage_json,settled_at) VALUES(?,?,?,?)')
    .bind(id, actualMicros, value, Date.now()).run();
}
