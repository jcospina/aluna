// Platform entrypoint — Module 1, Epic 1.2: boot the Hono server on Bun.
//
// Starts Bun's built-in HTTP server with the Hono app (src/app.ts) and logs the
// URL it is listening on. The port is configurable via the PORT environment
// variable, defaulting to 3000. Started by `bun run dev` (bun --watch).
//
// No shell markup, SSE, database, or AI yet — those build on this.

import { app } from "./app.ts";

const DEFAULT_PORT = 3030;

// PORT must be a non-negative integer; anything else (unset, empty, non-numeric)
// falls back to the default. An explicit "0" is honored — it asks the OS for an
// ephemeral port.
const rawPort = process.env.PORT;
const requestedPort = rawPort ? Number(rawPort) : Number.NaN;
const port = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : DEFAULT_PORT;

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

// Log the actual bound port (server.port), which differs from `port` when an
// ephemeral port (0) was requested.
console.log(`omni-crud listening on http://localhost:${server.port}`);
