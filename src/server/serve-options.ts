// What `src/index.ts` hands `Bun.serve`, resolved apart from the boot so a test can read it. A leaf
// but for the file cap and the number parse, which are themselves leaves.

import { resolveMaxFileBytes } from "../platform/files/file-cap.ts";
import { parseWholeNumber } from "../platform/whole-number.ts";

/** Loopback only: the platform runs locally for one person, and no other machine may write to it. */
const LOOPBACK_HOSTNAME = "127.0.0.1";

const DEFAULT_PORT = 3030;
const MAX_PORT = 65535;

// Bun severs an idle connection after `idleTimeout` seconds (default 10) and an SSE stream falls
// silent for whole seconds while the provider generates; a stream ends on its own `done` event.
const STREAM_IDLE_TIMEOUT_SECONDS = 120;

export interface ServeOptions {
  readonly hostname: string;
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
  const port = parseWholeNumber(requested);
  return {
    hostname: LOOPBACK_HOSTNAME,
    port: port <= MAX_PORT ? port : DEFAULT_PORT,
    idleTimeout: STREAM_IDLE_TIMEOUT_SECONDS,
    maxRequestBodySize: resolveMaxFileBytes(env),
  };
}
