import { canonical, compareUtf16, parseCanonicalJson } from '@promobento/contracts/canonical';
import { validate } from '@promobento/contracts/validators/film';

const input: unknown = parseCanonicalJson(new TextEncoder().encode('{}'));
const valid: boolean = validate(input);
const path: string | undefined = validate.errors?.[0]?.instancePath;
const encoded: string = canonical(input);
const order: -1 | 0 | 1 = compareUtf16('a', 'b');
void [valid, path, encoded, order];

// @ts-expect-error Raw JSON inputs must be text or UTF-8 bytes, not already-parsed objects.
parseCanonicalJson({});

// @ts-expect-error Unknown Schema names must fail type checking as well as module resolution.
import { validate as unknownSchema } from '@promobento/contracts/validators/not-a-schema';
void unknownSchema;
