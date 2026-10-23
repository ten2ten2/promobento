export function filmSourceIdentity(raw: string | Uint8Array): {identityVersion: 'film-source-v1'; specVersion: 'film-v1'; files: Array<{path: string; sha256: string; byteLength: number}>};
export function filmSourceHash(raw: string | Uint8Array): string;
