import type {WorkflowStep} from 'cloudflare:workers';

/** Only the first execution reads wall time; completed waits replay their original timeout. */
export function checkpointWaitSeconds(step: WorkflowStep, name: string, deadlineAt: number, expiredCode: string) {
  return step.do<number>(name + '-timeout', {retries: {limit: 0, delay: '1 second'}}, async () => {
    const seconds = Math.ceil((deadlineAt - Date.now()) / 1000);
    if (seconds <= 0) throw Error(expiredCode);
    return seconds;
  });
}
