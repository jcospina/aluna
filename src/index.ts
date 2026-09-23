// Platform entrypoint: boot the Hono server on Bun.
//
// Starts Bun's built-in HTTP server with the Hono app (src/server/app.ts) and logs the
// URL it is listening on. The port and the body cap come from the environment
// (src/server/serve-options.ts). Started by `bun run dev` (bun --watch).
//
// On boot it first brings the platform-owned schema up to date by running the
// migrations runner against the read-write connection — synchronously,
// before serving, so the db is ready the moment the first request arrives.

import { DEFAULT_ARTIFACTS_ROOT, reconcileCapabilityArtifacts } from "./builder/index.ts";
import { recoverCapabilityLogos } from "./lifecycle/logo/index.ts";
import { errorDetail } from "./platform/errors.ts";
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
import { resolveServeOptions } from "./server/serve-options.ts";

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
  console.error("omni-crud could not reconcile capability logos at boot:", errorDetail(error));
}

// A malformed `OMNI_MAX_FILE_BYTES` never gets this far: importing the app resolves it and throws.
const server = Bun.serve({ ...resolveServeOptions(), fetch: app.fetch });

// Log the actual bound port (server.port), which differs from the requested one when an
// ephemeral port (0) was asked for.
console.log(`omni-crud listening on http://localhost:${server.port}`);
