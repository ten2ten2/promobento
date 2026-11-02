/** SHA-256 of the RFC 8785 canonical UTF-8 JSON representation. */
export function digest(value: unknown): string;
export function sha256Bytes(value: Uint8Array): string;
export function createSha256(): {update(bytes: Uint8Array): ReturnType<typeof createSha256>; hex(): string};
export function sha256Stream(chunks: AsyncIterable<Uint8Array>): Promise<string>;
