// The structural rung — the gate's first, always-on verdict over the generated
// *source*, before anything is executed.
//
// It checks every declared generated handler and the generated item renderer: they
// parse to the required export shape (the handlers to ADR-0004's `export default async function`
// taking one context parameter; the item renderer to a synchronous
// `export default function` taking one record), and they type-check in isolation against
// the platform-authored contracts (the handler contract now carries ADR-0005 §2's
// injected `present` adapter). A failure here stops the gate before the smoke and
// behavioral rungs ever run.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import { capabilitySpecSchema } from "../registry/index.ts";
import type { CapabilityGateInput } from "./gate.ts";
import { errorMessage, formatDiagnostics } from "./gate-internal.ts";
import { checkItemRendererFieldAccess } from "./item-field-access.ts";
import { checkHandlerSourceContract } from "./unit-checks.ts";
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

export interface StructuralUnitOutcome {
  readonly kind: "spec" | "handler" | "item-renderer";
  readonly name: "spec" | HandlerUnitName | "item";
  readonly filename: "spec.json" | `${HandlerUnitName}.ts` | "item.ts";
  readonly status: "passed" | "failed";
  readonly error?: string;
}

export interface StructuralGateResult {
  readonly units: readonly StructuralUnitOutcome[];
}

export class StructuralGateError extends Error {
  override readonly name = "StructuralGateError";
  readonly result: StructuralGateResult;
  readonly diagnostic: { readonly structural: StructuralGateResult };

  constructor(result: StructuralGateResult) {
    const failed = result.units.filter((unit) => unit.status === "failed");
    super(
      `Structural validation failed for ${failed.map((unit) => `${unit.filename}: ${unit.error ?? "unknown failure"}`).join("; ")}`,
    );
    this.result = result;
    this.diagnostic = { structural: result };
  }
}

/** Run the structural rung over the spec and every unit in the complete candidate snapshot. */
export function runStructuralRung(input: CapabilityGateInput): StructuralGateResult {
  let spec: CapabilityGateInput["spec"];
  try {
    spec = capabilitySpecSchema.parse(input.spec);
  } catch (error) {
    throw new StructuralGateError({
      units: [failedUnit("spec", "spec", "spec.json", errorMessage(error))],
    });
  }
  const handlerNames = spec.tools;
  const handlerTypeFailures = typeCheckHandlerUnits(handlerNames, input.handlers);
  const units: StructuralUnitOutcome[] = [structuralSpecOutcome(handlerNames, input.handlers)];
  units.push(structuralItemOutcome(input));
  for (const name of handlerNames) {
    units.push(structuralHandlerOutcome(input, name, handlerTypeFailures.get(name)));
  }
  const result = { units } satisfies StructuralGateResult;
  if (units.some((unit) => unit.status === "failed")) throw new StructuralGateError(result);
  return result;
}

function structuralSpecOutcome(
  handlerNames: readonly HandlerUnitName[],
  handlers: CapabilityGateInput["handlers"],
): StructuralUnitOutcome {
  try {
    assertSnapshotInventory(handlerNames, handlers);
    return passedUnit("spec", "spec", "spec.json");
  } catch (error) {
    return failedUnit("spec", "spec", "spec.json", errorMessage(error));
  }
}

function structuralItemOutcome(input: CapabilityGateInput): StructuralUnitOutcome {
  try {
    assertItemRendererExportShape(input.itemRenderer);
    const fieldAccessFailure = checkItemRendererFieldAccess(input.spec, input.itemRenderer);
    if (fieldAccessFailure) throw new Error(fieldAccessFailure);
    const rendererFailure = typeCheckItemRenderer(input.itemRenderer);
    if (rendererFailure) throw new Error(rendererFailure);
    return passedUnit("item-renderer", "item", "item.ts");
  } catch (error) {
    return failedUnit("item-renderer", "item", "item.ts", errorMessage(error));
  }
}

function structuralHandlerOutcome(
  input: CapabilityGateInput,
  name: HandlerUnitName,
  typeFailure: string | undefined,
): StructuralUnitOutcome {
  try {
    assertHandlerExportShape(input, name);
    if (typeFailure) throw new Error(typeFailure);
    return passedUnit("handler", name, `${name}.ts`);
  } catch (error) {
    return failedUnit("handler", name, `${name}.ts`, errorMessage(error));
  }
}

function passedUnit(
  kind: StructuralUnitOutcome["kind"],
  name: StructuralUnitOutcome["name"],
  filename: StructuralUnitOutcome["filename"],
): StructuralUnitOutcome {
  return { kind, name, filename, status: "passed" };
}

function failedUnit(
  kind: StructuralUnitOutcome["kind"],
  name: StructuralUnitOutcome["name"],
  filename: StructuralUnitOutcome["filename"],
  error: string,
): StructuralUnitOutcome {
  return { kind, name, filename, status: "failed", error };
}

function assertHandlerExportShape(input: CapabilityGateInput, name: HandlerUnitName): void {
  const content = input.handlers[name] ?? "";
  assertDefaultFunctionSource(`handler "${name}"`, content, { async: true });
  const contractFailure = checkHandlerSourceContract(
    input.spec,
    name,
    content,
    (input.scratchCatalog ?? []).map(({ spec: dependencySpec, incarnationId }) => ({
      spec: dependencySpec,
      incarnation_id: incarnationId,
    })),
  );
  if (contractFailure) throw new Error(`Generated handler "${name}" failed: ${contractFailure}`);
}

function assertSnapshotInventory(
  handlerNames: readonly HandlerUnitName[],
  handlers: Readonly<Partial<Record<HandlerUnitName, string>>>,
): void {
  const declared = new Set<string>(handlerNames);
  const missing = handlerNames.filter((name) => !(name in handlers));
  const unexpected = Object.keys(handlers)
    .filter((name) => !declared.has(name))
    .sort();
  if (missing.length > 0 || unexpected.length > 0) {
    const differences = [
      ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
      ...(unexpected.length > 0 ? [`unexpected: ${unexpected.join(", ")}`] : []),
    ];
    throw new Error(
      `Generated snapshot Handler inventory does not match the spec (${differences.join("; ")}).`,
    );
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

function typeCheckHandlerUnits(
  handlerNames: readonly HandlerUnitName[],
  handlers: Readonly<Partial<Record<HandlerUnitName, string>>>,
): ReadonlyMap<HandlerUnitName, string> {
  const dir = mkdtempSync(join(tmpdir(), "aluna-gate-typecheck-"));
  try {
    writeFileSync(join(dir, "contract.d.ts"), handlerContractDeclarations);
    for (const name of handlerNames) {
      writeFileSync(join(dir, `${name}.ts`), handlers[name] ?? "");
      const suffix = `${name[0]?.toUpperCase()}${name.slice(1)}`;
      const binding = `handler${suffix}`;
      const assertion = `assert${suffix}`;
      writeFileSync(
        join(dir, `${name}.assert.ts`),
        [
          `import ${binding} from "./${name}.ts";`,
          `const ${assertion}: ${handlerContractType(name)} = ${binding};`,
          `void ${assertion};`,
        ].join("\n"),
      );
    }

    const program = ts.createProgram(
      [
        join(dir, "contract.d.ts"),
        ...handlerNames.map((name) => join(dir, `${name}.ts`)),
        ...handlerNames.map((name) => join(dir, `${name}.assert.ts`)),
      ],
      STRICT_CHECK_OPTIONS,
    );
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const failures = new Map<HandlerUnitName, string>();
    for (const name of handlerNames) {
      const unitDiagnostics = diagnostics.filter((diagnostic) =>
        diagnosticAppliesToHandler(diagnostic, name),
      );
      if (unitDiagnostics.length > 0) failures.set(name, formatDiagnostics(unitDiagnostics));
    }
    return failures;
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function diagnosticAppliesToHandler(diagnostic: ts.Diagnostic, name: HandlerUnitName): boolean {
  const filename = diagnostic.file?.fileName;
  return !filename || filename.endsWith(`/${name}.ts`) || filename.endsWith(`/${name}.assert.ts`);
}

function handlerContractType(action: HandlerUnitName): string {
  if (action === "create") return "CapabilityCreateHandler";
  if (action === "update") return "CapabilityUpdateHandler";
  if (action === "delete") return "CapabilityDeleteHandler";
  return "CapabilityReadHandler";
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
interface CapabilityRecordHandle { readonly __opaqueCapabilityRecord?: never; }
interface CapabilityActionRecord {
  readonly fields: Readonly<Record<string, CapabilityDataColumnValue>>;
  readonly created_at: string;
  readonly handle: CapabilityRecordHandle;
}
type PresentationAdapter = (record: CapabilityActionRecord) => string;
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
  create(values: Record<string, unknown>): CapabilityActionRecord;
}
interface CapabilityUpdateMutationPort {
  update(values: Record<string, unknown>): CapabilityActionRecord;
}
interface CapabilityDeleteMutationPort {
  delete(): void;
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
  records(input: {
    readonly sql: string;
    readonly parameters?: readonly CapabilityQueryParameter[];
    readonly targetIdAlias?: string;
    readonly result?: readonly CapabilityQueryResultColumn[];
  }): readonly {
    readonly record: CapabilityActionRecord;
    readonly values: Readonly<Record<string, CapabilityDataColumnValue>>;
  }[];
}
interface CapabilityContext {
  readonly input: CapabilityInput;
  readonly query: CapabilityQueryPort;
  readonly present: PresentationAdapter;
}
interface CapabilityCreateContext extends CapabilityContext {
  readonly mutation: CapabilityMutationPort;
}
interface CapabilityUpdateContext extends CapabilityContext {
  readonly mutation: CapabilityUpdateMutationPort;
}
interface CapabilityDeleteContext {
  readonly input: CapabilityInput;
  readonly mutation: CapabilityDeleteMutationPort;
  readonly query: CapabilityQueryPort;
}
type CapabilityCreateHandler = (context: CapabilityCreateContext) => Promise<string>;
type CapabilityReadHandler = (context: CapabilityContext) => Promise<string>;
type CapabilityUpdateHandler = (context: CapabilityUpdateContext) => Promise<string>;
type CapabilityDeleteHandler = (context: CapabilityDeleteContext) => Promise<string>;
`;

// The item-renderer contract — one record → its inner markup string (mirrors the
// presentation adapter's `ItemRenderer`).
const itemRendererContractDeclarations = `${recordContractDeclarations}
type ItemRenderer = (record: PresentableRecord) => string;
`;
