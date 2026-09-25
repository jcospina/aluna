// The ways a test waits: on the clock, on a condition, and on a spawned process's log.
//
// `waitForLog` reads the stream rather than sleeping, because a sleep is either slower than the
// boot or shorter than it. Its reader lock is released in a `finally`: without that a timeout
// leaves the stream locked and the shard hangs on the failure it was meant to report.

/** Sleep, for a test that has nothing better to wait on. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves once `condition` holds, polling; rejects after `timeoutMs` of wall-clock time. */
export async function until(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("the awaited condition never held");
    await wait(1);
  }
}

/** Reads a piped stream until `needle` appears, or rejects once `timeoutMs` elapses. */
export async function waitForLog(
  stream: ReadableStream<Uint8Array>,
  needle: string,
  timeoutMs: number,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let seen = "";

  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`timed out waiting for "${needle}"`)), timeoutMs),
  );

  const scan = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error(`stream ended before "${needle}" appeared`);
      seen += decoder.decode(value, { stream: true });
      if (seen.includes(needle)) return;
    }
  })();

  try {
    await Promise.race([scan, deadline]);
  } finally {
    reader.releaseLock();
  }
}
