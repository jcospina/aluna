// Per-unit static checks — the deterministic verdict on a freshly generated unit,
// run inside the fix loop before a unit is accepted.
//
// Handlers are checked for the ADR-0004 artifact contract (one default async export,
// no imports, no raw HTTP or mutation SQL) and type-checked in isolation against the
// platform-authored handler contract — which, since ADR-0005 §2, carries the injected
// `present` adapter. The item renderer is checked for its own contract (one default,
// synchronous function export, no imports) and type-checked against the `ItemRenderer`
// shape the presentation adapter binds. A returned message becomes the failure fed back
// into the next attempt's prompt. (Off-token styling / unknown classes / executable
// markup are the design-lint gate rung's job in 3.6, not this type-check loop.)

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import type { CapabilitySpec } from "../registry/index.ts";
import { checkItemRendererFieldAccess } from "./item-field-access.ts";
import type { HandlerUnitName, UnitDescriptor, UnitGenerationFailure } from "./units.ts";

/**
 * Check a generated unit's content against its kind's contract. Returns a
 * failure (the unit descriptor plus a fix message) when it does not conform, or
 * `undefined` when the unit passes.
 */
export function checkGeneratedUnit(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  content: string,
): UnitGenerationFailure | undefined {
  const message =
    unit.kind === "handler"
      ? checkHandlerUnit(unit.name, content)
      : checkItemRendererUnit(spec, content);

  return message ? { ...unit, message } : undefined;
}

function checkHandlerUnit(action: HandlerUnitName, content: string): string | undefined {
  const source = ts.createSourceFile(`${action}.ts`, content, ts.ScriptTarget.Latest, true);
  const exportMessage = validateDefaultFunctionExport(source, { async: true });
  if (exportMessage) return exportMessage;
  if (source.statements.some((statement) => ts.isImportDeclaration(statement))) {
    return "Generated handlers must not import anything.";
  }
  if (/\b(fetch|Request|Response|Headers|XMLHttpRequest)\b|https?:\/\//.test(content)) {
    return "Generated handlers must not touch raw HTTP.";
  }
  if (
    /\b(?:INSERT\s+INTO|UPDATE\s+[^\s]+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i.test(
      content,
    )
  ) {
    return "Generated handlers must not contain raw mutation SQL.";
  }

  return typeCheckUnit(content, handlerContractDeclarations, handlerAssert(action));
}

function checkItemRendererUnit(spec: CapabilitySpec, content: string): string | undefined {
  const source = ts.createSourceFile("item.ts", content, ts.ScriptTarget.Latest, true);
  const exportMessage = validateDefaultFunctionExport(source, { async: false });
  if (exportMessage) return exportMessage;
  if (source.statements.some((statement) => ts.isImportDeclaration(statement))) {
    return "The item renderer must not import anything — it composes one record into markup and nothing else.";
  }
  const fieldAccessMessage = checkItemRendererFieldAccess(spec, content);
  if (fieldAccessMessage) return fieldAccessMessage;

  return typeCheckUnit(content, itemRendererContractDeclarations, ITEM_RENDERER_ASSERT);
}

interface ExportShapeRules {
  /** Whether the default function must be `async` (handlers) or must not be (item renderer). */
  readonly async: boolean;
}

/**
 * Validate that a unit default-exports a single function of the required async-ness with
 * exactly one parameter — the shape both the handler contract and the item renderer share
 * (the item renderer is synchronous, the handler async). Returns a fix message or
 * `undefined`.
 */
function validateDefaultFunctionExport(
  source: ts.SourceFile,
  rules: ExportShapeRules,
): string | undefined {
  const subject = rules.async ? "handlers" : "the item renderer";
  const exported = source.statements.filter(hasExportSurface);
  if (exported.length !== 1) {
    return `Generated ${subject} must have exactly one export: the default function.`;
  }

  const [statement] = exported;
  if (!statement || !ts.isFunctionDeclaration(statement)) {
    return `Generated ${subject} must default-export a function declaration.`;
  }
  const modifierMessage = validateFunctionModifiers(statement, rules);
  if (modifierMessage) return modifierMessage;
  if (statement.parameters.length !== 1) {
    return `Generated ${subject} must receive exactly one parameter.`;
  }

  return undefined;
}

/** Assert the default/async modifiers on the exported function match the unit's rules. */
function validateFunctionModifiers(
  statement: ts.FunctionDeclaration,
  rules: ExportShapeRules,
): string | undefined {
  const modifiers = ts.getModifiers(statement) ?? [];
  const hasDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  const hasAsync = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!hasDefault) {
    return `Generated ${rules.async ? "handlers" : "the item renderer"} must use \`export default function\`.`;
  }
  if (rules.async && !hasAsync) {
    return "Generated handlers must use `export default async function`.";
  }
  if (!rules.async && hasAsync) {
    return "The item renderer must be synchronous: use `export default function`, not `async function`.";
  }
  return undefined;
}

function hasExportSurface(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) return true;
  if (!ts.canHaveModifiers(statement)) return false;
  return (ts.getModifiers(statement) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

/**
 * Type-check one generated unit in isolation: write the platform contract declarations,
 * the unit, and an assertion that binds the unit's default export to the contract type,
 * then run the strict compiler over the three. Returns a formatted diagnostic message or
 * `undefined` when it type-checks clean.
 */
function typeCheckUnit(
  content: string,
  contractDeclarations: string,
  assertSource: string,
): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "aluna-unit-check-"));
  try {
    writeFileSync(join(dir, "contract.d.ts"), contractDeclarations);
    writeFileSync(join(dir, "unit.ts"), content);
    writeFileSync(join(dir, "assert.ts"), assertSource);

    const program = ts.createProgram(
      [join(dir, "contract.d.ts"), join(dir, "unit.ts"), join(dir, "assert.ts")],
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
    if (diagnostics.length === 0) return undefined;

    return [
      "Generated code is type-checked with strict TypeScript and noUncheckedIndexedAccess.",
      "Do not return array indexes, regex captures, or string match groups without first narrowing or providing a fallback.",
      formatDiagnostics(diagnostics),
    ].join("\n");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
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

// The shared record shape both contracts speak — the capability data row seen
// structurally (spec fields plus the platform-populated `id`/`created_at`).
const RECORD_CONTRACT = `
type CapabilityDataColumnValue = string | number | boolean | readonly string[] | null;
interface CapabilityDataRow {
  readonly id: string;
  readonly created_at: string;
  readonly [field: string]: CapabilityDataColumnValue;
}
type PresentableRecord = Readonly<Record<string, unknown>>;
type PresentationAdapter = (record: PresentableRecord) => string;
`;

// The handler contract, including ADR-0005 §2's injected `present` adapter — the same
// shape src/router/contract.ts declares (CapabilityContext) and the gate's structural
// rung re-checks against.
const handlerContractDeclarations = `${RECORD_CONTRACT}
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

function handlerAssert(action: HandlerUnitName): string {
  const type = action === "create" ? "CapabilityCreateHandler" : "CapabilityReadHandler";
  return `import handler from "./unit";\nconst assertHandler: ${type} = handler;\nvoid assertHandler;\n`;
}

// The item-renderer contract: one record → its inner markup string (the composition
// input the presentation adapter binds, src/presentation/adapter.ts `ItemRenderer`).
const itemRendererContractDeclarations = `${RECORD_CONTRACT}
type ItemRenderer = (record: PresentableRecord) => string;
`;

const ITEM_RENDERER_ASSERT =
  'import renderItem from "./unit";\nconst assertRenderer: ItemRenderer = renderItem;\nvoid assertRenderer;\n';
