// The capability registry access module — Module 2, Epic 2.1 (ARCH §6.3
// "Capability Registry", §7, PLAN decision 8).
//
// The registry is the source of truth for everything Aluna has become: one lean
// row per capability — spec + incarnation + version + artifacts pointer. Handlers, the item renderer,
// and tests are version-keyed caches derived from the spec; this table is the thing
// they are derived *from* (ARCH §2).
//
// Access follows the platform's data access model (ARCH §3, §7): the insert
// rides `db`, the single constrained write path; reads default to `dbReadonly`,
// the read path on which a write is physically impossible. Both sides of the
// round-trip validate against the Zod row shape — a malformed row can neither
// enter the registry nor come back out of it unnoticed.

import type { Database } from "bun:sqlite";
import { db, dbReadonly } from "../db.ts";
import {
  type CapabilityRow,
  type CapabilityTool,
  capabilityRowSchema,
  type ReadDependency,
} from "./spec.ts";

// The registry table, created by platform migration 0002 (src/migrations.ts).
// A fixed platform constant (never user input), so interpolating it into the
// SQL below is safe — same convention as the migrations ledger.
export const REGISTRY_TABLE = "capability_registry";

// The row as SQLite stores it: the structured parts (`schema`, `ui_intent`,
// `tools`, `read_dependencies`) serialized as JSON text, everything else a scalar column.
interface StoredRow {
  id: string;
  label: string;
  incarnation_id: string;
  version: number;
  schema: string;
  ui_intent: string;
  behavior: string;
  behavioral_errors: string;
  tools: string;
  read_dependencies: string;
  artifacts_path: string;
  prompt_context: string;
}

const ROW_COLUMNS =
  "id, label, incarnation_id, version, schema, ui_intent, behavior, behavioral_errors, tools, read_dependencies, artifacts_path, prompt_context";

// Rehydrate a stored row and re-validate it. Validating on the way out too is
// deliberate: the registry drives DDL, routing, and generation, so a row that
// no longer conforms (hand-edited db, future shape drift) fails loudly at the
// read site instead of misbehaving three derivations later.
function parseStoredRow(stored: StoredRow): CapabilityRow {
  const schema = JSON.parse(stored.schema) as CapabilityRow["schema"];
  return capabilityRowSchema.parse({
    id: stored.id,
    label: stored.label,
    incarnation_id: stored.incarnation_id,
    version: stored.version,
    schema,
    ui_intent: JSON.parse(stored.ui_intent),
    behavior: stored.behavior,
    behavioral_errors: JSON.parse(stored.behavioral_errors),
    tools: JSON.parse(stored.tools),
    read_dependencies: JSON.parse(stored.read_dependencies),
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
  assertActiveReadDependencies(valid, database);

  database.run(
    `INSERT INTO ${REGISTRY_TABLE} (${ROW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      valid.id,
      valid.label,
      valid.incarnation_id,
      valid.version,
      JSON.stringify(valid.schema),
      JSON.stringify(valid.ui_intent),
      valid.behavior,
      JSON.stringify(valid.behavioral_errors),
      JSON.stringify(valid.tools),
      JSON.stringify(valid.read_dependencies),
      valid.artifacts_path,
      valid.prompt_context,
    ],
  );

  return valid;
}

/** Resolve one Action's exact committed dependency catalog or fail closed. */
export function resolveActionReadDependencies(
  row: CapabilityRow,
  action: CapabilityTool,
  database: Database = dbReadonly,
): CapabilityRow[] {
  const dependencies: readonly ReadDependency[] = row.read_dependencies[action];
  return dependencies.map((dependency) => resolveActiveDependency(dependency, database));
}

/** Reverse dependency lookup consumed by capability deletion in epic 4.9. */
export function listCapabilityDependents(
  target: Pick<CapabilityRow, "id" | "incarnation_id">,
  database: Database = dbReadonly,
): CapabilityRow[] {
  return listCapabilities(database).filter((candidate) =>
    Object.values(candidate.read_dependencies)
      .flat()
      .some(
        (dependency) =>
          dependency.capability_id === target.id &&
          dependency.incarnation_id === target.incarnation_id,
      ),
  );
}

function assertActiveReadDependencies(row: CapabilityRow, database: Database): void {
  for (const dependency of Object.values(row.read_dependencies).flat()) {
    resolveActiveDependency(dependency, database);
  }
}

function resolveActiveDependency(dependency: ReadDependency, database: Database): CapabilityRow {
  const row = getCapability(dependency.capability_id, database);
  if (!row || row.incarnation_id !== dependency.incarnation_id) {
    throw new Error(
      `Read dependency ${dependency.capability_id}/${dependency.incarnation_id} does not resolve to one active registry row.`,
    );
  }
  return row;
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

// Whether the registry table exists yet. False on a brand-new platform db that has
// not run the platform migrations (Epic 1.4). The shell's on-load rehydration
// consults this so `GET /` renders the cold-start shell *before* the first migration
// instead of failing on a missing table; every other reader runs post-migration and
// need not ask.
export function isRegistryInitialized(database: Database = dbReadonly): boolean {
  const found = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(REGISTRY_TABLE);

  return found !== null;
}
