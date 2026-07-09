// Shared gate infrastructure — the cross-rung helpers the smoke and behavioral
// rungs (and the structural type-check) build on.
//
// The gate proves generated code by *running* it: it spins up scratch in-memory
// databases, loads generated handlers as live functions without writing temp files
// to the watch set, and snapshots the real capability tables before/after to prove
// the gate never mutated them. Those mechanics, plus the small comparison and
// diagnostic helpers reused across rungs, live here.

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import ts from "typescript";

import type { CapabilityTableDdl } from "../capability-data/index.ts";
import { type PresentationAdapter, unavailablePresentationAdapter } from "../presentation/index.ts";
import type { FieldType } from "../registry/index.ts";
import type { CapabilityHandler } from "../router/index.ts";
import type { HandlerUnitName } from "./units.ts";

/** The two generated handlers the gate loads and exercises. */
export const HANDLER_NAMES = ["create", "read"] as const satisfies readonly HandlerUnitName[];

/**
 * The practice presentation adapter the gate hands handlers alongside the scratch data
 * tool — the `present` half of ADR-0004's practice toolbox, extended by ADR-0005 §2. Until
 * 3.4/02 generates an item renderer to feed it, it throws the moment a handler calls
 * `present`: an M2 handler (own markup, never presents) runs green, while a handler that
 * presents without a renderer fails the rung loudly instead of rendering blank. 3.4/02
 * swaps this for a real adapter built from the generated renderer, so the smoke rung proves
 * create and read render identical item markup by construction.
 */
export const GATE_PRACTICE_PRESENT: PresentationAdapter = unavailablePresentationAdapter(
  "The design gate has no item renderer to present records with yet (epic 3.4/02).",
);

export interface ScratchDatabasePair {
  readonly readwrite: Database;
  readonly readonly: Database;
}

/** Open a fresh shared-cache in-memory db pair for one rung's scratch execution. */
export function openScratchDatabasePair(): ScratchDatabasePair {
  const name = `aluna_gate_${randomUUID().replaceAll("-", "_")}`;
  const uri = `file:${name}?mode=memory&cache=shared`;
  const readwrite = new Database(uri, { create: true, readwrite: true });
  const readonly = new Database(uri, { readonly: true });
  return { readwrite, readonly };
}

/** Apply the migration stage's exact DDL statements to a scratch connection. */
export function applyDdl(ddl: CapabilityTableDdl, database: Database): void {
  for (const statement of ddl.statements) {
    database.exec(statement);
  }
}

/** Transpile + load the generated handler strings into live callable functions. */
export async function loadHandlers(
  handlers: Readonly<Record<HandlerUnitName, string>>,
): Promise<Readonly<Record<HandlerUnitName, CapabilityHandler>>> {
  const loaded = HANDLER_NAMES.map(
    (name) => [name, loadHandlerFromSource(name, handlers[name])] as const,
  );

  return Object.fromEntries(loaded) as Readonly<Record<HandlerUnitName, CapabilityHandler>>;
}

function loadHandlerFromSource(name: HandlerUnitName, content: string): CapabilityHandler {
  // Do not dynamic-import a temporary .ts file here. In `bun --watch`, imported
  // temp files join the watch set; deleting them restarts the dev server mid-SSE.
  const transpiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: true,
    },
    fileName: `${name}.ts`,
    reportDiagnostics: true,
  });
  if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(transpiled.diagnostics));
  }

  const runnable = transpiled.outputText.replace(
    /\bexport\s+default\s+async\s+function(?:\s+[A-Za-z_$][\w$]*)?/,
    "async function __alunaDefaultHandler",
  );
  if (runnable === transpiled.outputText) {
    throw new Error(`Generated handler "${name}" could not be prepared for smoke execution.`);
  }

  const factory = new Function(`${runnable}\nreturn __alunaDefaultHandler;`);
  const handler = factory() as unknown;
  if (typeof handler !== "function") {
    throw new TypeError(`Generated handler "${name}" has no default function export.`);
  }
  return handler as CapabilityHandler;
}

export interface CapabilityTableSnapshot {
  readonly tableName: string;
  readonly rowsJson: string;
}

/** Snapshot every `cap_*` data table (name + ordered rows) for an unchanged-assertion. */
export function snapshotCapabilityTables(database: Database): readonly CapabilityTableSnapshot[] {
  const tables = database
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cap\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all() as { name: string }[];

  return tables.map(({ name }) => ({
    tableName: name,
    rowsJson: JSON.stringify(
      database.query(`SELECT * FROM ${sqlIdentifier(name)} ORDER BY "id"`).all(),
    ),
  }));
}

/** Whether two capability-table snapshots are byte-identical. */
export function sameSnapshot(
  left: readonly CapabilityTableSnapshot[],
  right: readonly CapabilityTableSnapshot[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Quote a SQL identifier (table/column name) for safe interpolation. */
export function sqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/** Assert a handler returned a non-empty HTML fragment string (narrowing `fragment`). */
export function assertFragment(
  action: HandlerUnitName,
  fragment: unknown,
): asserts fragment is string {
  if (typeof fragment !== "string" || fragment.trim().length === 0) {
    throw new Error(`Smoke ${action} handler must return a non-empty HTML fragment string.`);
  }
}

// Compare a stored field value to a behavioral/smoke expected value *by the field's
// spec type*. This is the success-path analogue of the validation tier's stable error
// codes: assert on semantic content, not on a byte-identical representation the model
// can't be made to emit deterministically. Datetimes compare as instants — a handler
// may legitimately canonicalize "2025-06-01T12:00:00Z" to "2025-06-01T12:00:00.000Z"
// (a `new Date(...).toISOString()` round-trip) while the model authors the test in the
// raw input form; the same *moment* is a match. Strings, numbers, and booleans are
// already normalized by the data tool, so a value comparison is exact for them.
export function fieldValueMatches(type: FieldType, stored: unknown, expected: unknown): boolean {
  if (type === "datetime") return sameInstant(stored, expected);
  return stored === expected;
}

function sameInstant(stored: unknown, expected: unknown): boolean {
  if (typeof stored !== "string" || typeof expected !== "string") return stored === expected;
  const storedMs = Date.parse(stored);
  const expectedMs = Date.parse(expected);
  // A non-parseable datetime on either side is not something to silently treat as
  // equal — fall back to exact comparison so a genuinely malformed value still fails.
  if (Number.isNaN(storedMs) || Number.isNaN(expectedMs)) return stored === expected;
  return storedMs === expectedMs;
}

/** The message of an unknown error value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Format TypeScript diagnostics with file:line:col positions for the gate's report. */
export function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return message;

      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} - ${message}`;
    })
    .join("\n");
}

/** The structured `diagnostic` carried by an error, when present (e.g. a failed case). */
export function diagnosticForError(error: unknown): unknown {
  return isDiagnosticError(error) ? error.diagnostic : undefined;
}

function isDiagnosticError(error: unknown): error is { readonly diagnostic: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "diagnostic" in error &&
    (error as { diagnostic?: unknown }).diagnostic !== undefined
  );
}
