export interface BlockEvent {name: string; frame: number}
export function blockEvents(id: string, frames: {start: number; end: number}, params: Record<string, unknown>): BlockEvent[];
export function filmBlockEvents(spec: {scenes: Array<{id: string; kind: string; block?: string; start: number; end: number; params: Record<string, unknown>}>}): Array<BlockEvent & {sceneId: string}>;
