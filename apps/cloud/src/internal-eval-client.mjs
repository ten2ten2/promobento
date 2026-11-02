import {sha256Bytes} from '@promobento/contracts/digest';

/** Headers for every owner-only R2 upload, calculated from the actual request bytes. */
export function objectUploadHeaders(bytes) {
  if (!(bytes instanceof Uint8Array)) throw Error('OBJECT_BYTES_REQUIRED');
  return {'content-length': String(bytes.byteLength), 'x-content-sha256': sha256Bytes(bytes)};
}

/** A queued render also prevents an internal credential handoff or idle readback. */
export function requireIdleCapacity(snapshot, code) {
  if (!snapshot || !Array.isArray(snapshot.leases)
    || !Number.isSafeInteger(snapshot.queued) || snapshot.queued < 0)
    throw Error('CAPACITY_RESPONSE_INVALID');
  if (snapshot.leases.length || snapshot.queued) throw Error(code);
}
