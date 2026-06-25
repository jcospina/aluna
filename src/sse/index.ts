// The SSE transport subsystem — the wire layer for every streaming route (ADR-0002).
//
// The single public entry point: the {@link Send} primitive callers stream events
// through, the {@link SseTransport} a route is handed, and the helpers that wrap a
// Hono SSE stream with monotonic ids and idle-keeping heartbeats.

export {
  DEFAULT_SSE_HEARTBEAT_MS,
  type Send,
  type SseTransport,
  sseTransport,
  withSseHeartbeat,
} from "./transport.ts";
