// Shared fixtures and helpers for the capability-gate test suites (Epic 2.5, issue 05).
//
// Extracted verbatim from the original gate.test.ts so the split suites share one
// source of truth. `.test-support.ts` is not discovered as a test file by bun.

// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: the shared Gate fixture builders remain one test-only contract surface.

import { expect } from "bun:test";
import { type ZodType, z } from "zod";

import {
  createCapabilityMutationPort,
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
  materializeCapabilityActionRecord,
  selectCapabilityRows,
} from "../capability-data/index.ts";
import type { PlatformDatabase } from "../db.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import {
  activeSpecFields,
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { CapabilityGateError, runCapabilityGate } from "./gate.ts";
import type { FullBehavioralTestSuite } from "./gate-behavioral-full-schema.ts";
import type { GeneratedUnit, HandlerUnitName } from "./units.ts";

export function createCapabilityDataTool(spec: CapabilitySpec, databases: PlatformDatabase) {
  const mutation = createCapabilityMutationPort(spec, databases.readwrite);
  const query = createCapabilityQueryPort(databases.readonly, { target: spec });
  return {
    insert: (values: Record<string, unknown>) =>
      materializeCapabilityActionRecord(mutation.create(values)),
    select: () => selectCapabilityRows(spec, query),
  };
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
      {
        action: "update",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["text"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

// The handlers render records through the injected `present` adapter (ADR-0005 §2), so
// the smoke and behavioral rungs exercise the real adapter path — create and read cannot
// drift. `text: input.values.text,` is kept verbatim so the trim test can patch it.
export const CREATE_HANDLER = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  '  if (String(input.values.text ?? "").trim().length === 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="text">Required.</div>\';',
  "  const note = mutation.create({",
  "    text: input.values.text,",
  '    pinned: input.values.pinned === "on" || input.values.pinned === "true",',
  "  });",
  "  return present(note);",
  "}",
].join("\n");

export const READ_HANDLER = [
  "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
  "  const notes = query.records({",
  '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
  "  });",
  '  return notes.map(({ record }) => present(record)).join("");',
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

// Generic five-Action Handler builders. From the 4.4 cutover every capability is
// five-Action, so a gate test composes a complete Handler set: a per-test create/read
// plus these deterministic update/delete/search Handlers derived from the spec. The
// search Handler mirrors the frozen normalized-substring, AND-across-terms contract the
// smoke rung's adversarial baseline asserts.
export const DELETE_HANDLER = [
  "export default async function remove({ mutation }: CapabilityDeleteContext): Promise<string> {",
  "  mutation.delete();",
  "  return '<p class=\"notice\">Removed.</p>';",
  "}",
].join("\n");

// A generic create Handler over the spec's active fields — required active fields are
// validated, every submitted active field is written. Mirrors `updateHandlerFor` for
// specs the constant CREATE_HANDLER (notes-shaped) does not fit.
export function createHandlerFor(spec: CapabilitySpec): string {
  const lines = [
    "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
    "  const missing: string[] = [];",
    "  const values: Record<string, unknown> = {};",
  ];
  for (const field of activeSpecFields(spec.schema.fields)) {
    const name = field.name;
    if (field.required) {
      lines.push(
        `  if (String(input.values.${name} ?? "").trim().length === 0) missing.push("${name}");`,
      );
    }
    if (field.type === "boolean") {
      lines.push(
        `  values.${name} = input.values.${name} === "on" || input.values.${name} === "true";`,
      );
    } else if (field.type === "string[]") {
      lines.push(
        `  { const value = input.values.${name}; if (Array.isArray(value)) values.${name} = [...value]; }`,
      );
    } else {
      lines.push(`  if ("${name}" in input.values) values.${name} = input.values.${name};`);
    }
  }
  lines.push(
    '  if (missing.length > 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="\' + missing.join(" ") + \'">Required.</div>\';',
    "  return present(mutation.create(values));",
    "}",
  );
  return lines.join("\n");
}

// A generic read Handler for any capability: newest records first, target ids only.
export function readHandlerFor(spec: CapabilitySpec): string {
  return [
    "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
    "  const records = query.records({",
    `    sql: 'SELECT "id" AS "target_id" FROM "cap_${spec.id}" ORDER BY "created_at" DESC, "id" DESC',`,
    "  });",
    '  return records.map(({ record }) => present(record)).join("");',
    "}",
  ].join("\n");
}

export function updateHandlerFor(spec: CapabilitySpec): string {
  const lines = [
    "export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {",
    "  const missing: string[] = [];",
    "  const patch: Record<string, unknown> = {};",
  ];
  for (const field of activeSpecFields(spec.schema.fields)) {
    const name = field.name;
    if (field.required) {
      lines.push(
        `  if (input.submittedFields.has("${name}") && String(input.values.${name} ?? "").trim().length === 0) missing.push("${name}");`,
      );
    }
    if (field.type === "boolean") {
      lines.push(
        `  if (input.submittedFields.has("${name}")) patch.${name} = input.values.${name} === "on" || input.values.${name} === "true";`,
      );
    } else if (field.type === "string[]") {
      lines.push(
        `  if ("${name}" in input.values) { const value = input.values.${name}; patch.${name} = Array.isArray(value) ? [...value] : value; }`,
      );
    } else {
      lines.push(`  if ("${name}" in input.values) patch.${name} = input.values.${name};`);
    }
  }
  lines.push(
    '  if (missing.length > 0) return \'<div data-role="error" data-error-code="missing_required_fields" data-error-fields="\' + missing.join(" ") + \'">Required.</div>\';',
    "  return present(mutation.update(patch));",
    "}",
  );
  return lines.join("\n");
}

export function searchHandlerFor(spec: CapabilitySpec): string {
  const clauses = activeSpecFields(spec.schema.fields)
    .filter((field) => field.type === "string" || field.type === "string[]")
    .map((field) =>
      field.type === "string[]"
        ? `EXISTS (SELECT 1 FROM json_each("target"."${field.name}") AS "${field.name}_element" WHERE coalesce(instr(platform_search_normalize("${field.name}_element"."value"), platform_search_normalize("search_term"."term")), 0) > 0)`
        : `(coalesce(instr(platform_search_normalize("target"."${field.name}"), platform_search_normalize("search_term"."term")), 0) > 0)`,
    )
    .join(" OR ");
  const sql =
    `WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?)) ` +
    `SELECT "target"."id" AS "target_id" FROM "cap_${spec.id}" AS "target" ` +
    `WHERE NOT EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE NOT (${clauses})) ` +
    `ORDER BY "target"."created_at" DESC, "target"."id" DESC`;
  return [
    "export default async function search({ input, query, present }: CapabilityContext): Promise<string> {",
    "  const raw = input.values.q;",
    '  const q = typeof raw === "string" ? raw : "";',
    "  const terms = q.trim().split(/\\s+/u).filter(Boolean);",
    "  return query.records({",
    `    sql: '${sql}',`,
    "    parameters: [JSON.stringify(terms)],",
    '  }).map(({ record }) => present(record)).join("");',
    "}",
  ].join("\n");
}

// Compose a complete five-Action Handler set: the caller's create/read (plus any
// override) over the generic update/delete/search derived from the spec.
export function fullHandlersFor(
  spec: CapabilitySpec,
  base: Readonly<Partial<Record<HandlerUnitName, string>>>,
): Readonly<Record<HandlerUnitName, string>> {
  return {
    create: base.create ?? CREATE_HANDLER,
    read: base.read ?? READ_HANDLER,
    update: base.update ?? updateHandlerFor(spec),
    delete: base.delete ?? DELETE_HANDLER,
    search: base.search ?? searchHandlerFor(spec),
  };
}

export const GOOD_HANDLERS: Readonly<Record<HandlerUnitName, string>> = fullHandlersFor(
  notesSpec(),
  {
    create: CREATE_HANDLER,
    read: READ_HANDLER,
  },
);

/** Package deterministic generated-shaped units for Gate/commit tests without a reference installer. */
export function generatedUnitsFor(
  spec: CapabilitySpec,
  handlers: Readonly<Record<HandlerUnitName, string>> = fullHandlersFor(spec, {
    create: CREATE_HANDLER,
    read: READ_HANDLER,
  }),
): readonly GeneratedUnit[] {
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as const;
  return [
    {
      kind: "item-renderer",
      name: "item",
      filename: "item.ts",
      content: itemRendererFor(spec),
      attempts: [],
      durationMs: 0,
      usage,
    },
    ...Object.entries(handlers).map(([name, content]) => ({
      kind: "handler" as const,
      name: name as HandlerUnitName,
      filename: `${name}.ts` as `${HandlerUnitName}.ts`,
      content,
      attempts: [],
      durationMs: 0,
      usage,
    })),
  ];
}

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
      {
        action: "update",
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
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  '  const missing = ["title", "body"].filter((field) => String(input.values[field] ?? "").trim().length === 0);',
  "  if (missing.length > 0) {",
  '    return `<div class="notice" data-role="error" data-error-code="missing_required_fields" data-error-fields="$' +
    '{missing.join(" ")}">I need a little more before I can save this.</div>`;',
  "  }",
  "  const article = mutation.create({ title: input.values.title, body: input.values.body });",
  "  return present(article);",
  "}",
].join("\n");

export const ARTICLE_READ_HANDLER = [
  "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
  "  const articles = query.records({",
  '    sql: \'SELECT "id" AS "target_id" FROM "cap_articles" ORDER BY "created_at" DESC, "id" DESC\',',
  "  });",
  '  return articles.map(({ record }) => present(record)).join("");',
  "}",
].join("\n");

export const ARTICLE_HANDLERS: Readonly<Record<HandlerUnitName, string>> = fullHandlersFor(
  articlesSpec(),
  {
    create: MARKED_ARTICLE_CREATE_HANDLER,
    read: ARTICLE_READ_HANDLER,
  },
);

type FixtureScalar = string | number | boolean | string[] | null;

interface FullBehavioralFixture {
  readonly createValues: Readonly<Record<string, FixtureScalar>>;
  readonly updateValues: Readonly<Record<string, FixtureScalar>>;
  readonly readValues: Readonly<Record<string, FixtureScalar>>;
  readonly searchMatchValues: Readonly<Record<string, FixtureScalar>>;
  readonly searchOlderMatchValues: Readonly<Record<string, FixtureScalar>>;
  readonly searchMissValues: Readonly<Record<string, FixtureScalar>>;
  readonly markerField: string;
  readonly searchQuery: string;
  readonly createName?: string;
}

/** Build the sole steady-state behavioral-suite shape from deterministic row values. */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the explicit case inventory mirrors the provider schema field-for-field.
export function fullBehavioralSuiteFor(
  spec: CapabilitySpec,
  fixture: FullBehavioralFixture,
): FullBehavioralTestSuite {
  const create = rowValues(fixture.createValues);
  const updated = rowValues(fixture.updateValues);
  const read = rowValues(fixture.readValues);
  const searchMatch = rowValues(fixture.searchMatchValues);
  const searchOlderMatch = rowValues(fixture.searchOlderMatchValues);
  const searchMiss = rowValues(fixture.searchMissValues);
  const createMarker = marker(fixture.createValues, fixture.markerField);
  const updateMarker = marker(fixture.updateValues, fixture.markerField);
  const readMarker = marker(fixture.readValues, fixture.markerField);
  const searchMatchMarker = marker(fixture.searchMatchValues, fixture.markerField);
  const searchOlderMatchMarker = marker(fixture.searchOlderMatchValues, fixture.markerField);
  const searchMissMarker = marker(fixture.searchMissValues, fixture.markerField);
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one mapper owns the Action-specific error fixture shape.
  const authoredErrors = spec.behavioral_errors.map((expectedError) => {
    const isUpdate = expectedError.action === "update";
    return {
      action: expectedError.action,
      name:
        expectedError.action === "create" && fixture.createName
          ? fixture.createName
          : `${expectedError.action} emits ${expectedError.code}`,
      setupRows: isUpdate ? [{ values: create }] : [],
      target: isUpdate ? ("first_setup_row" as const) : null,
      input: isUpdate ? expectedError.fields.map((field) => ({ field, value: "" })) : [],
      expectedRows: isUpdate ? [{ values: create }] : [],
      expectedRowCount: isUpdate ? 1 : 0,
      expectFragmentIncludes: [],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError,
      expectedPlatformError: null,
    };
  });

  return {
    cases: [
      {
        action: "create",
        name: "stores and renders the submitted row",
        setupRows: [],
        target: null,
        input: inputValues(fixture.createValues),
        expectedRows: [{ values: create }],
        expectedRowCount: 1,
        expectFragmentIncludes: [createMarker],
        expectFragmentExcludes: [],
        expectFragmentIncludesInOrder: [],
        expectedError: null,
        expectedPlatformError: null,
      },
      {
        action: "read",
        name: "reads stored rows",
        setupRows: [{ values: read }],
        target: null,
        input: [],
        expectedRows: [{ values: read }],
        expectedRowCount: 1,
        expectFragmentIncludes: [readMarker],
        expectFragmentExcludes: [],
        expectFragmentIncludesInOrder: [readMarker],
        expectedError: null,
        expectedPlatformError: null,
      },
      {
        action: "update",
        name: "updates the bound row",
        setupRows: [{ values: create }],
        target: "first_setup_row",
        input: inputValues(fixture.updateValues),
        expectedRows: [{ values: updated }],
        expectedRowCount: 1,
        expectFragmentIncludes: [updateMarker],
        expectFragmentExcludes: [],
        expectFragmentIncludesInOrder: [],
        expectedError: null,
        expectedPlatformError: null,
      },
      {
        action: "delete",
        name: "deletes the bound row",
        setupRows: [{ values: create }],
        target: "first_setup_row",
        input: [],
        expectedRows: [],
        expectedRowCount: 0,
        expectFragmentIncludes: [],
        expectFragmentExcludes: [],
        expectFragmentIncludesInOrder: [],
        expectedError: null,
        expectedPlatformError: null,
      },
      {
        action: "search",
        name: "filters stored rows",
        setupRows: [{ values: searchMatch }, { values: searchOlderMatch }, { values: searchMiss }],
        target: null,
        input: [{ field: "q", value: fixture.searchQuery }],
        expectedRows: [
          { values: searchMatch },
          { values: searchOlderMatch },
          { values: searchMiss },
        ],
        expectedRowCount: 3,
        expectFragmentIncludes: [searchMatchMarker, searchOlderMatchMarker],
        expectFragmentExcludes: [searchMissMarker],
        expectFragmentIncludesInOrder: [searchMatchMarker, searchOlderMatchMarker],
        expectedError: null,
        expectedPlatformError: null,
      },
      ...authoredErrors,
      {
        action: "update",
        name: "missing update target is stable",
        setupRows: [{ values: create }],
        target: "missing_record",
        input: inputValues(fixture.updateValues),
        expectedRows: [{ values: create }],
        expectedRowCount: 1,
        expectFragmentIncludes: [],
        expectFragmentExcludes: [],
        expectFragmentIncludesInOrder: [],
        expectedError: null,
        expectedPlatformError: { action: "update", code: "record_not_found" },
      },
      {
        action: "delete",
        name: "missing delete target is stable",
        setupRows: [{ values: create }],
        target: "missing_record",
        input: [],
        expectedRows: [{ values: create }],
        expectedRowCount: 1,
        expectFragmentIncludes: [],
        expectFragmentExcludes: [],
        expectFragmentIncludesInOrder: [],
        expectedError: null,
        expectedPlatformError: { action: "delete", code: "record_not_found" },
      },
    ],
  };
}

function rowValues(values: Readonly<Record<string, FixtureScalar>>) {
  return Object.entries(values).map(([field, value]) => ({ field, value }));
}

function inputValues(values: Readonly<Record<string, FixtureScalar>>) {
  return Object.entries(values).flatMap(([field, value]) =>
    Array.isArray(value)
      ? value.map((entry) => ({ field, value: entry }))
      : [{ field, value: value === null ? "" : String(value) }],
  );
}

function marker(values: Readonly<Record<string, FixtureScalar>>, field: string): string {
  const value = values[field];
  if (value === null || value === undefined || Array.isArray(value)) {
    throw new Error(`Behavioral marker ${field} must be a scalar value.`);
  }
  return String(value);
}

export const DEFAULT_BEHAVIORAL_SUITE = fullBehavioralSuiteFor(notesSpec(), {
  createValues: { text: "Behavioral note", pinned: false },
  updateValues: { text: "Updated note", pinned: false },
  readValues: { text: "Read me", pinned: false },
  searchMatchValues: { text: "Matching note newest", pinned: false },
  searchOlderMatchValues: { text: "Matching note older", pinned: false },
  searchMissValues: { text: "Other entry", pinned: false },
  markerField: "text",
  searchQuery: "matching",
});

export const MULTI_REQUIRED_VALIDATION_SUITE = fullBehavioralSuiteFor(articlesSpec(), {
  createValues: { title: "Draft title", body: "Draft body" },
  updateValues: { title: "Revised title", body: "Revised body" },
  readValues: { title: "Read title", body: "Read body" },
  searchMatchValues: { title: "Matching article newest", body: "Useful body" },
  searchOlderMatchValues: { title: "Matching article older", body: "Useful body" },
  searchMissValues: { title: "Other article", body: "Different body" },
  markerField: "title",
  searchQuery: "matching",
  createName: "missing title and body emits stable validation markers",
});

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

/**
 * A provider that hands back one queued response per call, in order. It throws once the
 * queue is exhausted rather than replaying the last response: a test that asserts "these
 * units were copied, never generated" is only proof if an unexpected extra generation
 * fails loudly instead of being silently answered with stale bytes.
 */
export function makeSequenceProvider(responses: readonly unknown[]): {
  provider: Provider;
  prompts: string[];
} {
  const prompts: string[] = [];
  let index = 0;
  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      if (index >= responses.length) {
        throw new Error(
          `Sequence provider exhausted after ${responses.length} response(s); an unexpected generation was requested with prompt: ${prompt.slice(0, 200)}`,
        );
      }
      const response = responses[index];
      index += 1;
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield response as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(response as T),
        usage: Promise.resolve({ inputTokens: 7, outputTokens: 11, totalTokens: 18 }),
      };
    },
  };
  return { provider, prompts };
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
