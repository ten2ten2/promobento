export interface Provider {kind: 'anthropic' | 'openai-compatible'; baseUrl: string}
export interface ModelRequest {
  provider: Provider; model: string; system: string; messages: Array<{role: 'user' | 'assistant'; text: string; images?: Array<{mediaType: string; base64: string}>}>;
  schema?: Record<string, unknown>; tools?: Array<{name: string; description: string; parameters: Record<string, unknown>}>;
  effort: string; maxOutputTokens: number;
}
export function providerRequest(input: ModelRequest): {path: string; body: Record<string, unknown>};
export function streamModel(input: ModelRequest & {secret: string}, options?: {fetchImpl?: typeof fetch; timeoutMs?: number; onText?: (delta: string) => void}):
  Promise<{text: string; toolCalls: Array<{id: string; name: string; arguments: string; input: unknown}>; usage: Record<string, any> | null; firstTokenMs: number | null; totalMs: number}>;
