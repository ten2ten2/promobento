import {sha256Stream} from '@promobento/contracts/digest';

function checkedInput(body: ReadableStream<Uint8Array> | null, length: number) {
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

/** R2 requires a runtime-known stream length; a normal TransformStream loses that property. */
export function boundedUploadStream(body: ReadableStream<Uint8Array> | null, length: number) {
  const input = checkedInput(body, length);
  const {readable, writable} = new FixedLengthStream(length);
  const controller = new AbortController();
  const finished = input.pipeTo(writable, {signal: controller.signal});
  // R2 can reject a checksum or an If-None-Match before the source finishes.
  // Observe that asynchronous pipe rejection even when the caller aborts early.
  void finished.catch(() => {});
  return {readable, finished, cancel: () => controller.abort()};
}

/** Even a duplicate PUT must prove its incoming bytes, not merely repeat a matching header. */
export async function verifyUploadStream(body: ReadableStream<Uint8Array> | null, length: number, sha256: string) {
  if (await sha256Stream(checkedInput(body, length)) !== sha256) throw Error('OBJECT_IDENTITY_MISMATCH');
}

/** Await both R2's checksum decision and the validated source pump. */
export async function putBoundedUpload(bucket: R2Bucket, key: string, body: ReadableStream<Uint8Array> | null,
  length: number, options: R2PutOptions) {
  const upload = boundedUploadStream(body, length);
  try {
    const result = await bucket.put(key, upload.readable, options);
    if (!result) {upload.cancel(); return null;}
    await upload.finished;
    return result;
  } catch (error) {
    upload.cancel();
    // A failed R2 call must not wait forever for a broken request body's
    // cancellation callback. The pipe rejection is already observed above.
    throw error;
  }
}

/** Stored metadata is not a substitute for a differing R2 checksum. */
export function matchesStoredUpload(object: R2Object | null, length: number, sha256: string) {
  if (!object || object.size !== length || object.customMetadata?.sha256 !== sha256) return false;
  const checksum = object.checksums?.sha256;
  return !checksum || Array.from(new Uint8Array(checksum), byte => byte.toString(16).padStart(2, '0')).join('') === sha256;
}
