import {nativeProjectHash} from '@promobento/contracts/native-project';
import {NATIVE_COMMIT, validateFrameTimes, assertCloudNativeProject} from './native-project.ts';
import {validId, type Json} from './pipeline-types.ts';
import {nativeRenderPolicy} from './native-policy.ts';

export async function assertNativeExecution(task: Json) {
  if (task.schemaVersion !== '1.0.0' || task.kind !== 'native_render_task'
    || !validId(task.taskId) || !validId(task.renderId) || !validId(task.operationId)
    || !validId(task.rendererRelease) || task.runtimeVersion !== NATIVE_COMMIT
    || !Number.isSafeInteger(task.generation) || task.generation < 0
    || !Number.isSafeInteger(task.deadlineAt) || task.deadlineAt <= 0
    || typeof task.leaseToken !== 'string' || !/^[a-f0-9-]{36}$/.test(task.leaseToken)
    || task.instance !== nativeRenderPolicy.instance || !/^sha256:[a-f0-9]{64}$/.test(task.imageDigest))
    throw Error('NATIVE_TASK_INVALID');
  assertCloudNativeProject(task.project);
  if (await nativeProjectHash(task.project) !== task.revisionId) throw Error('SOURCE_IDENTITY_MISMATCH');
  validateFrameTimes(task.project, task.mode, task.frames);
  return task;
}

/** Only this transport crosses into the container. Business secrets and database handles stay outside. */
export function nativeContainerInput(task: Json, brokerToken: string) {
  return {taskId: task.taskId, renderId: task.renderId, mode: task.mode,
    project: task.project, ...(task.frames ? {frames: task.frames} : {}), brokerToken};
}
