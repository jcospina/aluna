import type { Database } from "bun:sqlite";
import { z } from "zod";

const REGISTRY_TABLE = "capability_registry";
export const DELETION_TOMBSTONE_STATE = "deletion_tombstone";

const ownedResourceEntrySchema = z
  .object({
    adapter: z.string().trim().min(1),
    key: z.string().trim().min(1),
    capabilityId: z.string().trim().min(1),
    incarnationId: z.string().trim().min(1),
  })
  .strict();

export type OwnedResourceEntry = z.infer<typeof ownedResourceEntrySchema>;

const deletionTombstoneSchema = z
  .object({
    capabilityId: z.string().trim().min(1),
    incarnationId: z.string().trim().min(1),
    manifest: z.array(ownedResourceEntrySchema),
    createdAt: z.string().trim().min(1),
    /** How many times post-commit cleanup has failed for this tombstone. */
    cleanupAttempts: z.number().int().min(0),
    /** The most recent failure, kept so a wedged deletion can be seen, not guessed at. */
    cleanupError: z.string().nullable(),
  })
  .strict();

export type CapabilityDeletionTombstone = z.infer<typeof deletionTombstoneSchema>;

interface StoredDeletionTombstone {
  id: string;
  incarnation_id: string;
  deletion_manifest: string;
  deletion_created_at: string;
  deletion_cleanup_attempts: number;
  deletion_cleanup_error: string | null;
}

const TOMBSTONE_COLUMNS =
  "id, incarnation_id, deletion_manifest, deletion_created_at, deletion_cleanup_attempts, deletion_cleanup_error";

// No schema probing here. `lifecycle_state` arrives with the registry table itself
// (platform migration 0010), and every active-row read in `store.ts` already filters on
// it unconditionally — so a registry without the column cannot serve any request at all,
// and guarding these four functions for it would only hide that.

function parseStoredTombstone(row: StoredDeletionTombstone): CapabilityDeletionTombstone {
  return deletionTombstoneSchema.parse({
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    manifest: JSON.parse(row.deletion_manifest),
    createdAt: row.deletion_created_at,
    cleanupAttempts: row.deletion_cleanup_attempts,
    cleanupError: row.deletion_cleanup_error,
  });
}

export function getCapabilityDeletionTombstone(
  capabilityId: string,
  database: Database,
): CapabilityDeletionTombstone | null {
  const stored = database
    .query(
      `SELECT ${TOMBSTONE_COLUMNS}
       FROM ${REGISTRY_TABLE}
       WHERE id = ? AND lifecycle_state = ?`,
    )
    .get(capabilityId, DELETION_TOMBSTONE_STATE) as StoredDeletionTombstone | null;
  return stored ? parseStoredTombstone(stored) : null;
}

export function listCapabilityDeletionTombstones(
  database: Database,
): CapabilityDeletionTombstone[] {
  const stored = database
    .query(
      `SELECT ${TOMBSTONE_COLUMNS}
       FROM ${REGISTRY_TABLE}
       WHERE lifecycle_state = ?
       ORDER BY id`,
    )
    .all(DELETION_TOMBSTONE_STATE) as StoredDeletionTombstone[];
  return stored.map(parseStoredTombstone);
}

/**
 * A build that reached a capability id a tombstone still reserves.
 *
 * Raised as early as the id is known rather than at the activation CAS. The lease-head
 * check can only test an id the *resolver* named, which it does not for an ordinary "build
 * me a notes app" — so a rebuild of a capability whose deletion cleanup is wedged used to
 * generate its spec, its six units, run the whole Gate and publish its artifacts, and only
 * then be refused by the CAS. Every time, for as long as the tombstone stood.
 */
export class CapabilityIdReservedError extends Error {
  override readonly name = "CapabilityIdReservedError";
  readonly capabilityId: string;

  constructor(capabilityId: string) {
    super(`Capability id "${capabilityId}" is reserved by a deletion whose cleanup is owed.`);
    this.capabilityId = capabilityId;
  }
}

export function isCapabilityIdReservedByDeletion(
  capabilityId: string,
  database: Database,
): boolean {
  return (
    database
      .query(`SELECT 1 FROM ${REGISTRY_TABLE} WHERE id = ? AND lifecycle_state = ?`)
      .get(capabilityId, DELETION_TOMBSTONE_STATE) !== null
  );
}

export function insertCapabilityDeletionTombstone(
  tombstone: Pick<CapabilityDeletionTombstone, "capabilityId" | "incarnationId" | "manifest">,
  database: Database,
): void {
  const manifest = tombstone.manifest.map((entry) => ownedResourceEntrySchema.parse(entry));
  const result = database.run(
    `UPDATE ${REGISTRY_TABLE}
     SET lifecycle_state = ?, deletion_manifest = ?, deletion_created_at = datetime('now')
     WHERE id = ? AND incarnation_id = ? AND lifecycle_state = 'active'`,
    [
      DELETION_TOMBSTONE_STATE,
      JSON.stringify(manifest),
      tombstone.capabilityId,
      tombstone.incarnationId,
    ],
  );
  if (result.changes !== 1) {
    throw new Error("Capability changed before its deletion tombstone could commit.");
  }
}

export function removeCapabilityDeletionTombstone(
  expectation: Pick<CapabilityDeletionTombstone, "capabilityId" | "incarnationId">,
  database: Database,
): boolean {
  const result = database.run(
    `DELETE FROM ${REGISTRY_TABLE}
     WHERE id = ? AND incarnation_id = ? AND lifecycle_state = ?`,
    [expectation.capabilityId, expectation.incarnationId, DELETION_TOMBSTONE_STATE],
  );
  return result.changes === 1;
}

/**
 * Record that post-commit cleanup failed again. The tombstone itself is the durable
 * record, so the reason a capability id is still reserved survives the process that
 * discovered it — an operator can see a wedge instead of inferring one.
 */
export function recordCapabilityDeletionCleanupFailure(
  expectation: Pick<CapabilityDeletionTombstone, "capabilityId" | "incarnationId">,
  error: unknown,
  database: Database,
): void {
  const message = error instanceof Error ? error.message : String(error);
  database.run(
    `UPDATE ${REGISTRY_TABLE}
        SET deletion_cleanup_attempts = deletion_cleanup_attempts + 1,
            deletion_cleanup_error = ?
      WHERE id = ? AND incarnation_id = ? AND lifecycle_state = ?`,
    [
      message.slice(0, 500),
      expectation.capabilityId,
      expectation.incarnationId,
      DELETION_TOMBSTONE_STATE,
    ],
  );
}
