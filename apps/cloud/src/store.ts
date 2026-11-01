import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import {boundedUploadStream, matchesStoredUpload, verifyUploadStream} from './upload-stream.ts';
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
  return immutableBytes(env,key,new TextEncoder().encode(canonical(value)),'application/json');
}
export async function immutableBytes(env:PipelineEnv,key:string,bytes:Uint8Array,mediaType:string):Promise<BlobRef>{
  const hash = sha256Bytes(bytes);
  const existing = await env.MEDIA.head(key);
  if (existing && existing.customMetadata?.sha256 !== hash) throw Error('IMMUTABLE_OBJECT_CONFLICT');
  if (!existing) await env.MEDIA.put(key, bytes, {onlyIf: new Headers({'If-None-Match': '*'}), httpMetadata: {contentType: mediaType}, customMetadata: {sha256: hash}});
  const actual = await env.MEDIA.head(key);
  if (actual?.customMetadata?.sha256 !== hash || actual.size !== bytes.length) throw Error('IMMUTABLE_OBJECT_CONFLICT');
  return {name: key.split('/').at(-1)!, key, sha256: hash, byteLength: bytes.length, mediaType};
}
/** Internal asset ingress: caller supplies the SHA-256 before transfer; R2 enforces it while streaming. */
export async function immutableStream(env: PipelineEnv, key: string, body: ReadableStream<Uint8Array> | null,
  length: number, sha256: string, mediaType: string): Promise<BlobRef> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw Error('OBJECT_SHA256_REQUIRED');
  if (!Number.isSafeInteger(length) || length < 0 || length > 50 << 20) throw Error('OBJECT_TOO_LARGE');
  const previous = await env.MEDIA.head(key);
  if (previous && !matchesStoredUpload(previous, length, sha256)) throw Error('IMMUTABLE_OBJECT_CONFLICT');
  if (previous) await verifyUploadStream(body, length, sha256);
  else {
    const created = await env.MEDIA.put(key, boundedUploadStream(body, length), {
      sha256, onlyIf: new Headers({'If-None-Match': '*'}),
      customMetadata: {sha256}, httpMetadata: {contentType: mediaType},
    });
    if (!created) throw Error('IMMUTABLE_OBJECT_CONFLICT');
  }
  if (!matchesStoredUpload(await env.MEDIA.head(key), length, sha256)) throw Error('IMMUTABLE_OBJECT_CONFLICT');
  return {name: key.split('/').at(-1)!, key, sha256, byteLength: length, mediaType};
}
export async function getJson(env: PipelineEnv, key: string): Promise<Json> {
  const object = await env.MEDIA.get(key); if (!object || object.size > 8 << 20) throw Error('SOURCE_UNAVAILABLE');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (object.customMetadata?.sha256 && sha256Bytes(bytes) !== object.customMetadata.sha256) throw Error('SOURCE_IDENTITY_MISMATCH');
  return parseCanonicalJson(bytes) as Json;
}
/** Local operation/stage admission, including unresolved costs. MODEL_LEDGER owns the cross-environment model grant. */
export async function reserve(env: PipelineEnv, op: Operation, id: string, kind: 'model' | 'compute', stage: string,
  max: number, request: unknown, catalogVersion: string, globalLimit: number, stageLimit = max, maxCalls = Number.MAX_SAFE_INTEGER, preventPendingReplay = false) {
  if (!Number.isSafeInteger(max) || max < 0) throw Error('COST_RESERVATION_INVALID');
  const hash = digest(request);
  const sameReservation = (row: {operation_id: string;request_hash: string;kind: string;stage: string;reserved_micros: number;catalog_version: string}) =>
    row.operation_id === op.id && row.request_hash === hash && row.kind === kind && row.stage === stage
      && row.reserved_micros === max && row.catalog_version === catalogVersion;
  const existing = await env.DB.prepare('SELECT operation_id,request_hash,kind,stage,reserved_micros,catalog_version FROM cost_reservations WHERE id=?')
    .bind(id).first<{operation_id: string;request_hash: string;kind: string;stage: string;reserved_micros: number;catalog_version: string}>();
  if (existing) {if (!sameReservation(existing)) throw Error('IDEMPOTENCY_CONFLICT');return;}
  const sum = 'SELECT COALESCE(SUM(COALESCE(s.actual_micros,r.reserved_micros)),0) FROM cost_reservations r LEFT JOIN cost_settlements s ON s.reservation_id=r.id';
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO cost_reservations(id,operation_id,request_hash,kind,stage,reserved_micros,catalog_version,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status='active')
    AND (?<>'compute' OR EXISTS(SELECT 1 FROM pipeline_attempts p
      JOIN pipeline_render_admissions a ON a.id=p.id JOIN pipeline_renders r ON r.id=p.render_id
      WHERE p.id=? AND p.operation_id=? AND p.generation=? AND p.status='active' AND p.stopped_at IS NULL
        AND a.status='running' AND a.render_id=p.render_id AND a.operation_id=p.operation_id
        AND a.generation=p.generation AND r.status='rendering' AND r.generation=p.generation))
    AND (${sum} WHERE r.operation_id=?) + ? <= ? AND (${sum} WHERE r.kind=?) + ? <= ?
    AND (${sum} WHERE r.operation_id=? AND r.kind=? AND r.stage=?) + ? <= ?
    AND (SELECT COUNT(*) FROM cost_reservations WHERE operation_id=? AND kind=? AND stage=?) < ?
    AND (?=0 OR NOT EXISTS(SELECT 1 FROM cost_reservations r JOIN pipeline_operations p ON p.id=r.operation_id
      LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.kind='model' AND r.request_hash=? AND r.catalog_version=?
      AND p.workspace_id=? AND p.project_id=? AND p.purpose=? AND s.reservation_id IS NULL))`)
    .bind(id, op.id, hash, kind, stage, max, catalogVersion, Date.now(), op.id, op.generation,
      kind, id, op.id, op.generation,
      op.id, max, op.max_micros, kind, max, globalLimit, op.id, kind, stage, max, stageLimit, op.id, kind, stage, maxCalls,
      preventPendingReplay?1:0,hash,catalogVersion,op.workspace_id,op.project_id,op.purpose).run();
  if (result.meta.changes !== 1) {
    // Two identical reservations can both miss the preflight read. Only the
    // exact same cost identity can turn the losing INSERT into a safe replay.
    const winner = await env.DB.prepare('SELECT operation_id,request_hash,kind,stage,reserved_micros,catalog_version FROM cost_reservations WHERE id=?')
      .bind(id).first<typeof existing>();
    if (winner) {if (!sameReservation(winner)) throw Error('IDEMPOTENCY_CONFLICT');return;}
    if(preventPendingReplay&&await env.DB.prepare(`SELECT r.id FROM cost_reservations r JOIN pipeline_operations p ON p.id=r.operation_id
      LEFT JOIN cost_settlements s ON s.reservation_id=r.id WHERE r.kind='model' AND r.request_hash=? AND r.catalog_version=?
      AND p.workspace_id=? AND p.project_id=? AND p.purpose=? AND s.reservation_id IS NULL LIMIT 1`)
      .bind(hash,catalogVersion,op.workspace_id,op.project_id,op.purpose).first())throw Error('MODEL_CALL_RECONCILIATION_REQUIRED');
    throw Error('COST_BUDGET_EXHAUSTED');
  }
}
export async function settle(env: PipelineEnv, id: string, actualMicros: number, usage: unknown) {
  if (!Number.isSafeInteger(actualMicros) || actualMicros < 0) throw Error('COST_SETTLEMENT_INVALID');
  const value = canonical(usage);
  await env.DB.prepare('INSERT OR IGNORE INTO cost_settlements(reservation_id,actual_micros,usage_json,settled_at) VALUES(?,?,?,?)')
    .bind(id, actualMicros, value, Date.now()).run();
  const previous = await env.DB.prepare('SELECT actual_micros,usage_json FROM cost_settlements WHERE reservation_id=?').bind(id).first<{actual_micros: number; usage_json: string}>();
  if (!previous || previous.actual_micros !== actualMicros || previous.usage_json !== value) throw Error('COST_SETTLEMENT_CONFLICT');
}
