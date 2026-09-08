// Platform entrypoint: boot the Hono server on Bun.
//
// Starts Bun's built-in HTTP server with the Hono app (src/server/app.ts) and logs the
// URL it is listening on. The port is configurable via the PORT environment
// variable, defaulting to 3030. Started by `bun run dev` (bun --watch).
//
// On boot it first brings the platform-owned schema up to date by running the
// migrations runner against the read-write connection — synchronously,
// before serving, so the db is ready the moment the first request arrives.

import { DEFAULT_ARTIFACTS_ROOT, reconcileCapabilityArtifacts } from "./builder/index.ts";
import { recoverCapabilityLogos } from "./lifecycle/logo/index.ts";
import { db, dbReadonly } from "./platform/persistence/db.ts";
import { runMigrations } from "./platform/persistence/migrations.ts";
import { captureProcessSecrets } from "./platform/secrets.ts";
import { listCapabilityDeletionTombstones, readActiveRegistryCatalog } from "./registry/index.ts";
import {
  app,
  platformDeletionCleanup,
  platformLogoClaims,
  platformMutationCoordinator,
  platformReadGates,
} from "./server/app.ts";

// Generated Handlers execute in this process (ADR-0004: no process sandbox) and the static
// isolation checks cannot see a property access, so `process.env` is reachable in principle.
captureProcessSecrets();

// Apply platform migrations before accepting traffic. Idempotent: a no-op once the
// ledger is up to date, so steady-state restarts pay nothing.
const applied = runMigrations();
if (applied.length > 0) {
  console.log(`omni-crud applied ${applied.length} migration(s): ${applied.join(", ")}`);
}
// Discharge anything a previous process left owed, then hand the rest to the supervisor
// so a failure retries here rather than waiting for the next restart.
const deletionRecovery = await platformDeletionCleanup.runOnce();
for (const result of deletionRecovery) {
  if (result.status === "deleted") {
    console.log(
      `omni-crud completed pending deletion cleanup for ${result.tombstone.capabilityId}`,
    );
  } else {
    console.error(
      `omni-crud could not complete pending deletion cleanup for ${result.tombstone.capabilityId}:`,
      result.error instanceof Error ? result.error.message : result.error,
    );
  }
}
platformDeletionCleanup.requestRetry();
platformReadGates.recoverAtBoot(
  readActiveRegistryCatalog(dbReadonly).capabilities.map((row) => ({
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
  })),
);
const reconciliation = reconcileCapabilityArtifacts({
  database: db,
  artifactsRoot: DEFAULT_ARTIFACTS_ROOT,
  tombstonedIncarnations: listCapabilityDeletionTombstones(dbReadonly).map((tombstone) => ({
    capabilityId: tombstone.capabilityId,
    incarnationId: tombstone.incarnationId,
  })),
});
if (reconciliation.removed.length > 0) {
  console.log(
    `omni-crud reconciled ${reconciliation.removed.length} never-activated artifact candidate(s)`,
  );
}
// A logo claim interrupted by whatever ended the last process: a row stranded in `generating`,
// or a `present` one whose drawing has gone. No provider is called and no attempt is spent.
try {
  const logoRecovery = await recoverCapabilityLogos({
    databases: { readwrite: db, readonly: dbReadonly },
    mutationCoordinator: platformMutationCoordinator,
    readGates: platformReadGates,
    artifactsRoot: DEFAULT_ARTIFACTS_ROOT,
    claims: platformLogoClaims,
  });
  for (const entry of logoRecovery) {
    console.log(
      `omni-crud recovered the logo for ${entry.capabilityId}/${entry.incarnationId}: ${entry.action}` +
        (entry.removedTemps > 0 ? ` (removed ${entry.removedTemps} stale attempt temp(s))` : ""),
    );
  }
} catch (error) {
  // An unhandled rejection at module top level means `Bun.serve` below is never reached, and
  // this module has shipped that failure once (`lifecycle/logo/artifact-names.ts`).
  console.error(
    "omni-crud could not reconcile capability logos at boot:",
    error instanceof Error ? error.message : error,
  );
}

const DEFAULT_PORT = 3030;

// PORT must be a non-negative integer; anything else falls back to the default. An explicit
// "0" is honored — it asks the OS for an ephemeral port.
const rawPort = process.env.PORT;
const requestedPort = rawPort ? Number(rawPort) : Number.NaN;
const port = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : DEFAULT_PORT;

// Bun severs an idle connection after `idleTimeout` seconds (default 10) and an SSE stream falls
// silent for whole seconds while the provider generates; a stream ends on its own `done` event.
const STREAM_IDLE_TIMEOUT_SECONDS = 120;

/**
 * Bun's default is 128MB and every entry point here materializes the whole body before
 * validating it. 1MB clears the largest honest body: every field at its 10,000-char ceiling.
 */
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

const server = Bun.serve({
  port,
  idleTimeout: STREAM_IDLE_TIMEOUT_SECONDS,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  fetch: app.fetch,
});

// Log the actual bound port (server.port), which differs from `port` when an
// ephemeral port (0) was requested.
console.log(`omni-crud listening on http://localhost:${server.port}`);
