// The structural rung — the gate's first, always-on verdict over the generated
// handler *source*, before anything is executed.
//
// Two checks: the handlers parse to the ADR-0004 export shape (exactly one
// `export default async function` taking one context parameter), and they
// type-check in isolation against the platform-authored handler contract. A failure
// here stops the gate before the smoke and behavioral rungs ever run.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import type { CapabilityGateInput } from "./gate.ts";
import { formatDiagnostics, HANDLER_NAMES } from "./gate-internal.ts";
import type { HandlerUnitName } from "./units.ts";

/** Run the structural rung: assert the handler export shapes, then type-check them. */
export function runStructuralRung(input: CapabilityGateInput): void {
  assertHandlerExportShapes(input.handlers);
  const typeFailure = typeCheckHandlers(input.handlers);
  if (typeFailure) throw new Error(typeFailure);
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
