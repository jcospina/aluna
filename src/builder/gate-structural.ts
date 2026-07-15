// The structural rung — the gate's first, always-on verdict over the generated
// *source*, before anything is executed.
//
// It checks the two generated handlers and the generated item renderer: they parse to
// the required export shape (the handlers to ADR-0004's `export default async function`
// taking one context parameter; the item renderer to a synchronous
// `export default function` taking one record), and they type-check in isolation against
// the platform-authored contracts (the handler contract now carries ADR-0005 §2's
// injected `present` adapter). A failure here stops the gate before the smoke and
// behavioral rungs ever run.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import type { CapabilityGateInput } from "./gate.ts";
import { formatDiagnostics, HANDLER_NAMES } from "./gate-internal.ts";
import { checkItemRendererFieldAccess } from "./item-field-access.ts";
import type { HandlerUnitName } from "./units.ts";

const STRICT_CHECK_OPTIONS: ts.CompilerOptions = {
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
};

/** Run the structural rung: assert the export shapes, then type-check handlers + item renderer. */
export function runStructuralRung(input: CapabilityGateInput): void {
  assertHandlerExportShapes(input.handlers);
  assertItemRendererExportShape(input.itemRenderer);
  const fieldAccessFailure = checkItemRendererFieldAccess(input.spec, input.itemRenderer);
  if (fieldAccessFailure) throw new Error(fieldAccessFailure);

  const handlerFailure = typeCheckHandlers(input.handlers);
  if (handlerFailure) throw new Error(handlerFailure);

  const rendererFailure = typeCheckItemRenderer(input.itemRenderer);
  if (rendererFailure) throw new Error(rendererFailure);
}

function assertHandlerExportShapes(handlers: Readonly<Record<HandlerUnitName, string>>): void {
  for (const name of HANDLER_NAMES) {
    assertDefaultFunctionSource(`handler "${name}"`, handlers[name], { async: true });
  }
}

function assertItemRendererExportShape(itemRenderer: string): void {
  assertDefaultFunctionSource("item renderer", itemRenderer, { async: false });
}

interface ExportShapeRules {
  /** The handlers are async; the item renderer is synchronous. */
  readonly async: boolean;
}

function assertDefaultFunctionSource(
  label: string,
  content: string,
  rules: ExportShapeRules,
): void {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error(`Generated ${label} is missing.`);
  }

  const source = ts.createSourceFile(`${label}.ts`, content, ts.ScriptTarget.Latest, true);
  const statement = exactlyOneExportedStatement(label, source);
  assertDefaultFunction(label, statement, rules);
}

function exactlyOneExportedStatement(label: string, source: ts.SourceFile): ts.Statement {
  const exported = source.statements.filter(hasExportSurface);
  if (exported.length !== 1) {
    throw new Error(`Generated ${label} must have exactly one export: the default function.`);
  }

  const [statement] = exported;
  if (!statement) {
    throw new Error(`Generated ${label} must export the default function.`);
  }
  return statement;
}

function assertDefaultFunction(
  label: string,
  statement: ts.Statement,
  rules: ExportShapeRules,
): void {
  if (!ts.isFunctionDeclaration(statement)) {
    throw new Error(
      `Generated ${label} must default-export ${rules.async ? "an async" : "a"} function declaration.`,
    );
  }
  assertDefaultFunctionModifiers(label, statement, rules);
  if (statement.parameters.length !== 1) {
    throw new Error(`Generated ${label} must receive one parameter.`);
  }
}

function assertDefaultFunctionModifiers(
  label: string,
  statement: ts.FunctionDeclaration,
  rules: ExportShapeRules,
): void {
  const modifiers = ts.getModifiers(statement) ?? [];
  const hasDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  const hasAsync = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!hasDefault || (rules.async && !hasAsync)) {
    throw new Error(
      `Generated ${label} must use \`export default ${rules.async ? "async " : ""}function\`.`,
    );
  }
  if (!rules.async && hasAsync) {
    throw new Error(`Generated ${label} must be synchronous, not \`async\`.`);
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
        "const assertCreate: CapabilityCreateHandler = create;",
        "const assertRead: CapabilityReadHandler = read;",
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
      STRICT_CHECK_OPTIONS,
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return diagnostics.length === 0 ? undefined : formatDiagnostics(diagnostics);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function typeCheckItemRenderer(itemRenderer: string): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "aluna-gate-renderer-"));
  try {
    writeFileSync(join(dir, "contract.d.ts"), itemRendererContractDeclarations);
    writeFileSync(join(dir, "item.ts"), itemRenderer);
    writeFileSync(
      join(dir, "assert.ts"),
      [
        'import renderItem from "./item.ts";',
        "const assertRenderer: ItemRenderer = renderItem;",
        "void assertRenderer;",
      ].join("\n"),
    );

    const program = ts.createProgram(
      [join(dir, "contract.d.ts"), join(dir, "item.ts"), join(dir, "assert.ts")],
      STRICT_CHECK_OPTIONS,
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    return diagnostics.length === 0 ? undefined : formatDiagnostics(diagnostics);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

// The record shape both contracts speak — the capability data row seen structurally.
const recordContractDeclarations = `
type CapabilityDataColumnValue = string | number | boolean | readonly string[] | null;
interface CapabilityDataRow {
  readonly id: string;
  readonly created_at: string;
  readonly [field: string]: CapabilityDataColumnValue;
}
type PresentableRecord = Readonly<Record<string, unknown>>;
type PresentationAdapter = (record: PresentableRecord) => string;
`;

// The handler contract — including ADR-0005 §2's injected `present` adapter (mirrors
// src/router/contract.ts and src/builder/unit-checks.ts).
const handlerContractDeclarations = `${recordContractDeclarations}
type CapabilityInputValue = string | readonly string[];
interface CapabilityInput {
  readonly values: Readonly<Record<string, CapabilityInputValue>>;
  readonly submittedFields: ReadonlySet<string>;
}
interface CapabilityMutationPort {
  create(values: Record<string, unknown>): CapabilityDataRow;
}
type CapabilityQueryParameter = string | number | bigint | boolean | null | Uint8Array;
interface CapabilityQueryResultColumn {
  readonly alias: string;
  readonly type: "string" | "number" | "boolean" | "date" | "datetime" | "string[]";
}
interface CapabilityQueryPort {
  all(input: {
    readonly sql: string;
    readonly parameters?: readonly CapabilityQueryParameter[];
    readonly result: readonly CapabilityQueryResultColumn[];
  }): Readonly<Record<string, CapabilityDataColumnValue>>[];
}
interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly query: CapabilityQueryPort;
  readonly present: PresentationAdapter;
}
interface CapabilityCreateContext extends CapabilityContext {
  readonly mutation: CapabilityMutationPort;
}
type CapabilityCreateHandler = (context: CapabilityCreateContext) => Promise<string>;
type CapabilityReadHandler = (context: CapabilityContext) => Promise<string>;
`;

// The item-renderer contract — one record → its inner markup string (mirrors the
// presentation adapter's `ItemRenderer`).
const itemRendererContractDeclarations = `${recordContractDeclarations}
type ItemRenderer = (record: PresentableRecord) => string;
`;
