// Platform entrypoint: boot the Hono server on Bun.
//
// Starts Bun's built-in HTTP server with the Hono app (src/app/app.ts) and logs the
// URL it is listening on. The port is configurable via the PORT environment
// variable, defaulting to 3030. Started by `bun run dev` (bun --watch).
//
// On boot it first brings the platform-owned schema up to date by running the
// migrations runner against the read-write connection — synchronously,
// before serving, so the db is ready the moment the first request arrives.

import {
  app,
  platformDeletionCleanup,
  platformLogoClaims,
  platformMutationCoordinator,
  platformReadGates,
} from "./app/app.ts";
import { DEFAULT_ARTIFACTS_ROOT, reconcileCapabilityArtifacts } from "./builder/index.ts";
import { recoverCapabilityLogos } from "./lifecycle/logo/index.ts";
import { db, dbReadonly } from "./platform/persistence/db.ts";
import { runMigrations } from "./platform/persistence/migrations.ts";
import { captureProcessSecrets } from "./platform/secrets.ts";
import { listCapabilityDeletionTombstones, readActiveRegistryCatalog } from "./registry/index.ts";

// Lift the provider credentials out of `process.env` before anything else runs. Generated
// Handlers execute in this process (ADR-0004: no process sandbox), and the static
// isolation checks cannot see a property access, so an ambient `process.env` reference is
// reachable in principle. After this call it holds no key worth reaching.
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
// A logo claim interrupted by whatever ended the last process. The first desk load would
// reconcile it anyway, but between boot and that load the platform would be serving a
// lifecycle it already knows to be untrue — a row stranded in `generating`, or a `present`
// one whose drawing has gone. No provider is called and no attempt is spent here.
//
// Guarded exactly as the desk load's own pass is, and for a sharper reason: an unhandled
// rejection at module top level means `Bun.serve` below is never reached. A logo is never
// worth a platform that will not boot — this module has shipped that failure once already
// (`capability-logo/artifact-names.ts`).
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
  console.error(
    "omni-crud could not reconcile capability logos at boot:",
    error instanceof Error ? error.message : error,
  );
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
// still ends deterministically on the server's `done` event, so this only
// bounds how long a genuinely *stalled* stream lingers before Bun reclaims it.
const STREAM_IDLE_TIMEOUT_SECONDS = 120;

/**
 * The largest request body the platform accepts. Bun's default is 128MB, and every entry
 * point here materializes the whole body before validating any of it — a record submission
 * through `formData()`, a deletion or rename form, a prompt read as text and then trimmed
 * (a second copy) and scanned with a Unicode regex. None of that is bounded by anything
 * else, so a single request could make the process hold and walk hundreds of megabytes.
 *
 * 1MB is far above what this platform legitimately sends. The largest honest body is a
 * create carrying every field at its `max_length` ceiling (10,000 characters each) plus a
 * repeated list field; the largest honest prompt is a paragraph a person typed.
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
