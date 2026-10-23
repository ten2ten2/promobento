#!/usr/bin/env node
// Precompiles the v3 contract Schemas into standalone validator modules. Workers forbid runtime code
// generation (new Function), so code that runs there imports these instead of compiling with Ajv.
// Output: packages/contracts/generated/<name>.mjs (gitignored; rebuilt by this script).
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standaloneCode from 'ajv/dist/standalone/index.js';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const VALIDATOR_SCHEMAS = Object.freeze(['film', 'block', 'render-job', 'frame-observation', 'direction', 'audio-plan',
  'asset-insight', 'agent-tools', 'model-config', 'production']);

/** Standalone ESM for one Schema, with Ajv's runtime require() calls turned into imports. */
export function standaloneModule(schema) {
  // Same options as packages/contracts/src/validation.mjs, plus source generation.
  const ajv = new Ajv2020({strict: true, allErrors: true, ownProperties: true, coerceTypes: false, removeAdditional: false,
    useDefaults: false, code: {source: true, esm: true}});
  addFormats(ajv, {mode: 'full'});
  ajv.addSchema(schema);
  const imports = new Map();
  const code = standaloneCode(ajv, {validate: schema.$id}).replace(/require\("([^"]+)"\)/g, (_, specifier) => {
    if (!imports.has(specifier)) imports.set(specifier, `__runtime${imports.size}`);
    return imports.get(specifier);
  });
  const header = [...imports].map(([specifier, name]) => `import ${name} from ${JSON.stringify(specifier.endsWith('.js') ? specifier : specifier + '.js')};`).join('\n');
  if (/new Function|\beval\(/.test(code)) throw Error('Standalone validator contains runtime code generation');
  return (header ? header + '\n' : '') + code;
}

export function buildValidators(outDir = join(root, 'packages/contracts/generated')) {
  mkdirSync(outDir, {recursive: true});
  const written = [];
  for (const name of VALIDATOR_SCHEMAS) {
    const schema = JSON.parse(readFileSync(join(root, 'contracts', `${name}.schema.json`), 'utf8'));
    const file = join(outDir, `${name}.mjs`);
    writeFileSync(file, standaloneModule(schema));
    written.push(file);
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = buildValidators(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`Built ${files.length} standalone validators.`);
}
