import {canonical} from './canonical.mjs';

/** random-seq-v1: FNV-1a-32 of UTF-8(seed + NUL + decimal index), then Murmur3 fmix32 / 2^32. */
export function randomSequence(seed) {
  if (typeof seed !== 'string') throw new TypeError('RANDOM_SEED_REQUIRED');
  canonical(seed);
  let index = 0;
  const encoder = new TextEncoder();
  return {
    reset() { index = 0; },
    next() {
      if (!Number.isSafeInteger(index)) throw new RangeError('RANDOM_SEQUENCE_EXHAUSTED');
      let value = 2166136261;
      for (const byte of encoder.encode(seed + '\0' + index++)) value = Math.imul(value ^ byte, 16777619) >>> 0;
      value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
      value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
      return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
    }
  };
}
