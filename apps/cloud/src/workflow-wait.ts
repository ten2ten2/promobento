import type {WorkflowStep} from 'cloudflare:workers';

/** Only the first execution reads wall time; completed waits replay their original timeout. */
export function checkpointWaitSeconds(step: WorkflowStep, name: string, deadlineAt: number, expiredCode: string) {
  return step.do<number>(name + '-timeout', {retries: {limit: 0, delay: '1 second'}}, async () => {
    const seconds = Math.ceil((deadlineAt - Date.now()) / 1000);
    if (seconds <= 0) throw Error(expiredCode);
    return seconds;
  });
}

type DurableRenderState = {status: string | null; finishedAt: number | null; code: string | null};
const transientRead = (error: unknown) => error instanceof Error
  && /network connection lost|D1_ERROR|SQLITE_BUSY|timed? out|connection reset|service unavailable/i.test(error.message);

/** Events are wake-up hints, not completion records. A bounded heartbeat also
 * observes a durably finished render when its notification is delayed or lost. */
export async function waitForDurableRender(step: WorkflowStep, name: string, eventType: string,
  deadlineAt: number, probe: () => Promise<DurableRenderState>) {
  for (let round = 0; ; round++) {
    const state = await step.do<DurableRenderState>(`${name}-state-${round}`,
      {retries: {limit: 0, delay: '1 second'}}, async () => {
        // An unavailable D1 read is not a render failure. Persist an unknown
        // observation and try again at the next heartbeat; never replay work.
        for (let attempt = 0; attempt < 2; attempt++) {
          try {return await probe();}
          catch (error) {
            if (!transientRead(error)) throw error; // Includes OPERATION_FENCED.
          }
        }
        return {status: 'unavailable', finishedAt: null, code: null};
      });
    if (state.status === 'passed') {
      if (!Number.isSafeInteger(state.finishedAt) || state.finishedAt! > deadlineAt)
        throw Error('OPERATION_DEADLINE');
      return;
    }
    if (state.status === 'blocked' || state.status === 'cancelled')
      throw Error(state.code ?? 'NATIVE_RENDER_FAILED');
    const seconds = await checkpointWaitSeconds(step, `${name}-heartbeat-${round}`,
      Math.min(deadlineAt, Date.now() + 60_000), 'OPERATION_DEADLINE');
    try {
      await step.waitForEvent(`${name}-event-${round}`, {type: eventType, timeout: `${seconds} seconds`});
    } catch { /* Recheck D1 after timeout or transient notification failure. */ }
    // A transiently failing event API or an early/stale event must not create
    // an unbounded busy loop. This sleep is durable across Workflow replays.
    await step.sleep(`${name}-rearm-${round}`, '1 second');
  }
}
