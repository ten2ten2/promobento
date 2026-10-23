import type { ErrorObject } from 'ajv';

/** Generated, synchronous Ajv validator. Cross-field rules are checked separately. */
export interface StandaloneValidator {
  (value: unknown): boolean;
  errors?: ErrorObject[] | null;
}
export const validate: StandaloneValidator;
