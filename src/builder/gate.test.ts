// Tests for the first always-on gate rungs (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

import { Database } from "bun:sqlite";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { type ZodType, z } from "zod";

import {
  applyCapabilityTableDdl,
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
import {
  BEHAVIORAL_TIER_ENV_VAR,
  buildBehavioralTestPrompt,
  CapabilityGateError,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
} from "./gate.ts";
import type { HandlerUnitName } from "./units.ts";

setDefaultTimeout(15_000);

function createCapabilityDataTool(spec: CapabilitySpec, databases: PlatformDatabase) {
  const { mutation, query } = createCapabilityDataPorts(spec, databases);
  return { insert: mutation.create, select: () => selectCapabilityRows(spec, query) };
}

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
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
const CREATE_HANDLER = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  "  const note = mutation.create({",
  "    text: input.values.text,",
  '    pinned: input.values.pinned === "on" || input.values.pinned === "true",',
  "  });",
  "  return present(note);",
  "}",
].join("\n");

const READ_HANDLER = [
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
function itemRendererFor(spec: CapabilitySpec): string {
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

const GOOD_HANDLERS: Readonly<Record<HandlerUnitName, string>> = {
  create: CREATE_HANDLER,
  read: READ_HANDLER,
};

function articlesSpec(): CapabilitySpec {
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

const MARKED_ARTICLE_CREATE_HANDLER = [
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

const ARTICLE_READ_HANDLER = [
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

const ARTICLE_HANDLERS: Readonly<Record<HandlerUnitName, string>> = {
  create: MARKED_ARTICLE_CREATE_HANDLER,
  read: ARTICLE_READ_HANDLER,
};

const DEFAULT_BEHAVIORAL_SUITE = {
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

const MULTI_REQUIRED_VALIDATION_SUITE = {
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

function makeBehaviorProvider(suite: unknown = DEFAULT_BEHAVIORAL_SUITE): {
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

function gateInput(
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

async function expectGateFailure(
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

describe("capability gate", () => {
  test("runs structural before smoke and captures metrics for passing handlers", async () => {
    const realDatabase = new Database(":memory:");
    const spec = notesSpec();
    try {
      applyCapabilityTableDdl(spec, realDatabase);
      const realTool = createCapabilityDataTool(spec, {
        readwrite: realDatabase,
        readonly: realDatabase,
      });
      realTool.insert({ text: "Real note", pinned: false });

      const result = await runCapabilityGate(gateInput({ spec, realDatabase }));

      expect(result.outcomes.map((outcome) => outcome.rung)).toEqual([
        "structural",
        "smoke",
        "behavioral",
        "design-lint",
      ]);
      expect(result.outcomes.every((outcome) => outcome.status === "passed")).toBe(true);
      expect(result.outcomes.every((outcome) => outcome.durationMs >= 0)).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.smoke).toMatchObject({
        tableName: "cap_notes",
        rowCount: 1,
        realDatabaseUnchanged: true,
      });
      expect(result.smoke.createFragmentLength).toBeGreaterThan(0);
      expect(result.smoke.readFragmentLength).toBeGreaterThan(0);
      expect(result.smoke.insertedRowId).toBeTruthy();
      expect(result.behavioral).toMatchObject({
        tier: "on",
        status: "passed",
        testGen: {
          outcome: "passed",
          testCount: 1,
          usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
        },
        testRun: { outcome: "passed" },
      });
      expect(
        result.behavioral.tier === "on" ? result.behavioral.testGen.durationMs : -1,
      ).toBeGreaterThanOrEqual(0);
      expect(
        result.behavioral.tier === "on" ? result.behavioral.testRun.durationMs : -1,
      ).toBeGreaterThanOrEqual(0);
      expect(result.behavioral.tier === "on" ? result.behavioral.testRun.cases : []).toEqual([
        expect.objectContaining({ name: "stores and renders note text", status: "passed" }),
      ]);

      expect(realTool.select()).toMatchObject([{ text: "Real note", pinned: false }]);
    } finally {
      realDatabase.close();
    }
  });

  test("Gate samples supply declared created_at and never expose inactive item fields", async () => {
    const spec = notesSpec({
      schema: {
        fields: [
          { name: "text", label: "Entry", type: "string", required: true, lifecycle: "active" },
          {
            name: "pinned",
            label: "Pinned",
            type: "boolean",
            required: false,
            lifecycle: "active",
          },
          {
            name: "retired_note",
            label: "Retired note",
            type: "string",
            required: true,
            lifecycle: "inactive",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show the entry and its age.", shows: ["text", "created_at"] },
        collection: { layout: "feed" },
        detail: { shows: ["text", "created_at"] },
      },
    });
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      '  if (typeof record.created_at !== "string") return "";',
      "  return '<div class=\"stack\"><span class=\"text-lg\">' + escapeHtml(record.text) + '</span></div>';",
      "}",
      "function escapeHtml(value: unknown): string {",
      '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
      "}",
    ].join("\n");

    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        itemRenderer: renderer,
        behavioralTier: { enabled: false },
      }),
    );
    expect(result.smoke.rowCount).toBe(1);
    expect(result.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });

  test("Gate rejects item renderers that read fields outside item.shows", async () => {
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  return '<div class=\"stack\"><span class=\"text-lg\">' + String(record.created_at) + '</span></div>';",
      "}",
    ].join("\n");

    await expect(
      runCapabilityGate(
        gateInput({
          itemRenderer: renderer,
          behavioralTier: { enabled: false },
        }),
      ),
    ).rejects.toThrow(/not declared by ui_intent\.item\.shows: created_at/);
  });

  test("Gate smoke and design samples exercise string[] as an ordered list", async () => {
    const spec = notesSpec({
      schema: {
        fields: [
          { name: "tags", label: "Tags", type: "string[]", required: true, lifecycle: "active" },
        ],
      },
      ui_intent: {
        form: { list_inputs: [{ field: "tags", mode: "repeatable" }] },
        item: { direction: "Show each tag in order.", shows: ["tags"] },
        collection: { layout: "feed" },
        detail: { shows: ["tags"] },
      },
      behavior: "At least one tag is required and tag order is preserved.",
      behavioral_errors: [
        {
          action: "create",
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["tags"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
      ],
    });
    const create = [
      "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
      "  const tags = input.values.tags;",
      '  if (!Array.isArray(tags)) return "<p>missing</p>";',
      "  return present(mutation.create({ tags: [...tags] }));",
      "}",
    ].join("\n");
    const read = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const rows = query.all({",
      '    sql: \'SELECT * FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
      '    result: [{ alias: "id", type: "string" }, { alias: "created_at", type: "datetime" }, { alias: "tags", type: "string[]" }],',
      "  });",
      '  return rows.map((row) => present(row)).join("");',
      "}",
    ].join("\n");
    const renderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  const tags = Array.isArray(record.tags) ? record.tags : [];",
      '  return `<div class="stack">$' +
        '{tags.map((tag) => `<span class="text-sm">$' +
        '{escapeHtml(String(tag))}</span>`).join("")}</div>`;',
      "}",
      "function escapeHtml(value: string): string {",
      '  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
      "}",
    ].join("\n");

    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        handlers: { create, read },
        itemRenderer: renderer,
        behavioralTier: { enabled: false },
      }),
    );

    expect(result.smoke.rowCount).toBe(1);
    expect(result.outcomes.every((outcome) => outcome.status !== "failed")).toBe(true);
  });

  test("signature assertion catches named exports, non-functions, and non-async functions", async () => {
    const cases: Array<{
      readonly label: string;
      readonly create: string;
      readonly message: RegExp;
    }> = [
      {
        label: "named export",
        create:
          "export async function create(_context: CapabilityContext): Promise<string> { return '<p>ok</p>'; }",
        message: /export default async function/,
      },
      {
        label: "default non-function",
        create: "export default '<p>nope</p>';",
        message: /default-export an async function declaration/,
      },
      {
        label: "non-async default function",
        create:
          "export default function create(_context: CapabilityContext): string { return '<p>nope</p>'; }",
        message: /export default async function/,
      },
    ];

    for (const entry of cases) {
      const error = await expectGateFailure(
        gateInput({ handlers: { ...GOOD_HANDLERS, create: entry.create } }),
      );

      expect(error.failedRung, entry.label).toBe("structural");
      expect(error.outcomes).toHaveLength(1);
      expect(error.outcomes[0]).toMatchObject({ rung: "structural", status: "failed" });
      expect(error.outcomes[0]?.error).toMatch(entry.message);
    }
  });

  test("structural type-check failure stops before smoke", async () => {
    const badCreate = [
      "export default async function create({ input, mutation }: CapabilityCreateContext): Promise<string> {",
      "  mutation.create({ text: input.values.text });",
      "  return 123;",
      "}",
    ].join("\n");

    const error = await expectGateFailure(
      gateInput({ handlers: { ...GOOD_HANDLERS, create: badCreate } }),
    );

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes.map((outcome) => outcome.rung)).toEqual(["structural"]);
    expect(error.outcomes[0]?.error).toContain("Type 'number' is not assignable");
  });

  test("structural rung type-checks the generated item renderer", async () => {
    // A renderer that returns the raw `unknown` record value fails the item-renderer
    // type-check — the gate asserts the renderer contract alongside the handlers.
    const badRenderer = [
      "export default function renderItem(record: Record<string, unknown>): string {",
      "  return record.text;",
      "}",
    ].join("\n");

    const error = await expectGateFailure(gateInput({ itemRenderer: badRenderer }));

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes.map((outcome) => outcome.rung)).toEqual(["structural"]);
    expect(error.outcomes[0]?.error).toContain("is not assignable to type 'string'");
  });

  test("structural rung rejects an async (non-synchronous) item renderer", async () => {
    const asyncRenderer = [
      "export default async function renderItem(record: Record<string, unknown>): Promise<string> {",
      "  return String(record.text);",
      "}",
    ].join("\n");

    const error = await expectGateFailure(gateInput({ itemRenderer: asyncRenderer }));

    expect(error.failedRung).toBe("structural");
    expect(error.outcomes[0]?.error).toMatch(/synchronous/);
  });

  test("smoke renders create and read through the real presentation adapter", async () => {
    // With present-calling handlers and a real renderer, both rungs run records through
    // the same `present` adapter the router injects — the item wrapper appears in the
    // rendered output (create + read cannot drift, ADR-0005 §2).
    const result = await runCapabilityGate(gateInput());

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
    expect(result.smoke.createFragmentLength).toBeGreaterThan(0);
    expect(result.smoke.readFragmentLength).toBeGreaterThan(0);
  });

  test("smoke runs the real handlers against scratch and fails when no row lands", async () => {
    const noInsertCreate = [
      "export default async function create(_context: CapabilityContext): Promise<string> {",
      "  return '<p>looked fine, but wrote nothing</p>';",
      "}",
    ].join("\n");

    const error = await expectGateFailure(
      gateInput({ handlers: { ...GOOD_HANDLERS, create: noInsertCreate } }),
    );

    expect(error.failedRung).toBe("smoke");
    expect(error.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:failed",
    ]);
    expect(error.outcomes[1]?.error).toContain("expected exactly one scratch row");
  });

  test("behavioral test generation sees only behavior and schema, never handler code", async () => {
    const { provider, prompts, jsonSchemas } = makeBehaviorProvider();
    const createMarker = "HANDLER_SOURCE_MUST_NOT_ENTER_TEST_GENERATION";
    const result = await runCapabilityGate(
      gateInput({
        provider,
        handlers: { ...GOOD_HANDLERS, create: `${CREATE_HANDLER}\n// ${createMarker}` },
      }),
    );

    expect(result.behavioral.status).toBe("passed");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Text is required. Newest notes appear first.");
    expect(prompts[0]).toContain('"schema"');
    expect(prompts[0]).toContain('"fields"');
    expect(prompts[0]).toContain('"behavioral_errors"');
    expect(prompts[0]).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
    expect(prompts[0]).toContain(
      "For `setupRows` and `expectedCreatedRow`, a string[] field value must be an array of strings, never a scalar string",
    );
    expect(prompts[0]).not.toContain(createMarker);
    expect(prompts[0]).not.toContain("export default async function");
    expect(buildBehavioralTestPrompt(notesSpec())).not.toContain("export default async function");
    expect(JSON.stringify(jsonSchemas[0])).not.toContain("propertyNames");
    const schema = jsonSchemas[0] as {
      properties?: {
        cases?: {
          items?: {
            properties?: Record<string, unknown>;
            required?: string[];
          };
        };
      };
    };
    const caseSchema = schema.properties?.cases?.items;
    expect(caseSchema?.required).toContain("expectedError");
    expect(caseSchema?.required?.sort()).toEqual(Object.keys(caseSchema?.properties ?? {}).sort());
    expect(JSON.stringify(caseSchema?.properties?.expectedError)).toContain("null");
  });

  test("behavioral rung fails violating handlers and passes conforming handlers", async () => {
    const trimSpec = notesSpec({ behavior: "Text is trimmed before saving." });
    const trimSuite = {
      cases: [
        {
          name: "trims note text before saving",
          setupRows: [],
          input: [
            { field: "text", value: "  Trim me  " },
            { field: "pinned", value: "false" },
          ],
          expectedCreatedRow: [
            { field: "text", value: "Trim me" },
            { field: "pinned", value: false },
          ],
          expectedRowCount: 1,
          expectCreateFragmentIncludes: ["Trim me"],
          expectReadFragmentIncludes: ["Trim me"],
          expectReadFragmentIncludesInOrder: [],
          expectedError: null,
        },
      ],
    };
    const trimmingCreate = CREATE_HANDLER.replace(
      "text: input.values.text,",
      'text: String(input.values.text ?? "").trim(),',
    );

    const pass = await runCapabilityGate(
      gateInput({
        spec: trimSpec,
        ddl: deriveCapabilityTableDdl(trimSpec),
        provider: makeBehaviorProvider(trimSuite).provider,
        handlers: { ...GOOD_HANDLERS, create: trimmingCreate },
      }),
    );
    expect(pass.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);

    const error = await expectGateFailure(
      gateInput({
        spec: trimSpec,
        ddl: deriveCapabilityTableDdl(trimSpec),
        provider: makeBehaviorProvider(trimSuite).provider,
        handlers: GOOD_HANDLERS,
      }),
    );

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:failed",
    ]);
    expect(error.outcomes[2]?.error).toContain("trims note text before saving");
    expect(error.outcomes[2]?.error).toContain("did not find a scratch row matching");
    expect(error.diagnostic).toMatchObject({
      failure: expect.stringContaining("did not find a scratch row matching"),
      createInput: {
        values: { text: "  Trim me  ", pinned: "false" },
        submittedFields: expect.any(Set),
      },
      scratchRows: [expect.objectContaining({ text: "  Trim me  " })],
      createFragment: expect.stringContaining("Trim me"),
    });
  });

  test("setup rows are deterministic older records for newest-first behavioral checks", async () => {
    const orderSuite = {
      cases: [
        {
          name: "new note appears before preexisting older note",
          setupRows: [{ values: [{ field: "text", value: "Older note" }] }],
          input: [
            { field: "text", value: "Newest note" },
            { field: "pinned", value: "false" },
          ],
          expectedCreatedRow: [{ field: "text", value: "Newest note" }],
          expectedRowCount: 2,
          expectCreateFragmentIncludes: ["Newest note"],
          expectReadFragmentIncludes: ["Newest note", "Older note"],
          expectReadFragmentIncludesInOrder: ["Newest note", "Older note"],
          expectedError: null,
        },
      ],
    };

    const result = await runCapabilityGate(
      gateInput({ provider: makeBehaviorProvider(orderSuite).provider }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });

  test("setup rows are newest-first: array order maps directly to a newest-first read", async () => {
    // Regression: with two+ setup rows, the model lists them newest-first and derives
    // expectReadFragmentIncludesInOrder = [new row, ...setupRows]. The gate must age
    // them so setupRows[0] is the most recent preexisting row; otherwise a correct
    // newest-first handler fails a self-inconsistent test (the bug this guards).
    const orderSuite = {
      cases: [
        {
          name: "new note, then setup rows in listed (newest-first) order",
          setupRows: [
            { values: [{ field: "text", value: "Middle note" }] },
            { values: [{ field: "text", value: "Oldest note" }] },
          ],
          input: [
            { field: "text", value: "Newest note" },
            { field: "pinned", value: "false" },
          ],
          expectedCreatedRow: [{ field: "text", value: "Newest note" }],
          expectedRowCount: 3,
          expectCreateFragmentIncludes: ["Newest note"],
          expectReadFragmentIncludes: ["Newest note", "Middle note", "Oldest note"],
          expectReadFragmentIncludesInOrder: ["Newest note", "Middle note", "Oldest note"],
          expectedError: null,
        },
      ],
    };

    const result = await runCapabilityGate(
      gateInput({ provider: makeBehaviorProvider(orderSuite).provider }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });

  test("validation-error behavioral cases assert stable markers, not product copy", async () => {
    const spec = articlesSpec();
    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        provider: makeBehaviorProvider(MULTI_REQUIRED_VALIDATION_SUITE).provider,
        handlers: ARTICLE_HANDLERS,
      }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
    expect(result.behavioral.tier === "on" ? result.behavioral.testRun.cases : []).toEqual([
      expect.objectContaining({
        name: "missing title and body emits stable validation markers",
        status: "passed",
      }),
    ]);
  });

  test("datetime fields match by instant, not by literal string form", async () => {
    // Regression: a real model produced a handler that canonicalizes the datetime
    // through a Date round-trip ("2025-06-01T12:00:00Z" → "2025-06-01T12:00:00.000Z")
    // while authoring the behavioral test with the raw input form. The row is the same
    // instant, so the rung must pass — not fail on a representational difference.
    const eventsSpec = notesSpec({
      id: "events",
      label: "Events",
      schema: {
        fields: [
          { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
          {
            name: "happens_at",
            label: "Happens at",
            type: "datetime",
            required: true,
            lifecycle: "active",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: {
          direction: "A timeline-style card that emphasizes event title and date.",
          shows: ["title", "happens_at"],
        },
        collection: { layout: "feed" },
        detail: { shows: ["title", "happens_at"] },
      },
      behavior: "Title and happens_at are required. Newest events appear first.",
      behavioral_errors: [
        {
          action: "create",
          trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["title", "happens_at"],
          expected_markers: BEHAVIORAL_ERROR_MARKERS,
        },
      ],
      prompt_context: "Stores the user's events.",
    });
    const canonicalizingCreate = [
      "export default async function create({ input, mutation }: CapabilityCreateContext): Promise<string> {",
      "  const rawHappensAt = input.values.happens_at;",
      '  const happensAt = new Date(typeof rawHappensAt === "string" ? rawHappensAt : "").toISOString();',
      "  const event = mutation.create({ title: input.values.title, happens_at: happensAt });",
      "  return `<article><h3>$" +
        "{escapeHtml(event.title)}</h3><time>$" +
        "{escapeHtml(event.happens_at)}</time></article>`;",
      "}",
      "",
      "function escapeHtml(value: unknown): string {",
      '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");',
      "}",
    ].join("\n");
    const eventsRead = [
      "export default async function read({ query }: CapabilityContext): Promise<string> {",
      "  const events = query.all({",
      '    sql: \'SELECT * FROM "cap_events" ORDER BY "created_at" DESC, "id" DESC\',',
      '    result: [{ alias: "id", type: "string" }, { alias: "created_at", type: "datetime" }, { alias: "title", type: "string" }, { alias: "happens_at", type: "datetime" }],',
      "  });",
      "  const items = events.map((event) => `<article>$" +
        '{escapeHtml(event.title)}</article>`).join("");',
      '  return `<section class="events">$' + "{items}</section>`;",
      "}",
      "",
      "function escapeHtml(value: unknown): string {",
      '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;");',
      "}",
    ].join("\n");
    const datetimeSuite = {
      cases: [
        {
          name: "stores the event at the given instant",
          setupRows: [],
          input: [
            { field: "title", value: "Launch" },
            { field: "happens_at", value: "2025-06-01T12:00:00Z" },
          ],
          // Expected datetime in the raw input form — the stored value is the
          // canonicalized "...T12:00:00.000Z", a different string for the same instant.
          expectedCreatedRow: [
            { field: "title", value: "Launch" },
            { field: "happens_at", value: "2025-06-01T12:00:00Z" },
          ],
          expectedRowCount: 1,
          expectCreateFragmentIncludes: ["Launch"],
          expectReadFragmentIncludes: ["Launch"],
          expectReadFragmentIncludesInOrder: [],
          expectedError: null,
        },
      ],
    };

    const result = await runCapabilityGate(
      gateInput({
        spec: eventsSpec,
        ddl: deriveCapabilityTableDdl(eventsSpec),
        provider: makeBehaviorProvider(datetimeSuite).provider,
        handlers: { create: canonicalizingCreate, read: eventsRead },
      }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });

  test("validation-error behavioral cases fail when markers are missing or wrong", async () => {
    const spec = articlesSpec();
    const badHandlers = [
      {
        label: "missing markers",
        create: MARKED_ARTICLE_CREATE_HANDLER.replace(
          'data-role="error" data-error-code="missing_required_fields" data-error-fields="$' +
            '{missing.join(" ")}"',
          'class="error"',
        ),
        message: /data-role="error"/,
      },
      {
        label: "wrong error code",
        create: MARKED_ARTICLE_CREATE_HANDLER.replace(
          'data-error-code="missing_required_fields"',
          'data-error-code="validation_problem"',
        ),
        message: /expected error markers code=/,
      },
    ];

    for (const entry of badHandlers) {
      const error = await expectGateFailure(
        gateInput({
          spec,
          ddl: deriveCapabilityTableDdl(spec),
          provider: makeBehaviorProvider(MULTI_REQUIRED_VALIDATION_SUITE).provider,
          handlers: { ...ARTICLE_HANDLERS, create: entry.create },
        }),
      );

      expect(error.failedRung, entry.label).toBe("behavioral");
      expect(error.outcomes[2]?.error, entry.label).toMatch(entry.message);
      expect(error.diagnostic).toMatchObject({
        testCase: { name: "missing title and body emits stable validation markers" },
        failure: expect.stringMatching(entry.message),
        createFragment: expect.any(String),
        scratchRows: [],
      });
    }
  });

  test("behavioral tier defaults on and can be globally skipped for baseline runs", async () => {
    expect(resolveBehavioralTierEnabled({})).toBe(true);
    expect(resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "off" })).toBe(false);
    expect(resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "0" })).toBe(false);
    expect(resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "on" })).toBe(true);
    expect(() => resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "maybe" })).toThrow(
      BEHAVIORAL_TIER_ENV_VAR,
    );

    const result = await runCapabilityGate(
      gateInput({ provider: undefined, behavioralTier: { enabled: false } }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:skipped",
      "design-lint:passed",
    ]);
    expect(result.behavioral).toMatchObject({
      tier: "off",
      status: "skipped",
      reason: "Behavioral tier is off for this run.",
    });
  });
});
