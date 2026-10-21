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
  // Enforce declared size ceilings before canonicalization visits array elements or strings.
  // Ajv remains the complete validator; this only follows direct properties and bounded items.
  const sizeError = (value, rule, at, depth = 0, parents = new Set()) => {
    rule = resolve(rule);
    if (!rule || typeof rule !== 'object' || depth > 64) return null;
    const object = value !== null && typeof value === 'object';
    if (object && parents.has(value)) return at + ': CYCLIC_JSON';
    if (object) parents.add(value);
    try {
      if (Array.isArray(value)) {
        if (Number.isInteger(rule.maxItems)) {
          if (value.length > rule.maxItems) return at + ': must NOT have more than ' + rule.maxItems + ' items';
          if (rule.items) for (let index = 0; index < value.length; index++) {
            const prop = Object.getOwnPropertyDescriptor(value, index);
            if (prop && Object.hasOwn(prop, 'value')) {
              const error = sizeError(prop.value, rule.items, at + '/' + index, depth + 1, parents);
              if (error) return error;
            }
          }
        }
      } else if (typeof value === 'string' && Number.isInteger(rule.maxLength)) {
        if (value.length > rule.maxLength * 2 || (value.length > rule.maxLength && [...value].length > rule.maxLength))
          return at + ': must NOT have more than ' + rule.maxLength + ' characters';
      } else if (value && typeof value === 'object') {
        if (Number.isInteger(rule.maxProperties)) {
          let count = 0;
          for (const key in value) if (Object.hasOwn(value, key) && ++count > rule.maxProperties)
            return at + ': must NOT have more than ' + rule.maxProperties + ' properties';
        }
        for (const [key, field] of Object.entries(rule.properties ?? {})) {
          const prop = Object.getOwnPropertyDescriptor(value, key);
          if (prop && Object.hasOwn(prop, 'value')) {
            const pointer = key.replace(/~/gu, '~0').replace(/\//gu, '~1');
            const error = sizeError(prop.value, field, at + '/' + pointer, depth + 1, parents);
            if (error) return error;
          }
        }
      }
      return null;
    } finally { if (object) parents.delete(value); }
  };
  return function validateSchema(value, rule = schema, at = '$') {
    if (rule === schema && dispatch.size) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [at + ': EXPECTED_PROTOCOL_OBJECT'];
      const key = ['kind', 'command', 'event'].find(name => Object.hasOwn(value, name));
      if (key) {
        const prop = Object.getOwnPropertyDescriptor(value, key);
        if (!Object.hasOwn(prop, 'value')) return [at + ': NOT_JSON'];
        if (typeof prop.value !== 'string') return [at + '/' + key + ': UNKNOWN_DISCRIMINATOR'];
        const candidates = dispatch.get(key + ':' + prop.value);
        if (!candidates) return [at + '/' + key + ': UNKNOWN_DISCRIMINATOR'];
        if (candidates.size === 1) rule = [...candidates][0];
      } else if (untagged.length === 1) rule = untagged[0];
      else return [at + ': DISCRIMINATOR_REQUIRED'];
    }
    const oversized = sizeError(value, rule, at);
    if (oversized) return [oversized];
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
