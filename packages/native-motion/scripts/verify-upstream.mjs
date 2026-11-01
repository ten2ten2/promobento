import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {canonical, parseCanonicalJson} from '../../contracts/src/canonical.mjs';

const lock = parseCanonicalJson(readFileSync(new URL('../upstream.lock.json', import.meta.url)));
const root = resolve(process.argv[2] || '/opt/huashu-motion');
const expected = new Map(lock.files.map(file => [file.path, file]));
const actual = [];
function walk(directory, prefix = '') {
  for (const name of readdirSync(directory)) {
    const path = prefix + name, full = join(directory, name), stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw Error('UPSTREAM_SYMLINK: ' + path);
    if (stat.isDirectory()) walk(full, path + '/');
    else if (stat.isFile()) actual.push(path);
    else throw Error('UPSTREAM_SPECIAL_FILE: ' + path);
  }
}
walk(root);
if (actual.length !== expected.size) throw Error('UPSTREAM_FILE_COUNT_MISMATCH');
for (const path of actual) {
  const file = expected.get(path), bytes = readFileSync(join(root, path));
  const sha = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  if (!file || bytes.length !== file.size || sha !== file.sha) throw Error('UPSTREAM_BLOB_MISMATCH: ' + path);
}
const version = parseCanonicalJson(readFileSync(join(root, 'package.json'))).version;
if (version !== lock.version) throw Error('UPSTREAM_VERSION_MISMATCH');
writeFileSync(join(root, '.promobento-source.json'), canonical({repository: lock.repository, commit: lock.commit, tree: lock.tree, version, files: actual.length}) + '\n');
console.log(`Verified ${actual.length} complete upstream files at ${lock.commit}`);
