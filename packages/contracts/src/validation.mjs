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
  const resolve = rule => rule?.$ref?.startsWith('#/$defs/') ? schema.$defs[rule.$ref.slice(8)] : rule;
  const tags = rule => {
    rule = resolve(rule);
    const own = ['kind', 'command', 'event'].flatMap(key => {
      const field = rule?.properties?.[key];
      return typeof field?.const === 'string' ? [[key, field.const]] : [];
    });
    return own.length ? own : (rule?.oneOf ?? []).flatMap(tags);
  };
  const dispatch = new Map(), untagged = [];
  for (const entry of schema.oneOf ?? []) {
    const rule = resolve(entry), labels = tags(rule);
    if (!labels.length) untagged.push(rule);
    for (const [key, value] of labels) {
      const id = key + ':' + value, candidates = dispatch.get(id) ?? new Set();
      candidates.add(rule); dispatch.set(id, candidates);
    }
  }
  return function validateSchema(value, rule = schema, at = '$') {
    try { canonical(value); } catch (error) { return [at + ': ' + error.message]; }
    if (rule === schema && dispatch.size) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [at + ': EXPECTED_PROTOCOL_OBJECT'];
      const key = ['kind', 'command', 'event'].find(name => Object.hasOwn(value, name));
      if (key) {
        const candidates = dispatch.get(key + ':' + value[key]);
        if (!candidates) return [at + '/' + key + ': UNKNOWN_DISCRIMINATOR'];
        if (candidates.size === 1) rule = [...candidates][0];
      } else if (untagged.length === 1) rule = untagged[0];
      else return [at + ': DISCRIMINATOR_REQUIRED'];
    }
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
