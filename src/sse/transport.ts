// The SSE transport — the wire layer beneath every streaming route (ADR-0002).
//
// Owns the two transport-level concerns the route handlers and build pipeline
// should not have to think about: app-level monotonic event ids, and id-less
// heartbeats that keep an idle connection alive while a long-running stage is
// silent. The event *vocabulary* (`narration`, `fragment`, `done`, …) is the
// caller's concern; this layer only guarantees ordered, serialized writes and a
// keepalive cadence.

import type { SSEStreamingApi } from "hono/streaming";

/**
 * Below Bun's server idle timeout (`src/index.ts`'s `STREAM_IDLE_TIMEOUT_SECONDS`),
 * so the heartbeat fires before a silent generation stage would let the connection
 * go idle. Tests lower it to prove that keepalive.
 */
export const DEFAULT_SSE_HEARTBEAT_MS = 15_000;

/**
 * Emit one SSE event. Carries an app-level monotonic id (see {@link sseTransport}).
 *
 * @param event - The event name (the seed vocabulary: `narration`, `fragment`, `done`).
 * @param data - The event payload (already-escaped HTML, plain text, or JSON).
 */
export type Send = (event: string, data: string) => Promise<void>;

/**
 * The transport surface a streaming route is handed: the id-carrying {@link Send}
 * and the id-less {@link SseTransport.heartbeat} keepalive.
 */
export interface SseTransport {
  readonly send: Send;
  readonly heartbeat: () => Promise<void>;
}

/**
 * Wrap a Hono SSE stream with the transport guarantees: app-level monotonic ids on
 * every `send`, id-less heartbeats, and a serialized write chain so two awaited
 * writes never interleave on the wire. The chain stays usable after an aborted
 * stream — the route's main path owns the actual abort/error handling.
 */
export function sseTransport(stream: SSEStreamingApi): SseTransport {
  let id = 0;
  let writes: Promise<void> = Promise.resolve();
  const enqueue = (write: () => Promise<void>) => {
    const next = writes.then(write, write);
    writes = next.catch(() => {
      // Keep the write chain usable after an aborted stream; the route's main path
      // handles the actual abort/error state.
    });
    return next;
  };

  return {
    send: (event, data) => enqueue(() => stream.writeSSE({ id: String(id++), event, data })),
    heartbeat: () => enqueue(() => stream.writeSSE({ event: "heartbeat", data: "" })),
  };
}

/**
 * Run `body` while emitting a heartbeat every `intervalMs` for as long as it is
 * still in flight, so a stage that falls silent for whole seconds does not let Bun
 * reclaim the idle connection. A non-positive interval disables heartbeats (runs
 * `body` directly). The original completion — value or rejection — is preserved and
 * re-awaited so the caller still sees the real outcome.
 */
export async function withSseHeartbeat(
  transport: SseTransport,
  intervalMs: number,
  body: () => Promise<void>,
): Promise<void> {
  if (intervalMs <= 0) {
    await body();
    return;
  }

  let complete = false;
  const completion = body().finally(() => {
    complete = true;
  });

  while (!complete) {
    await Promise.race([
      completion.catch(() => {
        // Preserve the original rejection for the final await below.
      }),
      new Promise((resolve) => setTimeout(resolve, intervalMs)),
    ]);
    if (!complete) {
      await transport.heartbeat().catch(() => {
        // Best-effort transport keepalive; aborted streams are handled by the route.
      });
    }
  }

  await completion;
}
