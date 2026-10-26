import {canonical, parseCanonicalJson} from './canonical.mjs';
import {digest, sha256Bytes} from './digest.mjs';
import {validate} from '../generated/film.mjs';
import {assertCustomSources} from './custom-source.mjs';

/** Canonical FilmSpec bytes, not an HTML page or a target-specific bundle. No author evaluation. */
export function filmSourceIdentity(raw, sources={}) {
  const film = parseCanonicalJson(raw);
  if (!validate(film)) throw Error('FILM_SCHEMA_INVALID');
  assertCustomSources(film,sources);
  const bytes = new TextEncoder().encode(canonical(film));
  return {identityVersion: 'film-source-v1', specVersion: 'film-v1', files: [{path: 'film.json', sha256: sha256Bytes(bytes), byteLength: bytes.length},
    ...Object.keys(sources).sort().map(path=>{const bytes=new TextEncoder().encode(sources[path]);return{path,sha256:sha256Bytes(bytes),byteLength:bytes.length};})]};
}
export const filmSourceHash = (raw,sources) => digest(filmSourceIdentity(raw,sources));
