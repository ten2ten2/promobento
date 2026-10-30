export const AUDIO_VERSION: string;
export const GENERATED_LICENSE: string;
export function assertAudioPlan(plan: unknown): void;
export interface ExternalMusic {kind:'score'|'upload';resourceId:string;sha256:string;licenseRef:string;scoreRef?:string}
export function deriveAudioPlan(spec: Record<string, any>, events: Array<{sceneId: string; name: string; frame: number}>, options?: {loudnessTarget?: number;externalMusic?:ExternalMusic;sourceSfx?:Array<{sceneId:string;id:string;frame:number;gainDb:number}>}): Record<string, any>;
export function audioPlanHash(plan: unknown, options: {seed: string}): string;
