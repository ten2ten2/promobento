/** A stalled remote RPC must not monopolize a Queue batch or a scheduled recovery lane. */
export async function boundedControl<T>(request: Promise<T>, timeoutMs = 7_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error('CONTROL_RPC_TIMEOUT')), timeoutMs);
    })]);
  } finally {if (timer !== undefined) clearTimeout(timer);}
}

/** Bounded parallelism and per-item outcomes keep failures independent and memory predictable. */
export async function settledPool<T, R>(items: readonly T[], concurrency: number,
  run: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, async () => {
    while (next < items.length) {
      const index = next++;
      try {results[index] = {status: 'fulfilled', value: await run(items[index]!)};}
      catch (reason) {results[index] = {status: 'rejected', reason};}
    }
  }));
  return results;
}

export async function processQueueMessages<T>(messages: readonly (T & {ack(): void; retry(): void})[],
  dispatch: (message: T) => Promise<void>, timeoutMs = 15_000) {
  await settledPool(messages, 5, async message => {
    try {await boundedControl(dispatch(message), timeoutMs); message.ack();}
    catch {message.retry();}
  });
}
