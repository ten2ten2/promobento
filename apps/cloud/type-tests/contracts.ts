import {canonical, compareUtf16, parseCanonicalJson} from '@promobento/contracts/canonical';
import {assertNativeProject, nativeProjectHash} from '@promobento/contracts/native-project';

const input: unknown = parseCanonicalJson(new TextEncoder().encode('{}'));
const project = assertNativeProject(input);
const encoded: string = canonical(project);
const hash: Promise<string> = nativeProjectHash(project);
const order: -1 | 0 | 1 = compareUtf16('a', 'b');
void [encoded, hash, order];

// @ts-expect-error Incoming JSON must be text or bytes.
parseCanonicalJson({});
