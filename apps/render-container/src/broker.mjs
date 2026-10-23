import {sha256Bytes} from '@promobento/contracts/digest';

/** Token lives only in this closure, not files, URLs, child environments, or diagnostics. */
export function brokerClient(token, signal) {
  if (typeof token !== 'string' || token.length > 16384 || !token.length) throw Error('BROKER_TOKEN_REQUIRED');
  const keyPath = key => {
    if (typeof key !== 'string' || !key.length || key.length > 1024 || key.split('/').some(part => !part || part === '.' || part === '..')) throw Error('BROKER_KEY_INVALID');
    return key.split('/').map(encodeURIComponent).join('/');
  };
  const headers = {authorization: 'Bearer ' + token};
  return {
    async read({key, sha256, byteLength}, maxBytes = 40 << 20) {
      if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxBytes) throw Error('BROKER_INPUT_INVALID');
      const response = await fetch('http://broker.internal/r/' + keyPath(key), {headers, signal});
      if (!response.ok || !response.body) throw Error('BROKER_READ_DENIED');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > byteLength) throw Error('BROKER_INPUT_TOO_LARGE');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (size !== byteLength || sha256Bytes(bytes) !== sha256) throw Error('BROKER_INPUT_IDENTITY_MISMATCH');
      return bytes;
    },
    async write(key, bytes, mediaType) {
      const response = await fetch('http://broker.internal/w/' + keyPath(key), {method: 'PUT', signal,
        headers: {...headers, 'content-type': mediaType, 'content-length': String(bytes.byteLength)}, body: bytes});
      if (!response.ok) throw Error('BROKER_WRITE_DENIED');
      return {key, sha256: sha256Bytes(bytes), byteLength: bytes.byteLength, mediaType};
    }
  };
}
