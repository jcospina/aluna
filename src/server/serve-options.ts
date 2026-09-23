// What `src/index.ts` hands `Bun.serve`, resolved apart from the boot so a test can read it. A leaf
// but for the file cap, which is itself one.

import { resolveMaxFileBytes } from "../platform/files/file-cap.ts";

const DEFAULT_PORT = 3030;
const MAX_PORT = 65535;

// Bun severs an idle connection after `idleTimeout` seconds (default 10) and an SSE stream falls
// silent for whole seconds while the provider generates; a stream ends on its own `done` event.
const STREAM_IDLE_TIMEOUT_SECONDS = 120;

export interface ServeOptions {
  readonly port: number;
  readonly idleTimeout: number;
  /** The file cap: Bun refuses a larger declared body, and every writing route counts its own. */
  readonly maxRequestBodySize: number;
}

/**
 * PORT must be a whole number from 0 to 65535 in decimal digits; anything else falls back to the
 * default (Bun binds 65535 for a larger one). An explicit "0" asks the OS for an ephemeral port.
 * A malformed file cap throws.
 */
export function resolveServeOptions(env: NodeJS.ProcessEnv = process.env): ServeOptions {
  const requested = env.PORT?.trim() ?? "";
  const port = /^\d+$/.test(requested) ? Number(requested) : Number.NaN;
  return {
    port: port <= MAX_PORT ? port : DEFAULT_PORT,
    idleTimeout: STREAM_IDLE_TIMEOUT_SECONDS,
    maxRequestBodySize: resolveMaxFileBytes(env),
  };
}
