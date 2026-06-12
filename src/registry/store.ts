// The capability registry access module — Module 2, Epic 2.1 (ARCH §6.3
// "Capability Registry", §7, PLAN decision 8).
//
// The registry is the source of truth for everything Aluna has become: one lean
// row per capability — spec + version + artifacts pointer. Handlers, views, and
// tests are version-keyed caches derived from the spec; this table is the thing
// they are derived *from* (ARCH §2).
//
// Access follows the platform's data access model (ARCH §3, §7): the insert
// rides `db`, the single constrained write path; reads default to `dbReadonly`,
// the read path on which a write is physically impossible. Both sides of the
// round-trip validate against the Zod row shape — a malformed row can neither
// enter the registry nor come back out of it unnoticed.

import type { Database } from "bun:sqlite";
import { db, dbReadonly } from "../db.ts";
import { type CapabilityRow, capabilityRowSchema } from "./spec.ts";

// The registry table, created by platform migration 0002 (src/migrations.ts).
// A fixed platform constant (never user input), so interpolating it into the
// SQL below is safe — same convention as the migrations ledger.
export const REGISTRY_TABLE = "capability_registry";

// The row as SQLite stores it: the structured parts (`schema`, `ui_intent`,
// `tools`) serialized as JSON text, everything else a scalar column.
interface StoredRow {
  id: string;
  label: string;
  version: number;
  schema: string;
  ui_intent: string;
  behavior: string;
  tools: string;
  artifacts_path: string;
  prompt_context: string;
}

const ROW_COLUMNS =
  "id, label, version, schema, ui_intent, behavior, tools, artifacts_path, prompt_context";

// Rehydrate a stored row and re-validate it. Validating on the way out too is
// deliberate: the registry drives DDL, routing, and generation, so a row that
// no longer conforms (hand-edited db, future shape drift) fails loudly at the
// read site instead of misbehaving three derivations later.
function parseStoredRow(stored: StoredRow): CapabilityRow {
  return capabilityRowSchema.parse({
    id: stored.id,
    label: stored.label,
    version: stored.version,
    schema: JSON.parse(stored.schema),
    ui_intent: JSON.parse(stored.ui_intent),
    behavior: stored.behavior,
    tools: JSON.parse(stored.tools),
    artifacts_path: stored.artifacts_path,
    prompt_context: stored.prompt_context,
  });
}

// Insert one capability row through the read-write connection. The row is
// validated first — an invalid row throws (ZodError) and writes nothing, which
// is the loud failure the build's commit step leans on. A duplicate id throws
// the primary-key violation: duplicates are the resolver's job to deflect
// (PLAN decision 6 — no collision logic here), so reaching this is a bug.
export function insertCapability(row: CapabilityRow, database: Database = db): CapabilityRow {
  const valid = capabilityRowSchema.parse(row);

  database.run(
    `INSERT INTO ${REGISTRY_TABLE} (${ROW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      valid.id,
      valid.label,
      valid.version,
      JSON.stringify(valid.schema),
      JSON.stringify(valid.ui_intent),
      valid.behavior,
      JSON.stringify(valid.tools),
      valid.artifacts_path,
      valid.prompt_context,
    ],
  );

  return valid;
}

// Fetch one capability by id, or null when it doesn't exist — the router's
// lookup for `/capability/:id/:action` (2.3). Reads ride the read-only
// connection by convention.
export function getCapability(id: string, database: Database = dbReadonly): CapabilityRow | null {
  const stored = database
    .query(`SELECT ${ROW_COLUMNS} FROM ${REGISTRY_TABLE} WHERE id = ?`)
    .get(id) as StoredRow | null;

  return stored ? parseStoredRow(stored) : null;
}

// List every capability — toolbar rehydration on load and the intent resolver's
// classification context both consume this (ARCH §6.3: the resolver scans every
// row, which is why the row stays lean). Ordered by id so both consumers see
// one stable, deterministic order.
export function listCapabilities(database: Database = dbReadonly): CapabilityRow[] {
  const stored = database
    .query(`SELECT ${ROW_COLUMNS} FROM ${REGISTRY_TABLE} ORDER BY id`)
    .all() as StoredRow[];

  return stored.map(parseStoredRow);
}
