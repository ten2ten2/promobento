export function assertRenderJob(job: unknown): void;
export function assertRenderTask(task: unknown): void;
export function planShards(job: Record<string, any>, spec: Record<string, any>, options: {seed: string; maxShards?: number; webglBlocks?: string[]; webglMaxShards?: number}):
  {schemaVersion: string; kind: string; renderId: string; totalFrames: number; shards: Array<{index: number; start: number; end: number; instance: string; shardKey: string}>};
