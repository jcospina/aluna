// Platform entrypoint — Module 1, Epic 1.2: boot the Hono server on Bun.
//
// Starts Bun's built-in HTTP server with the Hono app (src/app.ts) and logs the
// URL it is listening on. The port is configurable via the PORT environment
// variable, defaulting to 3030. Started by `bun run dev` (bun --watch).
//
// On boot it first brings the platform-owned schema up to date by running the
// migrations runner (Epic 1.4) against the read-write connection — synchronously,
// before serving, so the db is ready the moment the first request arrives.

import { app } from "./app.ts";
import { runMigrations } from "./migrations.ts";

// Apply platform migrations before accepting traffic. Idempotent: a no-op once the
// ledger is up to date, so steady-state restarts pay nothing.
const applied = runMigrations();
if (applied.length > 0) {
  console.log(`omni-crud applied ${applied.length} migration(s): ${applied.join(", ")}`);
}

const DEFAULT_PORT = 3030;

// PORT must be a non-negative integer; anything else (unset, empty, non-numeric)
// falls back to the default. An explicit "0" is honored — it asks the OS for an
// ephemeral port.
const rawPort = process.env.PORT;
const requestedPort = rawPort ? Number(rawPort) : Number.NaN;
const port = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : DEFAULT_PORT;

// Bun severs an idle connection after `idleTimeout` seconds (default 10). The SSE
// streams here fall silent for whole seconds while the AI provider generates — a
// narration line, then quiet until the structured result lands (the spec-gen stage
// and, later, the build pipeline's longer stages) — so the default would cut a slow
// generation off mid-flight. Raised to give a generation room to finish; each stream
// still ends deterministically on the server's `done` event (ADR-0002), so this only
// bounds how long a genuinely *stalled* stream lingers before Bun reclaims it.
const STREAM_IDLE_TIMEOUT_SECONDS = 120;

const server = Bun.serve({
  port,
  idleTimeout: STREAM_IDLE_TIMEOUT_SECONDS,
  fetch: app.fetch,
});

// Log the actual bound port (server.port), which differs from `port` when an
// ephemeral port (0) was requested.
console.log(`omni-crud listening on http://localhost:${server.port}`);
