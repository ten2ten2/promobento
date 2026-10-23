import {canonical, parseCanonicalJson} from './canonical.mjs';
import {digest, sha256Bytes} from './digest.mjs';
import {validate} from '../generated/film.mjs';

/** Canonical FilmSpec bytes, not an HTML page or a target-specific bundle. No author evaluation. */
export function filmSourceIdentity(raw) {
  const film = parseCanonicalJson(raw);
  if (!validate(film)) throw Error('FILM_SCHEMA_INVALID');
  if (film.scenes.some(scene => scene.kind !== 'block')) throw Error('CUSTOM_SCENES_NOT_IMPLEMENTED');
  const bytes = new TextEncoder().encode(canonical(film));
  return {identityVersion: 'film-source-v1', specVersion: 'film-v1', files: [{path: 'film.json', sha256: sha256Bytes(bytes), byteLength: bytes.length}]};
}
export const filmSourceHash = raw => digest(filmSourceIdentity(raw));
