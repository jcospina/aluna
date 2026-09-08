// How a generated unit is type-checked: the contract it is checked against, the compiler it is
// checked under, and the two readings of the result.
//
// `src/runtime/router/contract.ts` declares the real types; a generated Handler is compiled alone,
// with no imports, so the checker needs them as declaration text. Two stages need that text — the
// unit safety check and the Gate's structural rung — and they used to hold a copy each. When the
// real contract gained a field, three places had to change, and missing one let the rung accept
// source the router rejects at dispatch.

import ts from "typescript";

import { fieldTypeSchema } from "../registry/index.ts";
import type { HandlerUnitName } from "./units/generation/units.ts";

/** The strict compiler every generated unit is checked under. */
export const STRICT_CHECK_OPTIONS: ts.CompilerOptions = {
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

/**
 * The query-result column types, derived from the registry pantry rather than restated: a mirror
 * missing a new field type would reject a projection the runtime accepts.
 */
const QUERY_RESULT_TYPE_UNION = fieldTypeSchema.options
  .map((type) => JSON.stringify(type))
  .join(" | ");

/** Format TypeScript diagnostics with file:line:col positions for a stage's report. */
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

/** Whether a statement exports anything — the check for "exactly one exported statement". */
export function hasExportSurface(statement: ts.Statement): boolean {
  if (ts.isExportAssignment(statement) || ts.isExportDeclaration(statement)) return true;
  if (!ts.canHaveModifiers(statement)) return false;
  return (ts.getModifiers(statement) ?? []).some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
  );
}

const RECORD_CONTRACT_DECLARATIONS = `
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

// The handler contract, including ADR-0005 §2's injected `present` adapter — the shape
// `src/runtime/router/contract.ts` declares and the gate's structural rung re-checks.
export const HANDLER_CONTRACT_DECLARATIONS = `${RECORD_CONTRACT_DECLARATIONS}
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
  readonly type: ${QUERY_RESULT_TYPE_UNION};
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

export function handlerContractType(action: HandlerUnitName): string {
  if (action === "create") return "CapabilityCreateHandler";
  if (action === "update") return "CapabilityUpdateHandler";
  if (action === "delete") return "CapabilityDeleteHandler";
  return "CapabilityReadHandler";
}

// The item-renderer contract: one record → its inner markup string (the composition
// input the presentation adapter binds, src/presentation/records/adapter.ts `ItemRenderer`).
export const ITEM_RENDERER_CONTRACT_DECLARATIONS = `${RECORD_CONTRACT_DECLARATIONS}
type ItemRenderer = (record: PresentableRecord) => string;
`;
