import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {sha256} from './environment.mjs';

const repository=fileURLToPath(new URL('../../../',import.meta.url));
// Reviewed CC0 evidence and exact original-media scope. Changing these requires
// reviewing the dedication and source again, not recomputing an expected digest.
export const fixtureLicenseEvidence=Object.freeze({license:'CC0-1.0',evidencePath:'tests/fixtures/render/LICENSE.txt',
  evidenceSha256:'6440643fe61cf352c1583959b1472e149e0cf054fbb23299cf6d9a9716c3794a'});
const sources=Object.freeze({
  'tests/fixtures/render/audio-fixture.mjs':Object.freeze({licenseRef:'rights_m0a_procedural_audio_cc0',
    source:'original_procedural_score_and_waveforms',allowedUses:Object.freeze(['process','mix','preview','export'])}),
  'apps/renderer/src/media-assets.mjs':Object.freeze({licenseRef:'fixture-original-cc0',
    source:'original_synthetic_application_screen_frames',allowedUses:Object.freeze(['process','decode','preview','export'])})
});

export function verifyFixtureLicense({license,sourcePath,evidenceBytes}) {
  if(license!==fixtureLicenseEvidence.license)throw Error('FIXTURE_LICENSE_ID_UNVERIFIED');
  if(typeof sourcePath!=='string'||!Object.hasOwn(sources,sourcePath))throw Error('FIXTURE_LICENSE_SOURCE_UNVERIFIED');
  if(!(evidenceBytes instanceof Uint8Array)||sha256(evidenceBytes)!==fixtureLicenseEvidence.evidenceSha256)
    throw Error('FIXTURE_LICENSE_HASH_MISMATCH');
  return Object.freeze({...fixtureLicenseEvidence,...sources[sourcePath],generatorPath:sourcePath});
}

export function readFixtureLicense(sourcePath) {
  return verifyFixtureLicense({license:fixtureLicenseEvidence.license,sourcePath,
    evidenceBytes:readFileSync(join(repository,fixtureLicenseEvidence.evidencePath))});
}
