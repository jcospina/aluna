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
import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../../registry/index.ts";
import {
  formatDiagnostics,
  HANDLER_CONTRACT_DECLARATIONS,
  handlerContractType,
  hasExportSurface,
  ITEM_RENDERER_CONTRACT_DECLARATIONS,
  STRICT_CHECK_OPTIONS,
} from "../../generated-code-check.ts";
import type {
  HandlerUnitName,
  UnitDescriptor,
  UnitGenerationFailure,
} from "../generation/units.ts";
import {
  checkHandlerSourceSafety,
  type HandlerDependencyCatalogEntry,
} from "./handler-source-safety.ts";
import { checkItemRendererFieldAccess } from "./item-field-access.ts";
import { checkSourceIsolation } from "./source-isolation.ts";

/**
 * Check a generated unit's content against its kind's contract, returning the unit descriptor
 * and a fix message when it does not conform.
 */
export function checkGeneratedUnit(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  content: string,
  dependencyCatalog: readonly CapabilityRow[] = [],
): UnitGenerationFailure | undefined {
  const message =
    unit.kind === "handler"
      ? checkHandlerUnit(
          spec,
          unit.name,
          content,
          dependencyCatalog.map((row) => ({
            spec: capabilitySpecFromRow(row),
            incarnation_id: row.incarnation_id,
          })),
        )
      : checkItemRendererUnit(spec, content);

  return message ? { ...unit, message } : undefined;
}

function checkHandlerUnit(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  content: string,
  dependencyCatalog: readonly HandlerDependencyCatalogEntry[],
): string | undefined {
  const sourceMessage = checkHandlerSourceContract(spec, action, content, dependencyCatalog);
  if (sourceMessage) return sourceMessage;
  return typeCheckUnit(content, HANDLER_CONTRACT_DECLARATIONS, handlerAssert(action));
}

/** The complete static Handler contract shared by unit generation and whole-snapshot Gate. */
export function checkHandlerSourceContract(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  content: string,
  dependencyCatalog: readonly HandlerDependencyCatalogEntry[] = [],
): string | undefined {
  const source = ts.createSourceFile(`${action}.ts`, content, ts.ScriptTarget.Latest, true);
  const exportMessage = validateDefaultFunctionExport(source, { async: true });
  if (exportMessage) return exportMessage;
  return checkHandlerSourceSafety(spec, action, source, dependencyCatalog);
}

function checkItemRendererUnit(spec: CapabilitySpec, content: string): string | undefined {
  const sourceMessage = checkItemRendererSourceContract(spec, content);
  if (sourceMessage) return sourceMessage;
  return typeCheckUnit(content, ITEM_RENDERER_CONTRACT_DECLARATIONS, ITEM_RENDERER_ASSERT);
}

/**
 * The static item-renderer contract, mirroring {@link checkHandlerSourceContract}. Export shape
 * comes first: field access finds the renderer by its declaration, so a bad shape reads clean.
 */
export function checkItemRendererSourceContract(
  spec: CapabilitySpec,
  content: string,
): string | undefined {
  const source = ts.createSourceFile("item.ts", content, ts.ScriptTarget.Latest, true);
  const exportMessage = validateDefaultFunctionExport(source, { async: false });
  if (exportMessage) return exportMessage;
  if (source.statements.some((statement) => ts.isImportDeclaration(statement))) {
    return "The item renderer must not import anything — it composes one record into markup and nothing else.";
  }
  // The same ambient ban the handlers take. The design-lint rung runs the renderer in-process,
  // so a free `process`/`globalThis` made the Gate itself a place to call out from.
  const isolationMessage = checkSourceIsolation(ITEM_RENDERER_ISOLATION_SUBJECT, source);
  if (isolationMessage) return isolationMessage;
  return checkItemRendererFieldAccess(spec, content);
}

/** How the shared isolation refusal names the renderer. */
const ITEM_RENDERER_ISOLATION_SUBJECT = "The item renderer must use only the record it is handed";

interface ExportShapeRules {
  /** Whether the default function must be `async` (handlers) or must not be (item renderer). */
  readonly async: boolean;
}

/**
 * Validate that a unit default-exports one function of the required async-ness with exactly one
 * parameter — the shape the handler contract and the item renderer share.
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

/**
 * Type-check one generated unit in isolation: the platform contract declarations, the unit, and
 * an assertion binding its default export to the contract type, under the strict compiler.
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
      STRICT_CHECK_OPTIONS,
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

function handlerAssert(action: HandlerUnitName): string {
  const type = handlerContractType(action);
  return `import handler from "./unit";\nconst assertHandler: ${type} = handler;\nvoid assertHandler;\n`;
}

const ITEM_RENDERER_ASSERT =
  'import renderItem from "./unit";\nconst assertRenderer: ItemRenderer = renderItem;\nvoid assertRenderer;\n';
