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
import { errorMessage } from "../../platform/errors.ts";
import { createFileLedgerSchema } from "../../platform/files/ledger.ts";
import { sqlIdentifier } from "../../platform/persistence/sql-identifier.ts";
import {
  createPresentationAdapter,
  type ItemRenderer,
  type PresentationAdapter,
  type RenderableCapability,
  renderableFromSpec,
} from "../../presentation/index.ts";
import {
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  type CapabilityTool,
  type FieldType,
  isFileFieldType,
  LOGO_BIRTH_STATUS,
  type ReadDependency,
} from "../../registry/index.ts";
import type {
  CapabilityCreateValues,
  CapabilityTableDdl,
  FileSubmissionBinding,
} from "../../runtime/data/index.ts";
import {
  type CapabilityQueryPort,
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
  encodeCapabilityFieldForStorage,
  materializeCapabilityActionRecord,
} from "../../runtime/data/index.ts";
import type {
  CapabilityCreateHandler,
  CapabilityDeleteHandler,
  CapabilityReadHandler,
  CapabilityUpdateHandler,
} from "../../runtime/router/index.ts";
import { formatDiagnostics } from "../generated-code-check.ts";
import type { HandlerUnitName } from "../units/generation/units.ts";
import type { ScratchCatalogCapability } from "./gate.ts";
import { mintScratchFile, scratchFileName, scratchSubmission } from "./gate-scratch-files.ts";

/** The complete steady-state Handler inventory exercised by the full smoke cycle. */
export const SMOKE_HANDLER_NAMES = [
  "create",
  "read",
  "update",
  "search",
  "delete",
] as const satisfies readonly HandlerUnitName[];

export interface LoadedHandlers {
  readonly create: CapabilityCreateHandler;
  readonly read: CapabilityReadHandler;
  readonly update?: CapabilityUpdateHandler;
  readonly delete?: CapabilityDeleteHandler;
  readonly search?: CapabilityReadHandler;
}

/**
 * A throw from inside the generated item renderer, marked so a rung can tell it from a Handler's
 * own failure: the renderer runs inside the Handler call and would license an innocent rewrite.
 */
export class ItemRendererExecutionError extends Error {
  override readonly name = "ItemRendererExecutionError";

  constructor(override readonly cause: unknown) {
    super(`Generated item renderer threw while rendering: ${errorMessage(cause)}`);
  }
}

/**
 * The real `present` adapter the gate hands handlers (ADR-0004 toolbox, ADR-0005 §2), bound to the
 * build's own item renderer: create and read render through it, and a load failure throws.
 */
export function buildGatePresent(spec: CapabilitySpec, itemRenderer: string): PresentationAdapter {
  const capability: RenderableCapability = {
    ...renderableFromSpec(spec),
    item: spec.ui_intent.item,
  };
  const renderItem = loadItemRenderer(itemRenderer);
  const marked: ItemRenderer = (record) => {
    try {
      return renderItem(record);
    } catch (error) {
      throw error instanceof ItemRendererExecutionError
        ? error
        : new ItemRendererExecutionError(error);
    }
  };
  return createPresentationAdapter({ capability, renderItem: marked });
}

export interface ScratchDatabasePair {
  readonly readwrite: Database;
  readonly readonly: Database;
}

/**
 * Open a fresh shared-cache in-memory db pair for one rung's scratch execution, with its own file
 * ledger for the scratch references a save claims (`gate-scratch-files.ts`).
 */
export function openScratchDatabasePair(): ScratchDatabasePair {
  const name = `aluna_gate_${randomUUID().replaceAll("-", "_")}`;
  const uri = `file:${name}?mode=memory&cache=shared`;
  const readwrite = new Database(uri, { create: true, readwrite: true });
  const readonly = new Database(uri, { readonly: true });
  createFileLedgerSchema(readwrite);
  return { readwrite, readonly };
}

/** Apply the migration stage's exact DDL statements to a scratch connection. */
export function applyDdl(ddl: CapabilityTableDdl, database: Database): void {
  for (const statement of ddl.statements) {
    database.exec(statement);
  }
}

// Scratch dependency rows never reach the registry, so their logo values are the
// birth state a real row would be inserted with rather than anything meaningful.
const SCRATCH_DEPENDENCY_SEED = 1;

/** The dependency rows a rung reads through, shaped as the registry would have stored them. */
export function scratchDependencyRows(
  catalog: readonly ScratchCatalogCapability[] | undefined,
): CapabilityRow[] {
  return (catalog ?? []).map((fixture) => ({
    ...fixture.spec,
    incarnation_id: fixture.incarnationId,
    version: 1,
    artifacts_path: `scratch/${fixture.spec.id}`,
    seed: SCRATCH_DEPENDENCY_SEED,
    logo: { status: LOGO_BIRTH_STATUS, attempts: 0 },
    display_label_override: null,
  }));
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

export function buildGateQueryPort(
  spec: CapabilitySpec,
  action: CapabilityTool,
  catalog: readonly ScratchCatalogCapability[] | undefined,
  database: Database,
): CapabilityQueryPort {
  const declared: readonly ReadDependency[] =
    action in spec.read_dependencies
      ? spec.read_dependencies[action as keyof typeof spec.read_dependencies]
      : [];
  const dependencies = declared.map((dependency) => {
    const fixture = (catalog ?? []).find(
      (candidate) =>
        candidate.spec.id === dependency.capability_id &&
        candidate.incarnationId === dependency.incarnation_id,
    );
    if (!fixture) {
      throw new Error(
        `Scratch catalog requires ${dependency.capability_id}/${dependency.incarnation_id} for ${action}.`,
      );
    }
    return fixture.spec;
  });
  return createCapabilityQueryPort(database, { target: spec, dependencies });
}

/**
 * A dependency's seeded row is a saved record, and a save refuses one without its required files,
 * so each gets a scratch file of its own as the form's upload would have given it.
 */
function requiredFilesBinding(spec: CapabilitySpec, database: Database): FileSubmissionBinding {
  const required = activeSpecFields(spec.schema.fields).filter(
    (field) => field.required && isFileFieldType(field.type),
  );
  const values = Object.fromEntries(
    required.map((field) => {
      const name = scratchFileName(`${spec.id} ${field.name}`);
      return [field.name, mintScratchFile(database, spec, field, name).key];
    }),
  );
  const input = { values, submittedFields: new Set(Object.keys(values)) };
  return scratchSubmission(spec, input, database).binding;
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

  const created = materializeCapabilityActionRecord(
    createCapabilityMutationPort(
      spec,
      database,
      undefined,
      requiredFilesBinding(spec, database),
    ).create(activeValues),
  );
  if (inactiveValues.length === 0) return;

  const assignments = inactiveValues.map(([name]) => `${sqlIdentifier(name)} = ?`).join(", ");
  database
    .query(`UPDATE ${sqlIdentifier(tableName)} SET ${assignments} WHERE "id" = ?`)
    .run(...inactiveValues.map(([, value]) => value), created.id);
}

/** Transpile + load the generated handler strings into live callable functions. */
export async function loadHandlers(
  handlers: Readonly<Partial<Record<HandlerUnitName, string>>>,
  names: readonly HandlerUnitName[] = SMOKE_HANDLER_NAMES,
): Promise<LoadedHandlers> {
  const loaded = names.map(
    (name) => [name, loadDefaultExport(`handler "${name}"`, name, handlers[name] ?? "")] as const,
  );

  return Object.fromEntries(loaded) as unknown as LoadedHandlers;
}

/** Transpile + load the generated item renderer string into a live callable function. */
export function loadItemRenderer(content: string): ItemRenderer {
  return loadDefaultExport("item renderer", "item", content) as ItemRenderer;
}

// Prepare a generated unit's default export for in-process execution, rewritten to a locally
// named function. Never dynamic-import a temp .ts file: in `bun --watch` it restarts the server.
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

/** Assert a handler returned a non-empty HTML fragment string (narrowing `fragment`). */
export function assertFragment(
  action: HandlerUnitName,
  fragment: unknown,
): asserts fragment is string {
  if (typeof fragment !== "string" || fragment.trim().length === 0) {
    throw new Error(`Smoke ${action} handler must return a non-empty HTML fragment string.`);
  }
}

/**
 * Compare a stored value to an expected one *by the field's spec type*. Datetimes compare as
 * instants: a handler may canonicalize what the model authored raw, and the moment is the match.
 */
export function fieldValueMatches(type: FieldType, stored: unknown, expected: unknown): boolean {
  if (type === "datetime") return sameInstant(stored, expected);
  if (type === "string[]") return JSON.stringify(stored) === JSON.stringify(expected);
  if (type === "file") return sameFile(stored, expected);
  // A choice stores the exact declared wire value it was admitted as — no canonicalization
  // is possible or permitted — so it compares exactly, like a string.
  return stored === expected;
}

/**
 * A file compares by `kind` and `name` and never by key (PLAN decision 39): a test cannot know the
 * key a scratch run mints, and the name tells apart every file one run submits.
 */
function sameFile(stored: unknown, expected: unknown): boolean {
  if (stored === null || expected === null) return stored === expected;
  return (
    isFileLike(stored) &&
    isFileLike(expected) &&
    stored.kind === expected.kind &&
    stored.name === expected.name
  );
}

function isFileLike(value: unknown): value is { readonly kind: unknown; readonly name: unknown } {
  return typeof value === "object" && value !== null && "kind" in value && "name" in value;
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
