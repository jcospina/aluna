// Layered build gate — Module 2, Epic 2.5 (PLAN flow step 6, ADR-0004).
//
// The gate is a final verdict, distinct from the unit-generation fix loop. It
// runs always-on rungs in order: structural checks first, then a scratch-database
// smoke round-trip through the same injected-toolbox contract the runtime uses.

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import { type CapabilityTableDdl, createCapabilityDataTool } from "../capability-data/index.ts";
import type { CapabilitySpec, SpecField } from "../registry/index.ts";
import type { CapabilityHandler } from "../router/index.ts";
import type { HandlerUnitName } from "./units.ts";

const GATE_RUNG_ORDER = ["structural", "smoke"] as const;
const HANDLER_NAMES = ["create", "read"] as const satisfies readonly HandlerUnitName[];

export type GateRungName = (typeof GATE_RUNG_ORDER)[number];
export type GateRungStatus = "passed" | "failed";

export interface GateRungOutcome {
  readonly rung: GateRungName;
  readonly status: GateRungStatus;
  readonly durationMs: number;
  readonly error?: string;
}

export interface SmokeGateResult {
  readonly tableName: string;
  readonly rowCount: number;
  readonly insertedRowId: string;
  readonly createFragmentLength: number;
  readonly readFragmentLength: number;
  readonly realDatabaseUnchanged?: boolean;
}

export interface CapabilityGateInput {
  readonly spec: CapabilitySpec;
  // The migration stage owns DDL derivation. The gate applies that exact output to
  // scratch so smoke proves the build's own schema, not a separately-derived one.
  readonly ddl: CapabilityTableDdl;
  readonly handlers: Readonly<Record<HandlerUnitName, string>>;
  // Optional assertion hook for the real db: the gate snapshots capability tables
  // before and after smoke and fails if they changed.
  readonly realDatabase?: Database;
}

export interface CapabilityGateResult {
  readonly outcomes: readonly GateRungOutcome[];
  readonly durationMs: number;
  readonly smoke: SmokeGateResult;
}

export class CapabilityGateError extends Error {
  override readonly name = "CapabilityGateError";
  readonly failedRung: GateRungName;
  readonly outcomes: readonly GateRungOutcome[];

  constructor(failedRung: GateRungName, outcomes: readonly GateRungOutcome[]) {
    const failed = outcomes.find((outcome) => outcome.rung === failedRung);
    super(`Capability gate failed at ${failedRung}: ${failed?.error ?? "unknown failure"}`);
    this.failedRung = failedRung;
    this.outcomes = outcomes;
  }
}

export async function runCapabilityGate(input: CapabilityGateInput): Promise<CapabilityGateResult> {
  const startedAt = performance.now();
  const outcomes: GateRungOutcome[] = [];

  await runGateRung(outcomes, "structural", () => runStructuralRung(input));
  const smoke = await runGateRung(outcomes, "smoke", () => runSmokeRung(input));

  return {
    outcomes,
    durationMs: performance.now() - startedAt,
    smoke,
  };
}

async function runGateRung<T>(
  outcomes: GateRungOutcome[],
  rung: GateRungName,
  body: () => T | Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    const result = await body();
    outcomes.push({ rung, status: "passed", durationMs: performance.now() - startedAt });
    return result;
  } catch (error) {
    outcomes.push({
      rung,
      status: "failed",
      durationMs: performance.now() - startedAt,
      error: errorMessage(error),
    });
    throw new CapabilityGateError(rung, outcomes);
  }
}

function runStructuralRung(input: CapabilityGateInput): void {
  assertHandlerExportShapes(input.handlers);
  const typeFailure = typeCheckHandlers(input.handlers);
  if (typeFailure) throw new Error(typeFailure);
}

async function runSmokeRung(input: CapabilityGateInput): Promise<SmokeGateResult> {
  const realDatabase = input.realDatabase;
  const beforeReal = realDatabase ? snapshotCapabilityTables(realDatabase) : undefined;
  const scratch = openScratchDatabasePair();
  let smoke: SmokeGateResult | undefined;
  let smokeError: unknown;

  try {
    applyDdl(input.ddl, scratch.readwrite);
    const data = createCapabilityDataTool(input.spec, scratch);
    const handlers = await loadHandlers(input.handlers);
    const smokeInput = buildSmokeInput(input.spec);

    const createFragment = await handlers.create({ input: smokeInput.input, data });
    assertFragment("create", createFragment);

    const rows = data.select();
    assertSmokeRows(input.spec, rows, smokeInput.expectedValues);

    const readFragment = await handlers.read({ input: {}, data });
    assertFragment("read", readFragment);

    const insertedRow = rows[0];
    if (!insertedRow) {
      throw new Error("Smoke expected one inserted row, but scratch select returned none.");
    }

    smoke = {
      tableName: input.ddl.tableName,
      rowCount: rows.length,
      insertedRowId: insertedRow.id,
      createFragmentLength: createFragment.length,
      readFragmentLength: readFragment.length,
      ...(beforeReal ? { realDatabaseUnchanged: true } : {}),
    };
  } catch (error) {
    smokeError = error;
  } finally {
    scratch.readonly.close();
    scratch.readwrite.close();
  }

  if (
    beforeReal &&
    realDatabase &&
    !sameSnapshot(beforeReal, snapshotCapabilityTables(realDatabase))
  ) {
    throw new Error("Gate execution changed real capability data tables.");
  }

  if (smokeError) throw smokeError;
  if (!smoke) throw new Error("Smoke rung did not produce a result.");
  return smoke;
}

function assertHandlerExportShapes(handlers: Readonly<Record<HandlerUnitName, string>>): void {
  for (const name of HANDLER_NAMES) {
    assertHandlerExportShape(name, handlers[name]);
  }
}

function assertHandlerExportShape(name: HandlerUnitName, content: string): void {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`Generated handler "${name}" is missing.`);
  }

  const source = ts.createSourceFile(`${name}.ts`, content, ts.ScriptTarget.Latest, true);
  const statement = exactlyOneExportedStatement(name, source);
  assertDefaultAsyncFunction(name, statement);
}

function exactlyOneExportedStatement(name: HandlerUnitName, source: ts.SourceFile): ts.Statement {
  const exported = source.statements.filter(hasExportSurface);
  if (exported.length !== 1) {
    throw new Error(
      `Generated handler "${name}" must have exactly one export: the default async function.`,
    );
  }

  const [statement] = exported;
  if (!statement) {
    throw new Error(`Generated handler "${name}" must export the default async function.`);
  }
  return statement;
}

function assertDefaultAsyncFunction(name: HandlerUnitName, statement: ts.Statement): void {
  if (!ts.isFunctionDeclaration(statement)) {
    throw new Error(
      `Generated handler "${name}" must default-export an async function declaration.`,
    );
  }

  const modifiers = ts.getModifiers(statement) ?? [];
  const hasDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  const hasAsync = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!hasDefault || !hasAsync) {
    throw new Error(`Generated handler "${name}" must use \`export default async function\`.`);
  }
  if (statement.parameters.length !== 1) {
    throw new Error(
      `Generated handler "${name}" must receive one platform-built context parameter.`,
    );
  }
}

function hasExportSurface(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) return true;
  if (!ts.canHaveModifiers(statement)) return false;
  return (ts.getModifiers(statement) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

function typeCheckHandlers(
  handlers: Readonly<Record<HandlerUnitName, string>>,
): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "aluna-gate-typecheck-"));
  try {
    writeFileSync(join(dir, "contract.d.ts"), handlerContractDeclarations);
    for (const name of HANDLER_NAMES) {
      writeFileSync(join(dir, `${name}.ts`), handlers[name]);
    }
    writeFileSync(
      join(dir, "assert.ts"),
      [
        'import create from "./create.ts";',
        'import read from "./read.ts";',
        "const assertCreate: CapabilityHandler = create;",
        "const assertRead: CapabilityHandler = read;",
        "void assertCreate;",
        "void assertRead;",
      ].join("\n"),
    );

    const program = ts.createProgram(
      [
        join(dir, "contract.d.ts"),
        join(dir, "create.ts"),
        join(dir, "read.ts"),
        join(dir, "assert.ts"),
      ],
      {
        allowImportingTsExtensions: true,
        forceConsistentCasingInFileNames: true,
        lib: ["lib.esnext.d.ts"],
        module: ts.ModuleKind.ESNext,
        moduleDetection: ts.ModuleDetectionKind.Force,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        noEmit: true,
        noFallthroughCasesInSwitch: true,
        noImplicitOverride: true,
        noUncheckedIndexedAccess: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ESNext,
        verbatimModuleSyntax: true,
      },
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return diagnostics.length === 0 ? undefined : formatDiagnostics(diagnostics);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

interface ScratchDatabasePair {
  readonly readwrite: Database;
  readonly readonly: Database;
}

function openScratchDatabasePair(): ScratchDatabasePair {
  const name = `aluna_gate_${randomUUID().replaceAll("-", "_")}`;
  const uri = `file:${name}?mode=memory&cache=shared`;
  const readwrite = new Database(uri, { create: true, readwrite: true });
  const readonly = new Database(uri, { readonly: true });
  return { readwrite, readonly };
}

function applyDdl(ddl: CapabilityTableDdl, database: Database): void {
  for (const statement of ddl.statements) {
    database.exec(statement);
  }
}

async function loadHandlers(
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

interface SmokeInput {
  readonly input: Readonly<Record<string, string>>;
  readonly expectedValues: Readonly<Record<string, string | number | boolean>>;
}

function buildSmokeInput(spec: CapabilitySpec): SmokeInput {
  const input: Record<string, string> = {};
  const expectedValues: Record<string, string | number | boolean> = {};

  for (const field of spec.schema.fields) {
    const sample = sampleValue(field);
    input[field.name] = sample.input;
    expectedValues[field.name] = sample.expected;
  }

  return { input, expectedValues };
}

function sampleValue(field: SpecField): { input: string; expected: string | number | boolean } {
  switch (field.type) {
    case "string":
      return { input: `gate smoke ${field.name}`, expected: `gate smoke ${field.name}` };
    case "number":
      return { input: "42.5", expected: 42.5 };
    case "boolean":
      return { input: "on", expected: true };
    case "datetime":
      return { input: "2026-06-23T00:00:00.000Z", expected: "2026-06-23T00:00:00.000Z" };
  }
}

function assertFragment(action: HandlerUnitName, fragment: unknown): asserts fragment is string {
  if (typeof fragment !== "string" || fragment.trim().length === 0) {
    throw new Error(`Smoke ${action} handler must return a non-empty HTML fragment string.`);
  }
}

function assertSmokeRows(
  spec: CapabilitySpec,
  rows: ReturnType<ReturnType<typeof createCapabilityDataTool>["select"]>,
  expectedValues: Readonly<Record<string, string | number | boolean>>,
): void {
  if (rows.length !== 1) {
    throw new Error(`Smoke expected exactly one scratch row, received ${rows.length}.`);
  }

  const row = rows[0];
  if (!row) throw new Error("Smoke expected one scratch row, received none.");

  for (const field of spec.schema.fields) {
    const expected = expectedValues[field.name];
    if (row[field.name] !== expected) {
      throw new Error(
        `Smoke row field "${field.name}" expected ${JSON.stringify(expected)}, received ${JSON.stringify(row[field.name])}.`,
      );
    }
  }
}

interface CapabilityTableSnapshot {
  readonly tableName: string;
  readonly rowsJson: string;
}

function snapshotCapabilityTables(database: Database): readonly CapabilityTableSnapshot[] {
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

function sameSnapshot(
  left: readonly CapabilityTableSnapshot[],
  right: readonly CapabilityTableSnapshot[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return message;

      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} - ${message}`;
    })
    .join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const handlerContractDeclarations = `
type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type CapabilityDataColumnValue = string | number | boolean | JsonObject | null;
interface CapabilityDataRow {
  readonly id: string;
  readonly created_at: string;
  readonly extra: JsonObject;
  readonly [field: string]: CapabilityDataColumnValue;
}
type CapabilityInput = Readonly<Record<string, string>>;
interface CapabilityDataTool {
  insert(values: Record<string, unknown>): CapabilityDataRow;
  select(): CapabilityDataRow[];
}
interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly data: CapabilityDataTool;
}
type CapabilityHandler = (context: CapabilityContext) => Promise<string>;
`;
