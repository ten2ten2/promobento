import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {parseCanonicalJson,createSchemaValidator} from '@promobento/contracts';

const repository=fileURLToPath(new URL('../../../',import.meta.url));
const schema=parseCanonicalJson(readFileSync(join(repository,'contracts/production.schema.json')));
const validate=createSchemaValidator(schema);
const paths=Object.freeze(Object.fromEntries(['square','inplace','media'].map(name=>
  [name,'tests/fixtures/render/'+name+'.declarations.json'])));
const freeze=value=>{
  if(value&&typeof value==='object') {for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value;
};

export function fixtureDeclarationsPath(fixture) {
  if(typeof fixture!=='string'||!Object.hasOwn(paths,fixture))throw Error('RENDER_FIXTURE_UNKNOWN');
  return paths[fixture];
}

/** JSON metadata only. Never import a composition to discover its declarations.
 * The reviewed browser fixture separately checks that its exports match these bytes.
 * This is not admission for arbitrary source or a substitute for process isolation.
 */
export function parseFixtureDeclarations(bytes) {
  const declarations=parseCanonicalJson(bytes);
  if(validate(declarations,schema.$defs.runtimeDeclarations).length)throw Error('FIXTURE_DECLARATIONS_INVALID');
  return freeze(declarations);
}

export function readFixtureDeclarations(fixture) {
  return parseFixtureDeclarations(readFileSync(join(repository,fixtureDeclarationsPath(fixture))));
}
