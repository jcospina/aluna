// Unit generation — Module 2, Epic 2.5 (ARCH §6.2 "Capability Builder" step 3,
// ADR-0003 bounded tool-loop, ADR-0004 generated artifact contract).
//
// This stage derives the four M2 artifacts from the validated capability spec:
// `create` + `read` handlers and `list` + `create` views. Generation is agentic
// only inside one unit at a time: write -> check -> feed back the failure -> fix,
// capped by a small config knob. Across units the order and scope are fixed.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { z } from "zod";

import type { DeepPartial, Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilitySpec, CapabilityTool, SpecView } from "../registry/index.ts";

export const DEFAULT_UNIT_FIX_ATTEMPTS = 2;

const HANDLER_UNITS = ["create", "read"] as const satisfies readonly CapabilityTool[];
const VIEW_UNITS = ["list", "create"] as const satisfies readonly SpecView[];
const generatedUnitSchema = z.strictObject({ content: z.string().min(1) });
type GeneratedUnitObject = z.infer<typeof generatedUnitSchema>;

export type HandlerUnitName = (typeof HANDLER_UNITS)[number];
export type ViewUnitName = (typeof VIEW_UNITS)[number];

export type GeneratedUnit =
  | {
      readonly kind: "handler";
      readonly name: HandlerUnitName;
      readonly filename: `${HandlerUnitName}.ts`;
      readonly content: string;
      readonly attempts: readonly UnitGenerationAttempt[];
      readonly durationMs: number;
      readonly usage: TokenUsage;
    }
  | {
      readonly kind: "view";
      readonly name: ViewUnitName;
      readonly filename: `${ViewUnitName}.html`;
      readonly content: string;
      readonly attempts: readonly UnitGenerationAttempt[];
      readonly durationMs: number;
      readonly usage: TokenUsage;
    };

export interface UnitGenerationAttempt {
  readonly attempt: number;
  readonly durationMs: number;
  readonly usage: TokenUsage;
  readonly error?: string;
}

export interface GenerateCapabilityUnitsInput {
  readonly provider: Provider;
  readonly spec: CapabilitySpec;
  // Config knob from PLAN decision 5. Defaults to two attempts: the initial write
  // plus one fix pass.
  readonly maxAttempts?: number;
  readonly observer?: UnitGenerationObserver;
}

export interface GenerateCapabilityUnitsResult {
  readonly units: readonly GeneratedUnit[];
  readonly handlers: Readonly<Record<HandlerUnitName, string>>;
  readonly views: Readonly<Record<ViewUnitName, string>>;
}

export type UnitDescriptor =
  | { readonly kind: "handler"; readonly name: HandlerUnitName }
  | { readonly kind: "view"; readonly name: ViewUnitName };

type UnitGenerationFailure = UnitDescriptor & { readonly message: string };

export interface UnitGenerationStartEvent {
  readonly unit: UnitDescriptor;
  readonly attempt: number;
}

export interface UnitGenerationPartialEvent {
  readonly unit: UnitDescriptor;
  readonly attempt: number;
  readonly content: string;
}

export interface UnitGenerationAttemptEvent {
  readonly unit: UnitDescriptor;
  readonly attempt: UnitGenerationAttempt;
}

export interface UnitGenerationObserver {
  readonly onUnitStart?: (event: UnitGenerationStartEvent) => void | Promise<void>;
  readonly onUnitPartial?: (event: UnitGenerationPartialEvent) => void | Promise<void>;
  readonly onUnitAttempt?: (event: UnitGenerationAttemptEvent) => void | Promise<void>;
  readonly onUnitGenerated?: (unit: GeneratedUnit) => void | Promise<void>;
}

export class UnitGenerationError extends Error {
  override readonly name = "UnitGenerationError";
  readonly unit: UnitDescriptor;
  readonly attempts: readonly UnitGenerationAttempt[];

  constructor(unit: UnitDescriptor, attempts: readonly UnitGenerationAttempt[]) {
    super(
      `Generated ${unit.kind} "${unit.name}" did not pass after ${attempts.length} attempt(s).`,
    );
    this.unit = unit;
    this.attempts = attempts;
  }
}

export async function generateCapabilityUnits(
  input: GenerateCapabilityUnitsInput,
): Promise<GenerateCapabilityUnitsResult> {
  assertM2UnitSpec(input.spec);
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts);
  const units: GeneratedUnit[] = [];

  for (const action of HANDLER_UNITS) {
    units.push(
      await generateUnit(
        input.provider,
        input.spec,
        { kind: "handler", name: action },
        maxAttempts,
        input.observer,
      ),
    );
  }

  for (const view of VIEW_UNITS) {
    units.push(
      await generateUnit(
        input.provider,
        input.spec,
        { kind: "view", name: view },
        maxAttempts,
        input.observer,
      ),
    );
  }

  return {
    units,
    handlers: {
      create: contentFor(units, "handler", "create"),
      read: contentFor(units, "handler", "read"),
    },
    views: {
      list: contentFor(units, "view", "list"),
      create: contentFor(units, "view", "create"),
    },
  };
}

export function buildUnitPrompt(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  previousFailure?: UnitGenerationFailure,
): string {
  const base =
    unit.kind === "handler"
      ? buildHandlerPrompt(spec, unit.name)
      : buildViewPrompt(spec, unit.name);

  if (!previousFailure) return base;

  return [
    base,
    "",
    "Previous attempt failed. Return a complete corrected unit, not a patch.",
    "Failure to fix:",
    previousFailure.message,
  ].join("\n");
}

async function generateUnit(
  provider: Provider,
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  maxAttempts: number,
  observer: UnitGenerationObserver | undefined,
): Promise<GeneratedUnit> {
  const attempts: UnitGenerationAttempt[] = [];
  let previousFailure: UnitGenerationFailure | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await observer?.onUnitStart?.({ unit, attempt });
    const startedAt = performance.now();
    const result = provider.generate(
      buildUnitPrompt(spec, unit, previousFailure),
      generatedUnitSchema,
    );
    const partialsSettled = observeUnitPartials(unit, attempt, result.partialStream, observer);
    const generated = generatedUnitSchema.parse(await result.object);
    await partialsSettled;
    const usage = await result.usage;
    const durationMs = performance.now() - startedAt;
    const failure = checkGeneratedUnit(spec, unit, generated.content);
    const attemptRecord = {
      attempt,
      durationMs,
      usage,
      ...(failure ? { error: failure.message } : {}),
    };
    attempts.push(attemptRecord);
    await observer?.onUnitAttempt?.({ unit, attempt: attemptRecord });

    if (!failure) {
      const generatedUnit = toGeneratedUnit(unit, generated.content, attempts);
      await observer?.onUnitGenerated?.(generatedUnit);
      return generatedUnit;
    }

    previousFailure = failure;
  }

  throw new UnitGenerationError(unit, attempts);
}

async function observeUnitPartials(
  unit: UnitDescriptor,
  attempt: number,
  partialStream: AsyncIterable<DeepPartial<GeneratedUnitObject>>,
  observer: UnitGenerationObserver | undefined,
): Promise<void> {
  if (!observer?.onUnitPartial) return;

  for await (const partial of partialStream) {
    if (typeof partial.content === "string") {
      await observer.onUnitPartial({ unit, attempt, content: partial.content });
    }
  }
}

function buildHandlerPrompt(spec: CapabilitySpec, action: HandlerUnitName): string {
  const fields = spec.schema.fields
    .map(
      (field) => `- ${field.name}: ${field.type}${field.required ? " (required)" : " (optional)"}`,
    )
    .join("\n");

  return [
    `Generate the ${action}.ts handler for this Aluna capability.`,
    "",
    "Return one structured object with a single `content` string containing the complete TypeScript file.",
    "",
    "Hard contract:",
    "- No imports.",
    "- No raw HTTP: no Request, Response, Headers, or fetch.",
    "- No table names or SQL. Use only the injected `data` tool.",
    "- Exactly one export: `export default async function ...`.",
    "- The function receives one `CapabilityContext` parameter and returns `Promise<string>`.",
    "- It returns an HTML fragment string.",
    "- Include any escaping helper locally in the file.",
    "",
    "Available global types in the isolated type-check:",
    "- `CapabilityContext` has `{ input, data }`.",
    "- `input` is a flat record of form/query strings.",
    "- `data.insert(values)` returns the inserted row.",
    "- `data.select()` returns rows ordered newest first.",
    "",
    "Action behavior:",
    action === "create"
      ? "- Coerce form strings into the spec field types, call `data.insert`, and return a fragment for the new row."
      : "- Call `data.select()` and return a fragment for the current rows, including a helpful empty state.",
    "",
    "Spec fields:",
    fields,
    "",
    "Capability spec JSON:",
    JSON.stringify(spec, null, 2),
  ].join("\n");
}

function buildViewPrompt(spec: CapabilitySpec, view: ViewUnitName): string {
  const fieldControls = spec.schema.fields
    .map(
      (field) => `- ${field.name}: ${field.type}${field.required ? " (required)" : " (optional)"}`,
    )
    .join("\n");

  return [
    `Generate the ${view}.html view for this Aluna capability.`,
    "",
    "Return one structured object with a single `content` string containing the complete HTML fragment.",
    "",
    "Hard contract:",
    "- Data-free scaffolding only. Do not include sample rows, record ids, created_at values, or user data.",
    "- No scripts and no template/interpolation placeholders.",
    "- Use the fixed router convention; generated views never invent routes.",
    view === "list"
      ? `- Include one dynamic region that loads through hx-get="/capability/${spec.id}/read".`
      : `- Include one form that submits through hx-post="/capability/${spec.id}/create".`,
    "",
    "Fields for create controls:",
    fieldControls,
    "",
    "Capability spec JSON:",
    JSON.stringify(spec, null, 2),
  ].join("\n");
}

function checkGeneratedUnit(
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

function toGeneratedUnit(
  unit: UnitDescriptor,
  content: string,
  attempts: readonly UnitGenerationAttempt[],
): GeneratedUnit {
  const base = {
    content,
    attempts,
    durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
    usage: sumUsage(attempts.map((attempt) => attempt.usage)),
  };

  if (unit.kind === "handler") {
    const name = unit.name as HandlerUnitName;
    return {
      kind: "handler",
      name,
      filename: `${name}.ts`,
      ...base,
    };
  }

  const name = unit.name as ViewUnitName;
  return {
    kind: "view",
    name,
    filename: `${name}.html`,
    ...base,
  };
}

function contentFor(
  units: readonly GeneratedUnit[],
  kind: "handler",
  name: HandlerUnitName,
): string;
function contentFor(units: readonly GeneratedUnit[], kind: "view", name: ViewUnitName): string;
function contentFor(
  units: readonly GeneratedUnit[],
  kind: GeneratedUnit["kind"],
  name: HandlerUnitName | ViewUnitName,
): string {
  const unit = units.find((candidate) => candidate.kind === kind && candidate.name === name);
  if (!unit) throw new Error(`missing generated ${kind} ${name}`);
  return unit.content;
}

function assertM2UnitSpec(spec: CapabilitySpec): void {
  for (const action of HANDLER_UNITS) {
    if (!(spec.tools as readonly string[]).includes(action)) {
      throw new Error(`M2 unit generation requires the "${action}" handler in spec.tools.`);
    }
  }
  for (const view of VIEW_UNITS) {
    if (!(spec.ui_intent.views as readonly string[]).includes(view)) {
      throw new Error(`M2 unit generation requires the "${view}" view in spec.ui_intent.views.`);
    }
  }
}

function normalizeMaxAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined) return DEFAULT_UNIT_FIX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer.");
  }
  return maxAttempts;
}

function sumUsage(usages: readonly TokenUsage[]): TokenUsage {
  return {
    inputTokens: sumOptional(usages.map((usage) => usage.inputTokens)),
    outputTokens: sumOptional(usages.map((usage) => usage.outputTokens)),
    totalTokens: sumOptional(usages.map((usage) => usage.totalTokens)),
  };
}

function sumOptional(values: readonly (number | undefined)[]): number | undefined {
  let seen = false;
  let sum = 0;
  for (const value of values) {
    if (value !== undefined) {
      seen = true;
      sum += value;
    }
  }
  return seen ? sum : undefined;
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
