// The file ledger (ADR-0009; Module 7 PLAN decisions 21 and 22): the one place ownership of a file
// is asserted. One row per admitted key. Only the platform writes it, and a capability's column is
// built from its row at the save, so nothing the browser posts reaches that column.
//
// A leaf over the database handle it is given: it opens no connection, so the migration that
// creates the table and the save that promotes a row can both name it.

import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { CLEANUP_ERROR_MAX_LENGTH } from "../../errors.ts";
import { FILE_LEDGER_TABLE } from "../../persistence/table-names.ts";

export { FILE_LEDGER_TABLE } from "../../persistence/table-names.ts";

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
  createFileCleanupIndex(database);
  createFilePendingIndex(database);
}

/**
 * The cleanup worker reads its queue after every save and on every desk load, so the read walks
 * only enqueued rows. Migration `0018_file_ledger_cleanup_index` adds it to an older ledger.
 */
export function createFileCleanupIndex(database: Database): void {
  database.exec(
    `CREATE INDEX IF NOT EXISTS ${FILE_LEDGER_TABLE}_cleanup
     ON ${FILE_LEDGER_TABLE} (key) WHERE state = 'cleanup_enqueued';`,
  );
}

/**
 * The desk-load sweep reads only pending rows, through this index, while it holds the platform
 * write. Migration `0019_file_ledger_pending_index` adds it to an older ledger.
 */
export function createFilePendingIndex(database: Database): void {
  database.exec(
    `CREATE INDEX IF NOT EXISTS ${FILE_LEDGER_TABLE}_pending
     ON ${FILE_LEDGER_TABLE} (key) WHERE state = 'pending';`,
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
> & { readonly encoding?: string | null };

/** Record an admitted key as `pending`. The caller has found its incarnation active in this write. */
export function insertPendingFile(database: Database, file: PendingFile): void {
  database
    .query(
      `INSERT INTO ${FILE_LEDGER_TABLE}
         (key, capability_id, incarnation_id, field, record_id, state, kind, mime, size, name,
          encoding)
       VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?, ?, ?, ?)`,
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
      file.encoding ?? null,
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
 * Give up each of `keys` still `pending`, in one transaction: a form let go of them unsaved. A key
 * already owned, enqueued or gone is left as it is. Answers how many moved.
 */
export function enqueuePendingFiles(database: Database, keys: readonly string[]): number {
  return database.transaction(
    () => keys.filter((key) => enqueuePendingFile(database, key)).length,
  )();
}

/**
 * Give up every key still `pending`: a desk load destroyed any form that held one (Module 7 PLAN
 * decision 32). Answers how many moved.
 */
export function enqueueAllPendingFiles(database: Database): number {
  return database.query(SWEEP_PENDING_FILES_SQL).run().changes;
}

/** The desk-load sweep's check, made before it queues its platform write. */
export const ANY_PENDING_FILE_SQL = `SELECT 1 FROM ${FILE_LEDGER_TABLE} WHERE "state" = 'pending' LIMIT 1`;

/** Whether any key is `pending`. */
export function hasPendingFile(database: Database): boolean {
  return database.query(ANY_PENDING_FILE_SQL).get() !== null;
}

/** The desk-load sweep's one statement, which walks only the pending index. */
export const SWEEP_PENDING_FILES_SQL = `UPDATE ${FILE_LEDGER_TABLE}
  SET "state" = 'cleanup_enqueued' WHERE "state" = 'pending'`;

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
 * Give up a key that `recordId`'s `field` owns, for the cleanup worker to delete. False when no such
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
 * Every key an incarnation holds, in any state and any field, inactive ones included: what its
 * capability's deletion must clean. One read on the incarnation index.
 */
export function readIncarnationFileKeys(database: Database, owner: FileLedgerOwner): string[] {
  return database
    .query<{ key: string }, [string, string]>(
      `SELECT "key" FROM ${FILE_LEDGER_TABLE}
       WHERE "incarnation_id" = ? AND "capability_id" = ? ORDER BY "key"`,
    )
    .all(owner.incarnationId, owner.capabilityId)
    .map((row) => row.key);
}

/**
 * Retire every row an incarnation holds, inside its deletion's tombstone transaction; the deletion
 * manifest keeps the duty to delete the bytes. Answers how many rows went.
 */
export function deleteIncarnationFiles(database: Database, owner: FileLedgerOwner): number {
  return database
    .query(`DELETE FROM ${FILE_LEDGER_TABLE} WHERE "incarnation_id" = ? AND "capability_id" = ?`)
    .run(owner.incarnationId, owner.capabilityId).changes;
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

/** A key awaiting cleanup, and how many passes have failed to clean it. */
export interface EnqueuedFile {
  readonly key: string;
  readonly attempts: number;
}

/** The cleanup worker's read of its queue, which walks only the cleanup index. */
export const ENQUEUED_FILES_SQL = `SELECT "key", "cleanup_attempts" AS attempts
  FROM ${FILE_LEDGER_TABLE} WHERE "state" = 'cleanup_enqueued'`;

/** Every key the cleanup worker owes, in no order a caller may rely on. */
export function readEnqueuedFiles(database: Database): EnqueuedFile[] {
  return database.query<EnqueuedFile, []>(ENQUEUED_FILES_SQL).all();
}

/** Delete the row of a key whose bytes are gone. A row already deleted is success. */
export function deleteCleanedFile(database: Database, key: string): void {
  database
    .query(`DELETE FROM ${FILE_LEDGER_TABLE} WHERE "key" = ? AND "state" = 'cleanup_enqueued'`)
    .run(key);
}

/** Count a failed cleanup of `key` and keep why, as the deletion tombstone keeps its own. */
export function recordFileCleanupFailure(database: Database, key: string, error: string): void {
  database
    .query(
      `UPDATE ${FILE_LEDGER_TABLE}
       SET "cleanup_attempts" = "cleanup_attempts" + 1, "cleanup_error" = ?
       WHERE "key" = ? AND "state" = 'cleanup_enqueued'`,
    )
    .run(error.slice(0, CLEANUP_ERROR_MAX_LENGTH), key);
}
