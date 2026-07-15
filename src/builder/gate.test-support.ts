// Shared fixtures and helpers for the capability-gate test suites (Epic 2.5, issue 05).
//
// Extracted verbatim from the original gate.test.ts so the split suites share one
// source of truth. `.test-support.ts` is not discovered as a test file by bun.

import { expect } from "bun:test";
import { type ZodType, z } from "zod";

import {
  createCapabilityDataPorts,
  deriveCapabilityTableDdl,
  selectCapabilityRows,
} from "../capability-data/index.ts";
import type { PlatformDatabase } from "../db.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { CapabilityGateError, runCapabilityGate } from "./gate.ts";
import type { HandlerUnitName } from "./units.ts";

export function createCapabilityDataTool(spec: CapabilitySpec, databases: PlatformDatabase) {
  const { mutation, query } = createCapabilityDataPorts(spec, databases);
  return { insert: mutation.create, select: () => selectCapabilityRows(spec, query) };
}

export function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
      detail: { shows: ["text"] },
    },
    behavior: "Text is required. Newest notes appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    read_dependencies: { create: [], read: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

// The handlers render records through the injected `present` adapter (ADR-0005 §2), so
// the smoke and behavioral rungs exercise the real adapter path — create and read cannot
// drift. `text: input.values.text,` is kept verbatim so the trim test can patch it.
export const CREATE_HANDLER = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  "  const note = mutation.create({",
  "    text: input.values.text,",
  '    pinned: input.values.pinned === "on" || input.values.pinned === "true",',
  "  });",
  "  return present(note);",
  "}",
].join("\n");

export const READ_HANDLER = [
  "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
  "  const notes = query.all({",
  '    sql: \'SELECT * FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
  '    result: [{ alias: "id", type: "string" }, { alias: "created_at", type: "datetime" }, { alias: "text", type: "string" }, { alias: "pinned", type: "boolean" }],',
  "  });",
  '  return notes.map((note) => present(note)).join("");',
  "}",
].join("\n");

// A spec-specific conforming renderer. Every test fixture reads only the exact fields
// declared by item.shows, matching the generated-unit contract the Gate enforces.
export function itemRendererFor(spec: CapabilitySpec): string {
  const values = spec.ui_intent.item.shows.map((field) => `record.${field}`).join(", ");
  return [
    "export default function renderItem(record: Record<string, unknown>): string {",
    `  const parts = [${values}].map((value) => escapeHtml(value));`,
    '  return `<div class="stack">$' + '{parts.join(" ")}</div>`;',
    "}",
    "",
    "function escapeHtml(value: unknown): string {",
    '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
    "}",
  ].join("\n");
}

export const GOOD_HANDLERS: Readonly<Record<HandlerUnitName, string>> = {
  create: CREATE_HANDLER,
  read: READ_HANDLER,
};

export function articlesSpec(): CapabilitySpec {
  return notesSpec({
    id: "articles",
    label: "Articles",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
        { name: "body", label: "Body", type: "string", required: true, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [] },
      item: {
        direction: "A text-forward card that emphasizes the article title.",
        shows: ["title", "body"],
      },
      collection: { layout: "feed" },
      detail: { shows: ["title", "body"] },
    },
    behavior: "Title and body are required. Newest articles appear first.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["title", "body"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    prompt_context: "Stores the user's article drafts.",
  });
}

export const MARKED_ARTICLE_CREATE_HANDLER = [
  "export default async function create({ input, mutation }: CapabilityCreateContext): Promise<string> {",
  '  const missing = ["title", "body"].filter((field) => String(input.values[field] ?? "").trim().length === 0);',
  "  if (missing.length > 0) {",
  '    return `<div class="notice" data-role="error" data-error-code="missing_required_fields" data-error-fields="$' +
    '{missing.join(" ")}">I need a little more before I can save this.</div>`;',
  "  }",
  "  const article = mutation.create({ title: input.values.title, body: input.values.body });",
  "  return `<article><h3>$" +
    "{escapeHtml(article.title)}</h3><p>$" +
    "{escapeHtml(article.body)}</p></article>`;",
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

export const ARTICLE_READ_HANDLER = [
  "export default async function read({ query }: CapabilityContext): Promise<string> {",
  "  const articles = query.all({",
  '    sql: \'SELECT * FROM "cap_articles" ORDER BY "created_at" DESC, "id" DESC\',',
  '    result: [{ alias: "id", type: "string" }, { alias: "created_at", type: "datetime" }, { alias: "title", type: "string" }, { alias: "body", type: "string" }],',
  "  });",
  "  const items = articles",
  "    .map((article) => `<article><h3>$" +
    "{escapeHtml(article.title)}</h3><p>$" +
    "{escapeHtml(article.body)}</p></article>`)",
  '    .join("");',
  '  return `<section class="articles">$' + "{items}</section>`;",
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  "  return String(value)",
  '    .replaceAll("&", "&amp;")',
  '    .replaceAll("<", "&lt;")',
  '    .replaceAll(">", "&gt;")',
  '    .replaceAll(\'"\', "&quot;")',
  '    .replaceAll("\'", "&#39;");',
  "}",
].join("\n");

export const ARTICLE_HANDLERS: Readonly<Record<HandlerUnitName, string>> = {
  create: MARKED_ARTICLE_CREATE_HANDLER,
  read: ARTICLE_READ_HANDLER,
};

export const DEFAULT_BEHAVIORAL_SUITE = {
  cases: [
    {
      name: "stores and renders note text",
      setupRows: [],
      input: [
        { field: "text", value: "Behavioral note" },
        { field: "pinned", value: "false" },
      ],
      expectedCreatedRow: [
        { field: "text", value: "Behavioral note" },
        { field: "pinned", value: false },
      ],
      expectedRowCount: 1,
      expectCreateFragmentIncludes: ["Behavioral note"],
      expectReadFragmentIncludes: ["Behavioral note"],
      expectReadFragmentIncludesInOrder: [],
      expectedError: null,
    },
  ],
};

export const MULTI_REQUIRED_VALIDATION_SUITE = {
  cases: [
    {
      name: "missing title and body emits stable validation markers",
      setupRows: [],
      input: [],
      expectedCreatedRow: [],
      expectedRowCount: 0,
      expectCreateFragmentIncludes: [],
      expectReadFragmentIncludes: [],
      expectReadFragmentIncludesInOrder: [],
      expectedError: {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["title", "body"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    },
  ],
};

export function makeBehaviorProvider(suite: unknown = DEFAULT_BEHAVIORAL_SUITE): {
  provider: Provider;
  prompts: string[];
  jsonSchemas: unknown[];
} {
  const prompts: string[] = [];
  const jsonSchemas: unknown[] = [];
  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      jsonSchemas.push(z.toJSONSchema(_schema));
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield suite as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(suite as T),
        usage: Promise.resolve({ inputTokens: 7, outputTokens: 11, totalTokens: 18 }),
      };
    },
  };
  return { provider, prompts, jsonSchemas };
}

export function gateInput(
  overrides: Partial<Parameters<typeof runCapabilityGate>[0]> = {},
): Parameters<typeof runCapabilityGate>[0] {
  const spec = overrides.spec ?? notesSpec();
  const { provider } = makeBehaviorProvider();
  return {
    spec,
    ddl: overrides.ddl ?? deriveCapabilityTableDdl(spec),
    handlers: GOOD_HANDLERS,
    itemRenderer: overrides.itemRenderer ?? itemRendererFor(spec),
    provider,
    ...overrides,
  };
}

export async function expectGateFailure(
  input: Parameters<typeof runCapabilityGate>[0],
): Promise<CapabilityGateError> {
  try {
    await runCapabilityGate(input);
  } catch (error) {
    expect(error).toBeInstanceOf(CapabilityGateError);
    return error as CapabilityGateError;
  }

  throw new Error("expected gate to fail");
}
