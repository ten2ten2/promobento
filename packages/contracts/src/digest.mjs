import { createHash } from 'node:crypto';
import { canonical } from './canonical.mjs';

/** UTF-8 canonical JSON SHA-256; Node/workerd with nodejs_compat. */
export const digest = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
/** Raw immutable resource/source/output bytes; never use the JSON-string digest for file identity. */
export const sha256Bytes = value => createSha256().update(value).hex();
/** Single incremental SHA-256 authority for files and streams across Worker and container. */
export function createSha256() {
  const hash = createHash('sha256');
  return {
    update(bytes) {hash.update(bytes); return this;},
    hex() {return hash.digest('hex');},
  };
}
/** Incremental byte identity when the source is a backpressured stream. */
export async function sha256Stream(chunks) {
  const hash = createSha256();
  for await (const chunk of chunks) hash.update(chunk);
  return hash.hex();
}
