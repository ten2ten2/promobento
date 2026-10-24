export function assertRenderJob(job: unknown): void;
export function assertRenderTask(task: unknown): void;
export const WEBGL_BLOCKS: readonly string[];
export function filmUsesWebgl(spec:Record<string,any>):boolean;
export function renderPageTiming(spec:Record<string,any>,policy:Record<string,any>):{initTimeoutMs:number;frameTimeoutMs:number};
export function renderDeadlineMs(job:Record<string,any>,partition:{shards:Array<{start:number;end:number;instance:string}>},policy:Record<string,any>):number;
export function planShards(job: Record<string, any>, spec: Record<string, any>, options: {seed: string; maxShards?: number; webglBlocks?: string[]; webglMaxShards?: number}):
  {schemaVersion: string; kind: string; renderId: string; totalFrames: number; shards: Array<{index: number; start: number; end: number; instance: string; shardKey: string}>};
