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

import type { CapabilityCreateValues, CapabilityTableDdl } from "../capability-data/index.ts";
import {
  createCapabilityMutationPort,
  deriveCapabilityTableDdl,
  encodeCapabilityFieldForStorage,
} from "../capability-data/index.ts";
import {
  createPresentationAdapter,
  type ItemRenderer,
  type PresentationAdapter,
  type RenderableCapability,
} from "../presentation/index.ts";
import type { CapabilitySpec, FieldType } from "../registry/index.ts";
import type { CapabilityCreateHandler, CapabilityReadHandler } from "../router/index.ts";
import type { ScratchCatalogCapability } from "./gate.ts";
import type { HandlerUnitName } from "./units.ts";

/** The two handlers the current smoke cycle executes; structural checks cover the full inventory. */
export const SMOKE_HANDLER_NAMES = ["create", "read"] as const satisfies readonly HandlerUnitName[];

export interface LoadedHandlers {
  readonly create: CapabilityCreateHandler;
  readonly read: CapabilityReadHandler;
}

/**
 * Build the real `present` adapter the gate hands handlers alongside the scratch data
 * tool — the `present` half of ADR-0004's practice toolbox, extended by ADR-0005 §2. It
 * loads the build's generated item renderer and binds it to the capability, so the smoke
 * and behavioral rungs exercise handlers through the *exact same* adapter the router
 * injects at runtime. Because create and read both render records through this one adapter,
 * the smoke rung proves their item markup is identical by construction (3.4/02). A renderer
 * that fails to load throws here and fails the rung loudly rather than rendering blank.
 */
export function buildGatePresent(spec: CapabilitySpec, itemRenderer: string): PresentationAdapter {
  const capability: RenderableCapability = {
    id: spec.id,
    label: spec.label,
    schema: spec.schema,
    form: spec.ui_intent.form,
    item: spec.ui_intent.item,
    detail: spec.ui_intent.detail,
  };
  return createPresentationAdapter({ capability, renderItem: loadItemRenderer(itemRenderer) });
}

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

/** Build one isolated scratch catalog containing the target plus every declared dependency. */
export function prepareScratchCatalog(
  spec: CapabilitySpec,
  ddl: CapabilityTableDdl,
  catalog: readonly ScratchCatalogCapability[] | undefined,
  databases: ScratchDatabasePair,
): void {
  applyDdl(ddl, databases.readwrite);
  const declared = Object.values(spec.read_dependencies).flat();
  const fixtures = catalog ?? [];

  for (const dependency of declared) {
    const matches = fixtures.filter(
      (fixture) =>
        fixture.spec.id === dependency.capability_id &&
        fixture.incarnationId === dependency.incarnation_id,
    );
    if (matches.length !== 1) {
      throw new Error(
        `Scratch catalog requires exactly one synthetic fixture for ${dependency.capability_id}/${dependency.incarnation_id}.`,
      );
    }
  }

  const declaredKeys = new Set(
    declared.map((dependency) => `${dependency.capability_id}/${dependency.incarnation_id}`),
  );
  for (const fixture of fixtures) {
    const key = `${fixture.spec.id}/${fixture.incarnationId}`;
    if (!declaredKeys.has(key)) {
      throw new Error(`Scratch catalog fixture ${key} is not declared by the candidate spec.`);
    }
    const dependencyDdl = deriveCapabilityTableDdl(fixture.spec);
    applyDdl(dependencyDdl, databases.readwrite);
    for (const row of fixture.rows) {
      seedCompatibilityRow(fixture.spec, dependencyDdl.tableName, row, databases.readwrite);
    }
  }
}

function seedCompatibilityRow(
  spec: CapabilitySpec,
  tableName: string,
  row: CapabilityCreateValues,
  database: Database,
): void {
  const fieldsByName = new Map(spec.schema.fields.map((field) => [field.name, field]));
  const activeValues: CapabilityCreateValues = {};
  const inactiveValues: Array<readonly [string, string | number | null]> = [];

  for (const [name, value] of Object.entries(row)) {
    const field = fieldsByName.get(name);
    if (!field) {
      throw new Error(`Synthetic scratch row references unknown field "${name}" in ${spec.id}.`);
    }
    if (field.lifecycle === "active") {
      activeValues[name] = value;
    } else {
      inactiveValues.push([name, encodeCapabilityFieldForStorage(field, value)]);
    }
  }

  const created = createCapabilityMutationPort(spec, database).create(activeValues);
  if (inactiveValues.length === 0) return;

  const assignments = inactiveValues.map(([name]) => `${sqlIdentifier(name)} = ?`).join(", ");
  database
    .query(`UPDATE ${sqlIdentifier(tableName)} SET ${assignments} WHERE "id" = ?`)
    .run(...inactiveValues.map(([, value]) => value), created.id);
}

/** Transpile + load the generated handler strings into live callable functions. */
export async function loadHandlers(
  handlers: Readonly<Partial<Record<HandlerUnitName, string>>>,
): Promise<LoadedHandlers> {
  const loaded = SMOKE_HANDLER_NAMES.map(
    (name) => [name, loadDefaultExport(`handler "${name}"`, name, handlers[name] ?? "")] as const,
  );

  return Object.fromEntries(loaded) as unknown as LoadedHandlers;
}

/** Transpile + load the generated item renderer string into a live callable function. */
export function loadItemRenderer(content: string): ItemRenderer {
  return loadDefaultExport("item renderer", "item", content) as ItemRenderer;
}

// Prepare a generated unit's default-exported function for in-process execution. The
// default export (async for handlers, synchronous for the item renderer) is rewritten to
// a locally-named function the factory returns.
//
// Do not dynamic-import a temporary .ts file here. In `bun --watch`, imported temp files
// join the watch set; deleting them restarts the dev server mid-SSE.
function loadDefaultExport(label: string, fileStem: string, content: string): unknown {
  const transpiled = ts.transpileModule(content, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
      verbatimModuleSyntax: true,
    },
    fileName: `${fileStem}.ts`,
    reportDiagnostics: true,
  });
  if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
    throw new Error(formatDiagnostics(transpiled.diagnostics));
  }

  const runnable = transpiled.outputText.replace(
    /\bexport\s+default\s+(async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?/,
    (_match, asyncKeyword: string | undefined) =>
      `${asyncKeyword ?? ""}function __alunaDefaultExport`,
  );
  if (runnable === transpiled.outputText) {
    throw new Error(`Generated ${label} could not be prepared for gate execution.`);
  }

  const factory = new Function(`${runnable}\nreturn __alunaDefaultExport;`);
  const loaded = factory() as unknown;
  if (typeof loaded !== "function") {
    throw new TypeError(`Generated ${label} has no default function export.`);
  }
  return loaded;
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
// already normalized by the split data ports, so a value comparison is exact for them.
export function fieldValueMatches(type: FieldType, stored: unknown, expected: unknown): boolean {
  if (type === "datetime") return sameInstant(stored, expected);
  if (type === "string[]") return JSON.stringify(stored) === JSON.stringify(expected);
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
