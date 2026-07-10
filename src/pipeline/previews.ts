// The developer's liveness view of a running build — the `*-preview` SSE events.
//
// As the build pipeline moves through its stages it streams these structured
// snapshots so a developer watches the spec, migration, units, gate, and commit
// assemble live. This deliberately surfaces internals — that is the whole point of a
// liveness check — and is strictly separate from the product-voice narration and
// confirmation the user sees; ARCH §9.7 keeps internals out of the *product* copy,
// not the dev previews.

import type { Database } from "bun:sqlite";

import type {
  BehavioralGateResult,
  CapabilityMigrationResult,
  CommitCapabilityResult,
  GateRungOutcome,
  GeneratedUnit,
  SmokeGateResult,
  UnitDescriptor,
} from "../builder/index.ts";

export interface DemoMigrationColumnPreview {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly defaultValue: string | null;
  readonly primaryKey: boolean;
}

export interface DemoMigrationPreview {
  readonly kind: "migration-preview";
  readonly tableName: string;
  readonly durationMs: number;
  readonly sql: string;
  readonly columns: readonly DemoMigrationColumnPreview[];
}

export interface DemoUnitPreview {
  readonly kind: GeneratedUnit["kind"];
  readonly name: GeneratedUnit["name"];
  readonly filename: GeneratedUnit["filename"];
  readonly status: "generating" | "fixing" | "complete";
  readonly attempts: number;
  readonly durationMs?: number;
  readonly usage?: GeneratedUnit["usage"];
  readonly error?: string;
  readonly content: string;
}

export interface DemoUnitsPreview {
  readonly kind: "unit-generation-preview";
  readonly status: "running" | "complete";
  readonly codeGenDurationMs: number;
  readonly presentationGenDurationMs: number;
  readonly units: readonly DemoUnitPreview[];
}

export interface DemoGatePreview {
  readonly kind: "gate-preview";
  readonly status: "passed";
  readonly durationMs: number;
  readonly rungs: readonly GateRungOutcome[];
  readonly smoke: SmokeGateResult;
  readonly behavioral: BehavioralGateResult;
}

export interface DemoBuildErrorPreview {
  readonly kind: "build-error-preview";
  readonly status: "failed";
  readonly errorName: string;
  readonly message: string;
  readonly diagnostic?: unknown;
}

// The developer's liveness view of the terminal commit stage (issue 07): the
// capability that just became real — its id, the version it committed at, the
// pointer the registry row now carries, and the files written to the version
// directory. Sent only after the migration transaction commits, so it always
// describes a committed capability. The user-facing confirmation (the `fragment`
// event) rides alongside it; the client-side content/toolbar swap is Epic 2.6.
export interface DemoCommitPreview {
  readonly kind: "commit-preview";
  readonly status: "committed";
  readonly capabilityId: string;
  readonly version: number;
  readonly artifactsPath: string;
  readonly files: readonly string[];
}

interface SqliteColumnInfo {
  readonly name: string;
  readonly type: string;
  readonly notnull: 0 | 1;
  readonly dflt_value: string | null;
  readonly pk: number;
}

function sqliteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function tableCreateSql(database: Database, tableName: string): string {
  const row = database
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { sql: string } | null;
  if (!row) throw new Error(`missing migrated table ${tableName}`);
  return row.sql;
}

function tableColumns(database: Database, tableName: string): DemoMigrationColumnPreview[] {
  const columns = database
    .query(`PRAGMA table_xinfo(${sqliteIdentifier(tableName)})`)
    .all() as SqliteColumnInfo[];

  return columns.map((column) => ({
    name: column.name,
    type: column.type,
    required: column.notnull === 1,
    defaultValue: column.dflt_value,
    primaryKey: column.pk > 0,
  }));
}

/**
 * Build the migration-stage preview by reading the just-applied table back off the
 * build connection. The migration runs on the real read-write connection inside the
 * build's open transaction, so the `cap_<id>` table exists — uncommitted — and is
 * visible to this same connection; a build failure rolls it back. This is the
 * developer's liveness view, never user-facing (ARCH §9.7).
 */
export function buildMigrationPreview(
  database: Database,
  migration: CapabilityMigrationResult,
): DemoMigrationPreview {
  return {
    kind: "migration-preview",
    tableName: migration.tableName,
    durationMs: migration.durationMs,
    sql: tableCreateSql(database, migration.tableName),
    columns: tableColumns(database, migration.tableName),
  };
}

/** The commit-stage preview: the capability that just became real. */
export function buildCommitPreview(commit: CommitCapabilityResult): DemoCommitPreview {
  return {
    kind: "commit-preview",
    status: "committed",
    capabilityId: commit.row.id,
    version: commit.version,
    artifactsPath: commit.artifactsPath,
    files: commit.files,
  };
}

/** The map key identifying a live unit preview (its kind + name). */
export function unitPreviewKey(unit: UnitDescriptor): string {
  return `${unit.kind}:${unit.name}`;
}

/** The on-disk filename a unit will commit to, derived from its kind. */
export function unitPreviewFilename(unit: UnitDescriptor): GeneratedUnit["filename"] {
  return unit.kind === "handler" ? `${unit.name}.ts` : "item.ts";
}

/**
 * Aggregate the per-unit previews into a units snapshot, summing code-gen (handlers)
 * and presentation-gen (the item renderer — the semantic successor to M2's html-gen)
 * wall time across the units captured so far.
 */
export function buildUnitsPreview(
  units: readonly DemoUnitPreview[],
  status: DemoUnitsPreview["status"],
): DemoUnitsPreview {
  return {
    kind: "unit-generation-preview",
    status,
    codeGenDurationMs: units
      .filter((unit) => unit.kind === "handler")
      .reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
    presentationGenDurationMs: units
      .filter((unit) => unit.kind === "item-renderer")
      .reduce((sum, unit) => sum + (unit.durationMs ?? 0), 0),
    units,
  };
}

/** The terminal, complete preview of a single generated unit. */
export function finalUnitPreview(unit: GeneratedUnit): DemoUnitPreview {
  return {
    kind: unit.kind,
    name: unit.name,
    filename: unit.filename,
    status: "complete",
    attempts: unit.attempts.length,
    durationMs: unit.durationMs,
    usage: unit.usage,
    content: unit.content,
  };
}

/** The gate-stage preview: the per-rung outcomes plus the smoke and behavioral tiers. */
export function buildGatePreview(
  durationMs: number,
  rungs: readonly GateRungOutcome[],
  smoke: SmokeGateResult,
  behavioral: BehavioralGateResult,
): DemoGatePreview {
  return {
    kind: "gate-preview",
    status: "passed",
    durationMs,
    rungs,
    smoke,
    behavioral,
  };
}

/**
 * The error preview surfaced when a build throws — names the error and message, and
 * carries a structured `diagnostic` when one is attached (e.g. the gate's per-rung
 * detail).
 */
export function buildDemoErrorPreview(error: unknown): DemoBuildErrorPreview {
  return {
    kind: "build-error-preview",
    status: "failed",
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    ...(hasDiagnostic(error) ? { diagnostic: error.diagnostic } : {}),
  };
}

function hasDiagnostic(error: unknown): error is { readonly diagnostic: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "diagnostic" in error &&
    (error as { diagnostic?: unknown }).diagnostic !== undefined
  );
}
