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

const FILE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A new unguessable key, in the one shape {@link isFileKey} admits. */
export function mintFileKey(): string {
  return randomUUID();
}

/** Whether `value` has the shape of a key the platform mints, checked before any lookup. */
export function isFileKey(value: unknown): value is string {
  return typeof value === "string" && FILE_KEY_PATTERN.test(value);
}

export function readFileLedgerRow(database: Database, key: string): FileLedgerRow | null {
  return database
    .query(`SELECT * FROM ${FILE_LEDGER_TABLE} WHERE "key" = ?`)
    .get(key) as FileLedgerRow | null;
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
