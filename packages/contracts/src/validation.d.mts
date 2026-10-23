export function createSchemaValidator(schema: Record<string, unknown>):
  (value: unknown, rule?: Record<string, unknown> | boolean, at?: string) => string[];
