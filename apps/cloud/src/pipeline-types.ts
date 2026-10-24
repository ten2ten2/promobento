import type {ShardDO, CoordinatorDO, OperationDO} from './compute.ts';
import type {OperationWorkflow} from './director.ts';
import type {RenderWorkflow} from './render-workflow.ts';
export type Json = Record<string, any>;
export interface PipelineEnv {
  DB: D1Database; MODEL_LEDGER:D1Database; PIPELINE_ENVIRONMENT:string; MEDIA: R2Bucket; OUTBOX: Queue; SHARDS: DurableObjectNamespace<ShardDO>;
  COORDINATOR: DurableObjectNamespace<CoordinatorDO>; OPERATIONS: DurableObjectNamespace<OperationDO>;
  RENDER_WORKFLOW: Workflow<{renderId: string}>; OPERATION_WORKFLOW: Workflow<{operationId: string}>;
  MODEL_COMPAT_API_KEY?: string; ANTHROPIC_API_KEY?: string;
  S1_ENABLED: string; EVAL_API_KEY?: string;
}
export interface Operation {id: string; workspace_id: string; project_id: string; generation: number; purpose: string; status: string; max_micros: number}
export interface BlobRef {name: string; key: string; sha256: string; byteLength: number; mediaType?: string}
export const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{4,96}$/.test(value);
