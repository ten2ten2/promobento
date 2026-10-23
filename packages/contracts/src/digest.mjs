import { createHash } from 'node:crypto';
import { canonical } from './canonical.mjs';

/** UTF-8 canonical JSON SHA-256; Node/workerd with nodejs_compat. */
export const digest = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
/** Raw immutable resource/source/output bytes; never use the JSON-string digest for file identity. */
export const sha256Bytes = value => createHash('sha256').update(value).digest('hex');
