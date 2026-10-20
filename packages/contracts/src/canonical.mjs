// RFC 8785: UTF-16 key order, ECMAScript number serialization, no Unicode normalization.
export const compareUtf16 = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function unicode(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) throw new TypeError('INVALID_UNICODE');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError('INVALID_UNICODE');
  }
  return value;
}

/** Canonicalize an in-memory JSON value. Use parseCanonicalJson at serialized-input boundaries. */
export function canonical(value) {
  const parents = new Set();
  const encode = (item, depth) => {
    if (depth > 64) throw new TypeError('MAX_DEPTH');
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') return JSON.stringify(unicode(item));
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('NON_FINITE');
      return JSON.stringify(item);
    }
    if (!item || typeof item !== 'object') throw new TypeError('NOT_JSON');
    if (parents.has(item)) throw new TypeError('CYCLIC_JSON');
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new TypeError('NOT_JSON');
    if (Object.getOwnPropertySymbols(item).length) throw new TypeError('NOT_JSON');
    parents.add(item);
    try {
      const props = Object.getOwnPropertyDescriptors(item);
      if (Array.isArray(item)) {
        if (Object.keys(props).length !== item.length + 1) throw new TypeError('NOT_JSON_ARRAY');
        const values = [];
        for (let i = 0; i < item.length; i++) {
          const prop = props[i];
          if (!prop || !Object.hasOwn(prop, 'value') || !prop.enumerable) throw new TypeError('NOT_JSON_ARRAY');
          values.push(encode(prop.value, depth + 1));
        }
        return '[' + values.join(',') + ']';
      }
      return '{' + Object.keys(props).sort(compareUtf16).map(key => {
        const prop = props[key];
        if (!prop.enumerable || !Object.hasOwn(prop, 'value')) throw new TypeError('NOT_JSON');
        return JSON.stringify(unicode(key)) + ':' + encode(prop.value, depth + 1);
      }).join(',') + '}';
    } finally { parents.delete(item); }
  };
  return encode(value, 0);
}

/**
 * Parse untrusted JSON before hashing or validation. JSON.parse validates grammar;
 * a token walk additionally rejects duplicate decoded property names, which an
 * already parsed object cannot reveal. UTF-8 bytes are decoded without replacement.
 */
export function parseCanonicalJson(input) {
  const source = typeof input === 'string' ? input
    : input instanceof Uint8Array ? new TextDecoder('utf-8', { fatal: true }).decode(input)
    : (() => { throw new TypeError('JSON_TEXT_REQUIRED'); })();
  const result = JSON.parse(source);
  let offset = 0;
  const space = () => { while (/[\x20\t\n\r]/u.test(source[offset] ?? '') && offset < source.length) offset++; };
  const string = () => {
    const start = offset++;
    while (source[offset] !== '"') offset += source[offset] === '\\' ? 2 : 1;
    return JSON.parse(source.slice(start, ++offset));
  };
  const visit = depth => {
    if (depth > 64) throw new TypeError('MAX_DEPTH');
    space();
    if (source[offset] === '{') {
      offset++; space();
      const names = new Set();
      if (source[offset] !== '}') for (;;) {
        const key = string();
        if (names.has(key)) throw new SyntaxError('DUPLICATE_JSON_KEY');
        names.add(key); space(); offset++; visit(depth + 1); space();
        if (source[offset] !== ',') break;
        offset++; space();
      }
      offset++;
    } else if (source[offset] === '[') {
      offset++; space();
      if (source[offset] !== ']') for (;;) {
        visit(depth + 1); space();
        if (source[offset] !== ',') break;
        offset++;
      }
      offset++;
    } else if (source[offset] === '"') string();
    else while (offset < source.length && !/[\x20\t\n\r,}\]]/u.test(source[offset])) offset++;
  };
  visit(0);
  // JCS uses binary64, including finite values outside the safe-integer range.
  // Business counts, money and frame indices are bounded separately by their schemas.
  canonical(result); // Reject invalid Unicode, non-finite overflow and non-JSON values.
  return result;
}
