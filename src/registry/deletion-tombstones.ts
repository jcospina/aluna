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
  })
  .strict();

export type CapabilityDeletionTombstone = z.infer<typeof deletionTombstoneSchema>;

interface StoredDeletionTombstone {
  id: string;
  incarnation_id: string;
  deletion_manifest: string;
  deletion_created_at: string;
}

function tombstoneColumnsExist(database: Database): boolean {
  const columns = database.query(`PRAGMA table_info(${REGISTRY_TABLE})`).all() as {
    name: string;
  }[];
  return columns.some((column) => column.name === "lifecycle_state");
}

function parseStoredTombstone(row: StoredDeletionTombstone): CapabilityDeletionTombstone {
  return deletionTombstoneSchema.parse({
    capabilityId: row.id,
    incarnationId: row.incarnation_id,
    manifest: JSON.parse(row.deletion_manifest),
    createdAt: row.deletion_created_at,
  });
}

export function getCapabilityDeletionTombstone(
  capabilityId: string,
  database: Database,
): CapabilityDeletionTombstone | null {
  if (!tombstoneColumnsExist(database)) return null;
  const stored = database
    .query(
      `SELECT id, incarnation_id, deletion_manifest, deletion_created_at
       FROM ${REGISTRY_TABLE}
       WHERE id = ? AND lifecycle_state = ?`,
    )
    .get(capabilityId, DELETION_TOMBSTONE_STATE) as StoredDeletionTombstone | null;
  return stored ? parseStoredTombstone(stored) : null;
}

export function listCapabilityDeletionTombstones(
  database: Database,
): CapabilityDeletionTombstone[] {
  if (!tombstoneColumnsExist(database)) return [];
  const stored = database
    .query(
      `SELECT id, incarnation_id, deletion_manifest, deletion_created_at
       FROM ${REGISTRY_TABLE}
       WHERE lifecycle_state = ?
       ORDER BY id`,
    )
    .all(DELETION_TOMBSTONE_STATE) as StoredDeletionTombstone[];
  return stored.map(parseStoredTombstone);
}

export function isCapabilityIdReservedByDeletion(
  capabilityId: string,
  database: Database,
): boolean {
  if (!tombstoneColumnsExist(database)) return false;
  return (
    database
      .query(`SELECT 1 FROM ${REGISTRY_TABLE} WHERE id = ? AND lifecycle_state = ?`)
      .get(capabilityId, DELETION_TOMBSTONE_STATE) !== null
  );
}

export function insertCapabilityDeletionTombstone(
  tombstone: Omit<CapabilityDeletionTombstone, "createdAt">,
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
  if (!tombstoneColumnsExist(database)) return false;
  const result = database.run(
    `DELETE FROM ${REGISTRY_TABLE}
     WHERE id = ? AND incarnation_id = ? AND lifecycle_state = ?`,
    [expectation.capabilityId, expectation.incarnationId, DELETION_TOMBSTONE_STATE],
  );
  return result.changes === 1;
}
