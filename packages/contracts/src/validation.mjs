import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { canonical } from './canonical.mjs';

/** Compile every definition once. Structural checks never coerce, strip or default input. */
export function createSchemaValidator(schema) {
  if (!schema?.$id) throw new TypeError('SCHEMA_ID_REQUIRED');
  const ajv = new Ajv2020({
    strict: true, allErrors: true, ownProperties: true,
    coerceTypes: false, removeAdditional: false, useDefaults: false
  });
  addFormats(ajv, { mode: 'full' });
  ajv.addSchema(schema);
  const validators = new Map([[schema, ajv.getSchema(schema.$id)]]);
  for (const [name, definition] of Object.entries(schema.$defs ?? {})) {
    const pointer = name.replace(/~/gu, '~0').replace(/\//gu, '~1');
    validators.set(definition, ajv.getSchema(schema.$id + '#/$defs/' + pointer));
  }
  return function validateSchema(value, rule = schema, at = '$') {
    try { canonical(value); } catch (error) { return [at + ': ' + error.message]; }
    let validate = validators.get(rule);
    if (!validate) {
      validate = ajv.compile(typeof rule === 'boolean' ? rule : {
        $schema: schema.$schema, $defs: schema.$defs, ...rule
      });
      validators.set(rule, validate);
    }
    return validate(value) ? [] : validate.errors.map(error => at + error.instancePath + ': ' + error.message);
  };
}
