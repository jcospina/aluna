// Ledger rows written directly, standing in for 7.1/07's upload route, which is what mints them in
// the product. Not a test file itself, so bun never runs it.

import type { Database } from "bun:sqlite";
import { FILE_LEDGER_TABLE, type FileLedgerRow, mintFileKey, readFileLedgerRow } from "./ledger.ts";

export interface FileLedgerSeed {
  readonly capabilityId: string;
  readonly incarnationId: string;
  readonly field: string;
  readonly state?: FileLedgerRow["state"];
  readonly recordId?: string | null;
  readonly kind?: string;
  readonly mime?: string;
  readonly size?: number;
  readonly name?: string;
  readonly encoding?: string | null;
}

/** Admit one file the way the upload route will, and hand back its key. */
export function seedFileLedgerRow(database: Database, seed: FileLedgerSeed): string {
  const key = mintFileKey();
  const state = seed.state ?? "pending";
  const recordId =
    seed.recordId !== undefined ? seed.recordId : state === "owned" ? "an-earlier-record" : null;
  database
    .query(
      `INSERT INTO ${FILE_LEDGER_TABLE}
         (key, capability_id, incarnation_id, field, record_id, state, kind, mime, size, name, encoding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      key,
      seed.capabilityId,
      seed.incarnationId,
      seed.field,
      recordId,
      state,
      seed.kind ?? "image",
      seed.mime ?? "image/jpeg",
      seed.size ?? 48_213,
      seed.name ?? "harbour at dawn.jpg",
      seed.encoding ?? null,
    );
  return key;
}

export function requireFileLedgerRow(database: Database, key: string): FileLedgerRow {
  const row = readFileLedgerRow(database, key);
  if (!row) throw new Error(`No ledger row for key ${key}.`);
  return row;
}
