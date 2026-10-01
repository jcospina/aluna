// Enqueued ledger rows for the cleanup worker's suites, written directly as a displacing save
// leaves them. Not a test file itself, so bun never runs it.

import type { Database } from "bun:sqlite";
import { DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS } from "../../../lifecycle/deletion/index.ts";
import { seedFileLedgerRow } from "../../../platform/files/store/ledger.test-support.ts";
import { FILE_LEDGER_TABLE } from "../../../platform/files/store/ledger.ts";

/** The attempts a key has spent once its first try and every retry have failed. */
export const EXHAUSTED_ATTEMPTS = DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS.length + 1;

/** A `cleanup_enqueued` row that `attempts` passes have already failed to clean. */
export function seedEnqueuedFile(database: Database, attempts = 0): string {
  const key = seedFileLedgerRow(database, {
    capabilityId: "photos",
    incarnationId: "photos-1",
    field: "photo",
    state: "cleanup_enqueued",
  });
  database.run(`UPDATE ${FILE_LEDGER_TABLE} SET cleanup_attempts = ? WHERE key = ?`, [
    attempts,
    key,
  ]);
  return key;
}
