// Browser-safe source values and portable path rules, shared with the trusted builder.
import { canonical, parseCanonicalJson } from './canonical.mjs';

// Comparison only: accepted paths and their original UTF-8 bytes are never rewritten.
// Compatibility folding deliberately rejects more aliases than a particular filesystem might.
export const pathComparisonKey = value => value.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');
const reservedName = part => /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/u.test(pathComparisonKey(part));
export const safePath = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value.isWellFormed() && value === value.normalize('NFC')
  && !/[\\\u0000-\u001f\u007f%:?#<>"|*]/u.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..'
    && !/[. ]$/u.test(part) && !reservedName(part) && new TextEncoder().encode(part).byteLength <= 255);
export const SOURCE_VALUES_MAX_BYTES = 1024 * 1024;
export const SOURCE_VALUES_MAX_ITEMS = 256;

/** The persisted file has no request-protocol metadata and always uses the same JCS bytes. */
export function sourceValuesBytes(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('SOURCE_VALUES_INVALID');
  if (Object.keys(values).length > SOURCE_VALUES_MAX_ITEMS) throw Error('SOURCE_VALUES_TOO_MANY');
  let bytes;
  try { bytes = new TextEncoder().encode(canonical({kind:'source_values',values})); }
  catch { throw Error('SOURCE_VALUES_INVALID'); }
  if (bytes.byteLength > SOURCE_VALUES_MAX_BYTES) throw Error('SOURCE_VALUES_TOO_LARGE');
  return bytes;
}

/** Check the original byte budget before JSON parsing; persisted files must already be canonical. */
export function parseSourceValues(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (!(bytes instanceof Uint8Array)) throw Error('SOURCE_VALUES_INVALID');
  if (bytes.byteLength > SOURCE_VALUES_MAX_BYTES) throw Error('SOURCE_VALUES_TOO_LARGE');
  let document;
  try { document = parseCanonicalJson(bytes); }
  catch { throw Error('SOURCE_VALUES_INVALID'); }
  if (!document || document.kind !== 'source_values' || Object.keys(document).length !== 2
    || !Object.hasOwn(document,'values')) throw Error('SOURCE_VALUES_INVALID');
  const expected = sourceValuesBytes(document.values);
  if (bytes.byteLength !== expected.byteLength || !bytes.every((byte,index) => byte === expected[index]))
    throw Error('SOURCE_VALUES_NOT_CANONICAL');
  return document;
}
