/** Node's Web Streams do not expose workerd's FixedLengthStream. Only this
 * test shim brands the readable half so the R2 mock can reject unknown sizes. */
const knownLengths = new WeakMap();

class TestFixedLengthStream {
  constructor(length) {
    let written = 0;
    const {readable, writable} = new TransformStream({
      transform(chunk, controller) {
        written += chunk.byteLength;
        if (written > length) throw Error('FIXED_LENGTH_EXCESS');
        controller.enqueue(chunk);
      },
      flush() {if (written !== length) throw Error('FIXED_LENGTH_SHORT');},
    });
    this.readable = readable;
    this.writable = writable;
    knownLengths.set(readable, length);
  }
}

if (typeof globalThis.FixedLengthStream === 'undefined') globalThis.FixedLengthStream = TestFixedLengthStream;
export const fixedLengthOf = stream => knownLengths.get(stream);
