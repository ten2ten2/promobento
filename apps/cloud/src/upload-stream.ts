import {sha256Stream} from '@promobento/contracts/digest';

/** Pass R2 a backpressured stream, never a buffer sized from an untrusted header. */
export function boundedUploadStream(body: ReadableStream<Uint8Array> | null, length: number): ReadableStream<Uint8Array> {
  if (!Number.isSafeInteger(length) || length < 0 || length > 50 << 20) throw Error('OBJECT_TOO_LARGE');
  let received = 0;
  const input = body ?? new ReadableStream<Uint8Array>({start(controller) {controller.close();}});
  return input.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > length) throw Error('OBJECT_LENGTH_MISMATCH');
      controller.enqueue(chunk);
    },
    flush() {
      if (received !== length) throw Error('OBJECT_LENGTH_MISMATCH');
    },
  }));
}

/** Even a duplicate PUT must prove its incoming bytes, not merely repeat a matching header. */
export async function verifyUploadStream(body: ReadableStream<Uint8Array> | null, length: number, sha256: string) {
  if (await sha256Stream(boundedUploadStream(body, length)) !== sha256) throw Error('OBJECT_IDENTITY_MISMATCH');
}

/** Stored metadata is not a substitute for a differing R2 checksum. */
export function matchesStoredUpload(object: R2Object | null, length: number, sha256: string) {
  if (!object || object.size !== length || object.customMetadata?.sha256 !== sha256) return false;
  const checksum = object.checksums?.sha256;
  return !checksum || Array.from(new Uint8Array(checksum), byte => byte.toString(16).padStart(2, '0')).join('') === sha256;
}
