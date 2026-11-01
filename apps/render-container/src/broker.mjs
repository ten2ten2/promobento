import {createReadStream, createWriteStream, constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {Readable, Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {sha256Bytes} from '../../../packages/contracts/src/digest.mjs';

/** Token lives only in this closure, not files, URLs, child environments, or diagnostics. */
export function brokerClient(token, signal) {
  if (typeof token !== 'string' || token.length > 16384 || !token.length) throw Error('BROKER_TOKEN_REQUIRED');
  const keyPath = key => {
    if (typeof key !== 'string' || !key.length || key.length > 1024 || key.split('/').some(part => !part || part === '.' || part === '..')) throw Error('BROKER_KEY_INVALID');
    return key.split('/').map(encodeURIComponent).join('/');
  };
  const headers = {authorization: 'Bearer ' + token};
  const upload = async (key, body, byteLength, sha256, mediaType) => {
    const response = await fetch('http://broker.internal/w/' + keyPath(key), {method: 'PUT', signal, duplex: 'half',
      headers: {...headers, 'content-type': mediaType, 'content-length': String(byteLength), 'x-content-sha256': sha256}, body});
    if (!response.ok) throw Error('BROKER_WRITE_DENIED');
    return {key, sha256, byteLength, mediaType};
  };
  return {
    async readToFile({key, sha256, byteLength}, path, maxBytes = 40 << 20) {
      if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxBytes) throw Error('BROKER_INPUT_INVALID');
      const response = await fetch('http://broker.internal/r/' + keyPath(key), {headers, signal});
      if (!response.ok || !response.body) throw Error('BROKER_READ_DENIED');
      let size = 0;
      const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(response.body), new Transform({
        transform(chunk, _encoding, done) {
          size += chunk.length;
          if (size > byteLength) return done(Error('BROKER_INPUT_TOO_LARGE'));
          hash.update(chunk);
          done(null, chunk);
        },
      }), createWriteStream(path, {flags: 'wx', mode: 0o660}), {signal});
      if (size !== byteLength || hash.digest('hex') !== sha256) throw Error('BROKER_INPUT_IDENTITY_MISMATCH');
    },
    async write(key, bytes, mediaType) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 4 << 20) throw Error('BROKER_OUTPUT_INVALID');
      return upload(key, bytes, bytes.byteLength, sha256Bytes(bytes), mediaType);
    },
    async writeFile(key, path, {sha256, byteLength}, mediaType) {
      if (!/^[a-f0-9]{64}$/.test(sha256) || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > 50_000_000)
        throw Error('BROKER_OUTPUT_INVALID');
      const body = Readable.toWeb(createReadStream(path, {flags: constants.O_RDONLY | constants.O_NOFOLLOW, highWaterMark: 64 << 10}));
      return upload(key, body, byteLength, sha256, mediaType);
    }
  };
}
