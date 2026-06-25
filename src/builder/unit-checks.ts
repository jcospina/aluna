// Per-unit static checks — the deterministic verdict on a freshly generated unit,
// run inside the fix loop before a unit is accepted.
//
// Handlers are checked for the ADR-0004 artifact contract (one default async export,
// no imports, no raw HTTP, no table names) and type-checked in isolation against the
// platform-authored handler contract; views are checked for data-free scaffolding
// and the fixed router convention. A returned message becomes the failure fed back
// into the next attempt's prompt.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

import type { CapabilitySpec } from "../registry/index.ts";
import type {
  HandlerUnitName,
  UnitDescriptor,
  UnitGenerationFailure,
  ViewUnitName,
} from "./units.ts";

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
      ? checkHandlerUnit(spec, unit.name, content)
      : checkViewUnit(spec, unit.name, content);

  return message ? { ...unit, message } : undefined;
}

function checkHandlerUnit(
  spec: CapabilitySpec,
  action: HandlerUnitName | ViewUnitName,
  content: string,
): string | undefined {
  const source = ts.createSourceFile(`${action}.ts`, content, ts.ScriptTarget.Latest, true);
  const exportMessage = validateHandlerExports(source);
  if (exportMessage) return exportMessage;
  if (source.statements.some((statement) => ts.isImportDeclaration(statement))) {
    return "Generated handlers must not import anything.";
  }
  if (/\b(fetch|Request|Response|Headers|XMLHttpRequest)\b|https?:\/\//.test(content)) {
    return "Generated handlers must not touch raw HTTP.";
  }
  if (new RegExp(`\\bcap_${escapeRegExp(spec.id)}\\b|\\bcap_[a-z0-9_]+\\b`).test(content)) {
    return "Generated handlers must not name capability tables.";
  }

  return typeCheckHandler(content);
}

function validateHandlerExports(source: ts.SourceFile): string | undefined {
  const exported = source.statements.filter(hasExportSurface);
  if (exported.length !== 1) {
    return "Generated handlers must have exactly one export: the default async function.";
  }

  const [statement] = exported;
  if (!statement || !ts.isFunctionDeclaration(statement)) {
    return "Generated handlers must default-export an async function declaration.";
  }
  const modifiers = ts.getModifiers(statement) ?? [];
  const hasDefault = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
  const hasAsync = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  if (!hasDefault || !hasAsync) {
    return "Generated handlers must use `export default async function`.";
  }
  if (statement.parameters.length !== 1) {
    return "Generated handlers must receive one platform-built context parameter.";
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

function typeCheckHandler(content: string): string | undefined {
  const dir = mkdtempSync(join(tmpdir(), "aluna-handler-check-"));
  try {
    writeFileSync(join(dir, "contract.d.ts"), handlerContractDeclarations);
    writeFileSync(join(dir, "unit.ts"), content);
    writeFileSync(
      join(dir, "assert.ts"),
      'import handler from "./unit";\nconst assertHandler: CapabilityHandler = handler;\nvoid assertHandler;\n',
    );

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

    return formatDiagnostics(diagnostics);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function checkViewUnit(
  spec: CapabilitySpec,
  view: HandlerUnitName | ViewUnitName,
  content: string,
): string | undefined {
  const lower = content.toLowerCase();
  if (lower.includes("<script")) return "Generated views must not contain scripts.";
  if (content.includes("{{") || content.includes("${")) {
    return "Generated views must not contain template or interpolation placeholders.";
  }
  if (/\bdata-id\s*=|\bcreated_at\b/.test(content)) {
    return "Generated views must not contain user record data.";
  }

  return view === "list" ? checkListView(spec, content) : checkCreateView(spec, content);
}

function checkListView(spec: CapabilitySpec, content: string): string | undefined {
  if (!content.includes(`hx-get="/capability/${spec.id}/read"`)) {
    return `The list view must load live data with hx-get="/capability/${spec.id}/read".`;
  }
  if (/<(li|article|tbody|tr)\b/i.test(content)) {
    return "The list view must not bake row markup into the cached view.";
  }
  return undefined;
}

function checkCreateView(spec: CapabilitySpec, content: string): string | undefined {
  if (!/<form\b/i.test(content)) return "The create view must contain a form.";
  if (!content.includes(`hx-post="/capability/${spec.id}/create"`)) {
    return `The create view form must submit with hx-post="/capability/${spec.id}/create".`;
  }

  for (const field of spec.schema.fields) {
    if (!new RegExp(`\\bname=["']${escapeRegExp(field.name)}["']`).test(content)) {
      return `The create view must include a control named "${field.name}".`;
    }
  }
  return undefined;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
