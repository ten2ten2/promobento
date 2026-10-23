export const STEP_REQUIREMENTS: Readonly<Record<string, string[]>>;
export function modelConfigErrors(providers: Record<string, any>, authorization: Record<string, any>, policy: Record<string, any>, options?: {requireVerified?: boolean}): string[];
export function modelCallCostMicros(ref: string, usage: Record<string, any> | null, providers: Record<string, any>, options?: {maxOutputTokens?: number}): {usdMicros: number; catalogVersion: string; currency: string; estimated: boolean};
