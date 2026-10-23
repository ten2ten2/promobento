/** RFC 8785 serialization; rejects values outside the canonical JSON data domain. */
export function canonical(value: unknown): string;
export function compareUtf16(a: string, b: string): -1 | 0 | 1;
/** Strict UTF-8/JSON parsing, including duplicate-key and Unicode checks. */
export function parseCanonicalJson(input: string | Uint8Array): unknown;
