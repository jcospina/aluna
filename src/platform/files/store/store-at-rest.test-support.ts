// The ledger and store invariant every fault in Module 7's battery ends on (issue 7.3/06). Not a
// test file itself, so bun never runs it.

import type { Database } from "bun:sqlite";
import { expect } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { FILE_LEDGER_TABLE, type FileLedgerRow } from "./ledger.ts";
import { STAGING_DIRECTORY } from "./object-store-root.ts";

const entries = (path: string) => (existsSync(path) ? readdirSync(path).sort() : []);

/**
 * Every byte under `root` has a ledger row, pending, owned or enqueued for cleanup; every owned row
 * has its bytes; and staging is empty, as it is once the process is at rest.
 */
export function expectStoreAtRest(database: Database, root: string): void {
  const rows = database.query(`SELECT "key", "state" FROM ${FILE_LEDGER_TABLE}`).all() as Pick<
    FileLedgerRow,
    "key" | "state"
  >[];
  expect(existsSync(root)).toBe(true);
  const keys = new Set(rows.map((row) => row.key));
  const stored = entries(root).filter((entry) => entry !== STAGING_DIRECTORY);
  expect({
    bytesWithoutRow: stored.filter((key) => !keys.has(key)),
    ownedWithoutBytes: rows
      .filter((row) => row.state === "owned" && !stored.includes(row.key))
      .map((row) => row.key),
    staged: entries(join(root, STAGING_DIRECTORY)),
  }).toEqual({ bytesWithoutRow: [], ownedWithoutBytes: [], staged: [] });
}
