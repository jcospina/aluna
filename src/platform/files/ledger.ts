// The file ledger (ADR-0009; Module 7 PLAN decisions 21 and 22): the one place ownership of a file
// is asserted. One row per admitted key. Only the platform writes it, and a capability's column is
// built from its row at the save, so nothing the browser posts reaches that column.
//
// A leaf over the database handle it is given: it opens no connection, so the migration that
// creates the table and the save that promotes a row can both name it.

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { FILE_LEDGER_TABLE } from "../persistence/table-names.ts";

export { FILE_LEDGER_TABLE } from "../persistence/table-names.ts";

export const FILE_LEDGER_STATES = ["pending", "owned", "cleanup_enqueued"] as const;
export type FileLedgerState = (typeof FILE_LEDGER_STATES)[number];

/** One admitted key and what admission verified about its bytes. */
export interface FileLedgerRow {
  readonly key: string;
  readonly capability_id: string;
  readonly incarnation_id: string;
  readonly field: string;
  readonly record_id: string | null;
  readonly state: FileLedgerState;
  readonly kind: string;
  readonly mime: string;
  readonly size: number;
  readonly name: string;
  readonly encoding: string | null;
  readonly created_at: string;
  readonly cleanup_attempts: number;
  readonly cleanup_error: string | null;
}

/**
 * Build the ledger: migration `0016_file_ledger` runs it, and so does every Gate scratch database.
 * `kind` carries no `IN (…)` CHECK for the reason a choice column has none: families grow, and
 * SQLite cannot alter a column constraint. The save checks it against the field's `accepts`.
 */
export function createFileLedgerSchema(database: Database): void {
  database.exec(
    `CREATE TABLE IF NOT EXISTS ${FILE_LEDGER_TABLE} (
       key              TEXT PRIMARY KEY,
       capability_id    TEXT NOT NULL,
       incarnation_id   TEXT NOT NULL,
       field            TEXT NOT NULL,
       record_id        TEXT,
       state            TEXT NOT NULL
         CHECK (state IN (${FILE_LEDGER_STATES.map((state) => `'${state}'`).join(", ")})),
       kind             TEXT NOT NULL,
       mime             TEXT NOT NULL CHECK (length(mime) > 0),
       size             INTEGER NOT NULL CHECK (size BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}),
       name             TEXT NOT NULL,
       encoding         TEXT,
       created_at       TEXT NOT NULL DEFAULT (datetime('now')),
       cleanup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
       cleanup_error    TEXT,
       CHECK (
         (state = 'pending' AND record_id IS NULL) OR
         (state = 'owned' AND record_id IS NOT NULL) OR
         state = 'cleanup_enqueued'
       )
     ) STRICT;`,
  );
  database.exec(
    `CREATE INDEX IF NOT EXISTS ${FILE_LEDGER_TABLE}_record ON ${FILE_LEDGER_TABLE} (record_id);`,
  );
  database.exec(
    `CREATE INDEX IF NOT EXISTS ${FILE_LEDGER_TABLE}_incarnation
     ON ${FILE_LEDGER_TABLE} (incarnation_id);`,
  );
}

const FILE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A new unguessable key, in the one shape {@link isFileKey} admits. */
export function mintFileKey(): string {
  return randomUUID();
}

/** Whether `value` has the shape of a key the platform mints, checked before any lookup. */
export function isFileKey(value: unknown): value is string {
  return typeof value === "string" && FILE_KEY_PATTERN.test(value);
}

/** Every key the ledger holds, whatever its state: what a question's rows are read against. */
export function readFileLedgerKeys(database: Database): string[] {
  return database
    .query<{ key: string }, []>(`SELECT "key" FROM ${FILE_LEDGER_TABLE}`)
    .all()
    .map((row) => row.key);
}

/**
 * What changes whenever a key is added or removed, so a reader can tell its copy is stale. The
 * newest key is part of it because a rowid is reused once the row that held it is deleted.
 */
export interface FileLedgerSignature {
  readonly rows: number;
  readonly newest: string | null;
}

export function readFileLedgerSignature(database: Database): FileLedgerSignature {
  return database
    .query<FileLedgerSignature, []>(
      `SELECT count(*) AS rows,
              (SELECT "key" FROM ${FILE_LEDGER_TABLE} ORDER BY rowid DESC LIMIT 1) AS newest
       FROM ${FILE_LEDGER_TABLE}`,
    )
    .get() as FileLedgerSignature;
}

export function readFileLedgerRow(database: Database, key: string): FileLedgerRow | null {
  return database
    .query(`SELECT * FROM ${FILE_LEDGER_TABLE} WHERE "key" = ?`)
    .get(key) as FileLedgerRow | null;
}

/** A file admission verified, for the incarnation and field it was uploaded to. */
export type PendingFile = Pick<
  FileLedgerRow,
  "key" | "capability_id" | "incarnation_id" | "field" | "kind" | "mime" | "size" | "name"
>;

/** Record an admitted key as `pending`. The caller has found its incarnation active in this write. */
export function insertPendingFile(database: Database, file: PendingFile): void {
  database
    .query(
      `INSERT INTO ${FILE_LEDGER_TABLE}
         (key, capability_id, incarnation_id, field, record_id, state, kind, mime, size, name)
       VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?, ?, ?)`,
    )
    .run(
      file.key,
      file.capability_id,
      file.incarnation_id,
      file.field,
      file.kind,
      file.mime,
      file.size,
      file.name,
    );
}

/**
 * Give up a `pending` key nobody can claim: the upload that minted it never handed it back. False
 * when the row has left `pending` already.
 */
export function enqueuePendingFile(database: Database, key: string): boolean {
  const { changes } = database
    .query(
      `UPDATE ${FILE_LEDGER_TABLE} SET "state" = 'cleanup_enqueued' WHERE "key" = ? AND "state" = 'pending'`,
    )
    .run(key);
  return changes === 1;
}

/**
 * Move a `pending` key to `owned` by `recordId`. False when the row is no longer `pending`, which
 * the caller refuses: the check it made before this ran is what a sweep or another save outran.
 */
export function promotePendingFile(database: Database, key: string, recordId: string): boolean {
  const { changes } = database
    .query(
      `UPDATE ${FILE_LEDGER_TABLE} SET "state" = 'owned', "record_id" = ? WHERE "key" = ? AND "state" = 'pending'`,
    )
    .run(recordId, key);
  return changes === 1;
}

/** The capability incarnation a ledger row belongs to. */
export interface FileLedgerOwner {
  readonly capabilityId: string;
  readonly incarnationId: string;
}

/**
 * Give up a key that `recordId`'s `field` owns, for 7.3/01's worker to delete. False when no such
 * owned row exists, which the caller refuses: the stored reference and the ledger disagree.
 */
export function enqueueDisplacedFile(
  database: Database,
  owner: FileLedgerOwner & { readonly field: string; readonly recordId: string },
  key: string,
): boolean {
  const { changes } = database
    .query(
      `UPDATE ${FILE_LEDGER_TABLE} SET "state" = 'cleanup_enqueued'
       WHERE "key" = ? AND "capability_id" = ? AND "incarnation_id" = ? AND "field" = ?
         AND "record_id" = ? AND "state" = 'owned'`,
    )
    .run(key, owner.capabilityId, owner.incarnationId, owner.field, owner.recordId);
  return changes === 1;
}

/**
 * Give up every key `recordId` owns, in every field, hidden ones included, as its delete commits.
 * One update on the record column, which is indexed for this.
 */
export function enqueueRecordFiles(
  database: Database,
  owner: FileLedgerOwner,
  recordId: string,
): void {
  database
    .query(
      `UPDATE ${FILE_LEDGER_TABLE} SET "state" = 'cleanup_enqueued'
       WHERE "record_id" = ? AND "capability_id" = ? AND "incarnation_id" = ? AND "state" = 'owned'`,
    )
    .run(recordId, owner.capabilityId, owner.incarnationId);
}

/**
 * Move every key `recordId` owns to `nextRecordId`, for a record whose id changed after its save:
 * the Gate gives each seeded record a stable id once the save that claimed its files commits.
 */
export function reassignRecordFiles(
  database: Database,
  owner: FileLedgerOwner,
  recordId: string,
  nextRecordId: string,
): void {
  database
    .query(
      `UPDATE ${FILE_LEDGER_TABLE} SET "record_id" = ?
       WHERE "record_id" = ? AND "capability_id" = ? AND "incarnation_id" = ? AND "state" = 'owned'`,
    )
    .run(nextRecordId, recordId, owner.capabilityId, owner.incarnationId);
}
