/** Initial internal-evaluation capacity ceilings; not measured production promises. */
export const nativeRenderPolicy = {
  instance: 'standard-3', globalInstances: 4, workspaceInstances: 1,
  previewDeadlineMs: 180000, exportDeadlineMs: 600000,
  queueWaitMs: 15 * 60_000, previewOperationMs: 30 * 60_000, exportOperationMs: 45 * 60_000,
  containerStartupMs: 45000, maxAttempts: 2,
} as const;
