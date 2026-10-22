// Precompiles contracts/production.schema.json into an Ajv standalone module, the way the plan
// (D12) requires for Workers, and bundles the contract examples the Worker will validate.
// Usage: node gen-validators.mjs <repo root>
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const root = process.argv[2];
const schema = JSON.parse(readFileSync(join(root, 'contracts/production.schema.json'), 'utf8'));
// Same options as packages/contracts/src/validation.mjs, plus source generation.
const ajv = new Ajv2020({strict: true, allErrors: true, ownProperties: true, coerceTypes: false, removeAdditional: false,
  useDefaults: false, code: {source: true, esm: true}});
addFormats(ajv, {mode: 'full'});
ajv.addSchema(schema);
const started = performance.now();
const code = standaloneCode(ajv, {validateProduction: schema.$id});
writeFileSync('src/validators.js', code);
const examples = {};
for (const file of readdirSync(join(root, 'contracts')).filter(name => name.endsWith('.example.json')))
  examples[file] = JSON.parse(readFileSync(join(root, 'contracts', file), 'utf8'));
writeFileSync('src/examples.json', JSON.stringify(examples));
console.log(`validators.js ${code.length} bytes in ${Math.round(performance.now() - started)} ms; ${Object.keys(examples).length} examples`);
