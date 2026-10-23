export const AUDIO_VERSION: string;
export const GENERATED_LICENSE: string;
export function assertAudioPlan(plan: unknown): void;
export function deriveAudioPlan(spec: Record<string, any>, events: Array<{sceneId: string; name: string; frame: number}>, options?: {loudnessTarget?: number}): Record<string, any>;
export function audioPlanHash(plan: unknown, options: {seed: string}): string;
