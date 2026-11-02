import {canonical, parseCanonicalJson} from '@promobento/contracts/canonical';
import {digest, sha256Bytes} from '@promobento/contracts/digest';
import {assertNativeProject, nativeProjectHash, NATIVE_RUNTIME_COMMIT} from '@promobento/contracts/native-project';
import {validate as validNativeProject} from '@promobento/contracts/validators/native-project';
import {getJson, immutableJson, operation} from './store.ts';
import {flushOutbox} from './outbox.ts';
import {validId, type PipelineEnv, type Operation, type Json} from './pipeline-types.ts';
import {nativeRenderPolicy} from './native-policy.ts';

export const NATIVE_COMMIT = NATIVE_RUNTIME_COMMIT;
export type SavedNativeProject = {revisionId: string; manifestKey: string; project: Json};
type NativeRenderMode = 'preview' | 'export';
export const previewFrames = (duration: number) => [0, duration / 3, duration * 2 / 3, duration - 1 / 30];
export function assertCloudNativeProject(project: unknown) {
  if (!validNativeProject(project)) throw Error('NATIVE_PROJECT_SCHEMA_INVALID');
  return assertNativeProject(project);
}

/** Versions are immutable branches. A parent must belong to the same workspace/project. */
export async function loadNativeProject(env: PipelineEnv, op: Operation, revisionId: string): Promise<SavedNativeProject> {
  if (typeof revisionId !== 'string' || !/^[a-f0-9]{64}$/.test(revisionId)) throw Error('NATIVE_REVISION_INVALID');
  const row = await env.DB.prepare('SELECT n.manifest_key FROM pipeline_native_projects n JOIN pipeline_operations o ON o.id=n.operation_id WHERE n.revision_id=? AND o.workspace_id=? AND o.project_id=? ORDER BY n.created_at LIMIT 1')
    .bind(revisionId, op.workspace_id, op.project_id).first<{manifest_key: string}>();
  if (!row) throw Error('NATIVE_PROJECT_NOT_FOUND');
  const project = await getJson(env, row.manifest_key);
  assertCloudNativeProject(project);
  if (await nativeProjectHash(project) !== revisionId) throw Error('SOURCE_IDENTITY_MISMATCH');
  return {revisionId, manifestKey: row.manifest_key, project};
}

/** Check every immutable input before allocating paid compute. No source is evaluated in Workers. */
export async function verifyNativeInputs(env: PipelineEnv, project: Json) {
  assertCloudNativeProject(project);
  if (project.timingEvidenceRef) await checkedNativeBytes(env, project.timingEvidenceRef, 6 << 20);
  for (const file of project.files) {
    const head = await env.MEDIA.head(file.key);
    if (!head || head.size !== file.byteLength || head.customMetadata?.sha256 !== file.sha256) throw Error('SOURCE_IDENTITY_MISMATCH');
  }
}

export async function saveNativeProject(env: PipelineEnv, op: Operation, input: {
  composition: Json; files: Json[]; resources?: Json[]; baseRevision?: string; timingEvidenceRef?: Json;
}): Promise<SavedNativeProject> {
  await operation(env, op.id, op.generation);
  // Internal HTTP callers still supply untrusted JSON. A malformed list must
  // produce a domain validation error, not a TypeError/500 before Schema checks.
  if (!Array.isArray(input.files) || input.files.some(file => !file || typeof file !== 'object'
    || typeof file.path !== 'string' || typeof file.key !== 'string')
    || input.resources !== undefined && (!Array.isArray(input.resources)
      || input.resources.some(resource => !resource || typeof resource !== 'object' || Array.isArray(resource)
        || typeof resource.resourceId !== 'string' || !resource.resourceId
        || typeof resource.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256)))
    || input.baseRevision !== undefined && typeof input.baseRevision !== 'string'
    || input.timingEvidenceRef !== undefined && (!input.timingEvidenceRef
      || typeof input.timingEvidenceRef !== 'object' || Array.isArray(input.timingEvidenceRef)
      || typeof input.timingEvidenceRef.key !== 'string'))
    throw Error('NATIVE_PROJECT_SCHEMA_INVALID');
  const parent = input.baseRevision ? await loadNativeProject(env, op, input.baseRevision) : null;
  const timingEvidenceRef = input.timingEvidenceRef ?? parent?.project.timingEvidenceRef;
  if (timingEvidenceRef && (typeof timingEvidenceRef.key !== 'string'
    || !timingEvidenceRef.key.startsWith('operations/' + op.id + '/')
      && (!parent?.project.timingEvidenceRef
        || canonical(timingEvidenceRef) !== canonical(parent.project.timingEvidenceRef))))
    throw Error('NATIVE_TIMING_EVIDENCE_SCOPE_INVALID');
  for (const file of input.files) {
    const inherited = parent?.project.files.some((previous: Json) => previous.key === file.key
      && previous.sha256 === file.sha256 && previous.byteLength === file.byteLength);
    // evals/ is the shared internal-owner import area, not a customer upload namespace.
    // Cross-operation generated files require an explicitly scoped immutable parent revision.
    if (!file.key?.startsWith('evals/') && !file.key?.startsWith('operations/' + op.id + '/') && !inherited)
      throw Error('NATIVE_FILE_SCOPE_INVALID');
  }
  // Revisions must not shed the parent's rights obligations. Direct API callers
  // need the same inheritance guarantee as Director-authored revisions.
  const resources = new Map<string,Json>();
  for (const resource of [...(parent?.project.resources ?? []),...(input.resources ?? [])]) {
    const identity = typeof resource.resourceId === 'string' && typeof resource.sha256 === 'string'
      ? canonical([resource.resourceId,resource.sha256]) : canonical(resource);
    const previous = resources.get(identity);
    if (previous && canonical(previous) !== canonical(resource)) throw Error('NATIVE_RESOURCE_CONFLICT');
    if (!previous) resources.set(identity,resource);
  }
  const project = {
    schemaVersion: '1.0.0', kind: 'native_project', entry: 'index.html',
    runtime: {name: 'huashu-motion', commit: NATIVE_COMMIT},
    composition: input.composition, files: input.files.map(file => ({
      path: file.path, key: file.key, sha256: file.sha256, byteLength: file.byteLength, mediaType: file.mediaType,
    })).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    resources: [...resources.values()], ...(timingEvidenceRef ? {timingEvidenceRef} : {}),
  };
  await verifyNativeInputs(env, project);
  const revisionId = await nativeProjectHash(project);
  const manifest = await immutableJson(env, 'operations/' + op.id + '/native/' + revisionId + '/project.json', project);
  await env.DB.prepare('INSERT OR IGNORE INTO pipeline_native_projects(operation_id,revision_id,parent_revision,manifest_key,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status IN (\'active\',\'awaiting_user\'))')
    .bind(op.id, revisionId, input.baseRevision ?? null, manifest.key, Date.now(), op.id, op.generation).run();
  const stored = await env.DB.prepare('SELECT manifest_key,parent_revision FROM pipeline_native_projects WHERE operation_id=? AND revision_id=?')
    .bind(op.id, revisionId).first<{manifest_key: string; parent_revision: string | null}>();
  if (!stored || stored.manifest_key !== manifest.key || stored.parent_revision !== (input.baseRevision ?? null)) throw Error('NATIVE_REVISION_CONFLICT');
  return {revisionId, manifestKey: manifest.key, project};
}

export function validateFrameTimes(project: Json, mode: NativeRenderMode, requested?: number[]) {
  if (!['preview', 'export'].includes(mode)) throw Error('NATIVE_RENDER_MODE_INVALID');
  if (mode === 'export') {
    if (requested !== undefined) throw Error('NATIVE_FRAME_TIMES_INVALID');
    return undefined;
  }
  const frames = requested ?? previewFrames(project.composition.durationSeconds);
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > 12
    || new Set(frames).size !== frames.length
    || frames.some(time => !Number.isFinite(time) || time < 0 || time > project.composition.durationSeconds - 1 / 30))
    throw Error('NATIVE_FRAME_TIMES_INVALID');
  return frames;
}

export async function createNativeRender(env: PipelineEnv, op: Operation, input: {
  renderId: string; revisionId: string; mode: NativeRenderMode; rendererRelease: string; runtimeVersion?: string; frames?: number[];
}, beforeCommit:()=>void=()=>{}) {
  beforeCommit();
  await operation(env, op.id, op.generation);
  if (!validId(input.renderId) || !validId(input.rendererRelease)) throw Error('NATIVE_RENDER_INVALID');
  const saved = await loadNativeProject(env, op, input.revisionId);
  await verifyNativeInputs(env, saved.project);
  const runtimeVersion = input.runtimeVersion ?? NATIVE_COMMIT;
  if (runtimeVersion !== saved.project.runtime.commit) throw Error('RENDER_ENVIRONMENT_MISMATCH');
  const release = await env.DB.prepare('SELECT image_digest,runtime_version FROM renderer_releases WHERE id=? AND status=\'active\'')
    .bind(input.rendererRelease).first<{image_digest: string; runtime_version: string}>();
  if (!release || release.runtime_version !== runtimeVersion || !/^sha256:[a-f0-9]{64}$/.test(release.image_digest)) throw Error('RENDER_ENVIRONMENT_MISMATCH');
  const frames = validateFrameTimes(saved.project, input.mode, input.frames);
  const request = {schemaVersion: '1.0.0', kind: 'native_render_request', operationId: op.id,
    renderId: input.renderId, revisionId: saved.revisionId, project: saved.project,
    mode: input.mode, rendererRelease: input.rendererRelease, runtimeVersion, ...(frames ? {frames} : {})};
  const hash = digest(request);
  const existing = await env.DB.prepare('SELECT operation_id,generation,request_hash FROM pipeline_renders WHERE id=?')
    .bind(input.renderId).first<Json>();
  if (existing) {
    if (existing.operation_id !== op.id || existing.generation !== op.generation || existing.request_hash !== hash) throw Error('IDEMPOTENCY_CONFLICT');
    return {renderId: input.renderId};
  }
  const object = await immutableJson(env, 'renders/' + input.renderId + '/input.json', request);
  // An independent Director item may fail while the request is being verified
  // or written to R2. Do not enqueue new compute after that stage has aborted.
  beforeCommit();
  const payload = canonical({renderId: input.renderId, engine: 'huashu'}), outboxId = 'render-' + input.renderId;
  const createdAt = Date.now(), queueDeadlineAt = createdAt + nativeRenderPolicy.queueWaitMs;
  const operationDeadlineAt = createdAt + (input.mode === 'preview' ? nativeRenderPolicy.previewOperationMs : nativeRenderPolicy.exportOperationMs);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO pipeline_renders(id,operation_id,generation,request_hash,job_key,status,created_at,queue_deadline_at,operation_deadline_at,mode) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_operations WHERE id=? AND generation=? AND status=\'active\')')
      .bind(input.renderId, op.id, op.generation, hash, object.key, 'queued', createdAt, queueDeadlineAt, operationDeadlineAt, input.mode, op.id, op.generation),
    env.DB.prepare('INSERT OR IGNORE INTO pipeline_outbox(id,operation_id,kind,payload_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM pipeline_renders WHERE id=? AND operation_id=? AND generation=? AND request_hash=?)')
      .bind(outboxId, op.id, 'render', payload, input.renderId, op.id, op.generation, hash),
  ]);
  const admitted = await env.DB.prepare('SELECT request_hash FROM pipeline_renders WHERE id=? AND operation_id=? AND generation=?')
    .bind(input.renderId, op.id, op.generation).first<{request_hash: string}>();
  if (admitted?.request_hash !== hash) throw Error('OPERATION_FENCED');
  try { await flushOutbox(env, outboxId); } catch { /* The transaction remains deliverable by the scheduled outbox sweep. */ }
  return {renderId: input.renderId};
}

export async function getNativeRender(env: PipelineEnv, op: Operation, renderId: string): Promise<Json | null> {
  const row = await env.DB.prepare('SELECT * FROM pipeline_renders WHERE id=? AND operation_id=? AND generation=?')
    .bind(renderId, op.id, op.generation).first<Json>();
  if (!row) return null;
  const pending = row.status === 'queued' ? await env.DB.prepare("SELECT status FROM pipeline_render_admissions WHERE render_id=? AND status='admitted' LIMIT 1")
    .bind(renderId).first<{status: string}>() : null;
  return {...row, status: pending ? 'admitted' : row.status, result: row.result_json ? parseCanonicalJson(row.result_json) : null};
}

/** Verify stored bytes. Evidence must be nonempty; ordinary authored files may explicitly allow empty content. */
export async function checkedNativeBytes(env: PipelineEnv, blob: Json, limit = 50 << 20, options: {allowEmpty?: boolean} = {}) {
  if (!blob || typeof blob.key !== 'string' || !blob.key
    || typeof blob.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(blob.sha256)
    || !Number.isSafeInteger(blob.byteLength) || blob.byteLength < (options.allowEmpty ? 0 : 1)
    || blob.byteLength > limit) throw Error('RENDER_OUTPUT_INVALID');
  const object = await env.MEDIA.get(blob.key);
  if (!object || object.size !== blob.byteLength || object.customMetadata?.sha256 !== blob.sha256) throw Error('SOURCE_IDENTITY_MISMATCH');
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (sha256Bytes(bytes) !== blob.sha256) throw Error('SOURCE_IDENTITY_MISMATCH');
  return bytes;
}
