// The core-owned half of the Event Log payload-cleanup seam (PLAN decision 35,
// ADR-0006 "Dependency-safe permanent deletion", ARCH §6.3).
//
// Deletion's one SQLite transaction has to purge capability-owned Event Log payloads
// at the same instant the registry row becomes a tombstone and the data table
// disappears. That purge is *core-owned SQL over a fixed store* — not an adapter
// callback — because a callback would put arbitrary generated or module code inside
// deletion's point-of-no-return transaction.
//
// Module 7 installs the store for real. Until then the operation is conditional on the
// store being present: a platform without an installed Event Log purges nothing and
// reports zeroes, while the M7 seam fake (`seam-fakes/event-log.ts`) installs exactly
// this fixed shape so the purge is proven now rather than assumed later.
//
// Purging redacts rather than deletes. ARCH §6.3 keeps "a content-free deletion fact"
// available: the event row survives with its identity and timestamp, its payload is
// irreversibly replaced, and its ownership rows for the deleted pair are released so a
// later incarnation can never be joined back to purged content.

import type { Database } from "bun:sqlite";

/** The fixed installed Event Log store M7 will own; the M4 seam fake installs the same shape. */
export const EVENT_LOG_TABLE = "event_log";
export const EVENT_LOG_OWNERSHIP_TABLE = "event_log_ownership";

/** What an irreversibly redacted payload becomes. Content-free, never re-derivable. */
export const REDACTED_EVENT_PAYLOAD = "";

export interface InstalledPayloadPurgeResult {
  /** Event rows whose payload was irreversibly redacted. */
  readonly redactedEvents: number;
  /** Ownership rows released, so the purged pair can never be joined back. */
  readonly releasedOwnership: number;
}

export const NO_INSTALLED_PAYLOADS: InstalledPayloadPurgeResult = Object.freeze({
  redactedEvents: 0,
  releasedOwnership: 0,
});

function tablePresent(database: Database, name: string): boolean {
  return (
    database.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    null
  );
}

/** Whether the fixed Event Log store is installed on this database. */
export function isInstalledEventLogPresent(database: Database): boolean {
  return (
    tablePresent(database, EVENT_LOG_TABLE) && tablePresent(database, EVENT_LOG_OWNERSHIP_TABLE)
  );
}

/**
 * Purge one exact capability incarnation's Event Log payloads. Called inside deletion's
 * single transaction, so it commits or rolls back with the tombstone and the table drop.
 */
export function purgeInstalledCapabilityPayloads(
  target: { readonly id: string; readonly incarnation_id: string },
  database: Database,
): InstalledPayloadPurgeResult {
  if (!isInstalledEventLogPresent(database)) return NO_INSTALLED_PAYLOADS;

  const redaction = database.run(
    `UPDATE ${EVENT_LOG_TABLE}
        SET payload = ?, redacted = 1
      WHERE redacted = 0
        AND id IN (
          SELECT event_id FROM ${EVENT_LOG_OWNERSHIP_TABLE}
           WHERE capability_id = ? AND incarnation_id = ?
        )`,
    [REDACTED_EVENT_PAYLOAD, target.id, target.incarnation_id],
  );
  const release = database.run(
    `DELETE FROM ${EVENT_LOG_OWNERSHIP_TABLE} WHERE capability_id = ? AND incarnation_id = ?`,
    [target.id, target.incarnation_id],
  );

  return { redactedEvents: redaction.changes, releasedOwnership: release.changes };
}
