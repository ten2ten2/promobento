import {readFileSync, writeFileSync, mkdirSync, copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {parseCanonicalJson, canonical} from '../packages/contracts/src/canonical.mjs';
import {sha256Bytes} from '../packages/contracts/src/digest.mjs';

const destination = process.argv[2];
if (!destination) throw Error('FONT_OUTPUT_DIRECTORY_REQUIRED');
mkdirSync(destination, {recursive: true});
const registry = parseCanonicalJson(readFileSync('packages/fonts/huashu/registry.json'));
const fonts = registry.fonts.map(face => {
  // Original licence and source bytes are checked before conversion, including preview-only faces.
  for (const [path, expected] of [[face.licensePath, face.licenseSha256], [face.sourcePath, face.sha256]])
    if (sha256Bytes(readFileSync(path)) !== expected) throw Error('FONT_SOURCE_OR_LICENSE_MISMATCH:' + face.fontId);
  return {...face, input: face.sourcePath};
});
for (const [fontId, weight] of [['geist-sans', 600], ['geist-mono', 400]]) {
  const path = `packages/fonts/geist/${fontId}-latin-${weight}-normal.woff.base64`;
  const input = join(destination, fontId + '.woff');
  writeFileSync(input, Buffer.from(readFileSync(path, 'utf8').replace(/\s/g, ''), 'base64'));
  const licensePath = `packages/fonts/geist/${fontId}-OFL.txt`;
  if (!readFileSync(licensePath, 'utf8').includes('SIL OPEN FONT LICENSE')) throw Error('FONT_LICENSE_MISSING');
  fonts.push({fontId, weight, style: 'normal', licenseRef: 'geist-ofl-1.1', licensePath, input,
    sha256: sha256Bytes(readFileSync(input))});
}
const prepared = parseCanonicalJson(execFileSync('python3', ['-c', `
import sys,json,os
from fontTools.ttLib import TTFont
faces=json.load(sys.stdin)
for face in faces:
    font=TTFont(face['input'],recalcTimestamp=False)
    face['codePoints']=sorted(font.getBestCmap().keys())
    face['file']=face['fontId']+'-'+str(face['weight'])+'-'+face['style']+'.woff2'
    font.flavor='woff2'
    font.save(os.path.join(sys.argv[1],face['file']))
json.dump(faces,sys.stdout)
`, destination], {input: canonical(fonts), maxBuffer: 16 << 20}));
for (const face of prepared) {
  face.woff2Sha256 = sha256Bytes(readFileSync(join(destination, face.file)));
  copyFileSync(face.licensePath, join(destination, face.fontId + '-LICENSE.txt'));
}
writeFileSync(join(destination, 'catalog.json'), canonical({version: 'render-fonts-v1', fonts: prepared}));
// Stable alias retained for the existing engineering fixture.
copyFileSync(join(destination, 'geist-sans-600-normal.woff2'), join(destination, 'geist-sans-600.woff2'));
