// Tests for unit generation with the bounded fix loop.
//
// Every provider here is fake. The stage still drives the real loop: structured
// generation through the Provider contract, the item-renderer + handler static checks
// (export shape, no imports, isolated type-checks against the ADR-0004/0005 contracts),
// feedback prompts, and attempt metrics. The six generated units are the item
// renderer (first, the creative surface) then all five Handlers, with record-rendering
// Actions using the injected `present` adapter.

// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: the unit-generation contract remains one cohesive provider-loop suite.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: fixtures intentionally embed generated template-literal source.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ZodType } from "zod";

import type {
  DeepPartial,
  GenerateResult,
  Provider,
  TokenUsage,
} from "../../../platform/provider/index.ts";
import { addedLines, linesNaming } from "../../../platform/provider/prompt-lines.test-support.ts";
import { ALLOWED_CLASSES } from "../../../presentation/safety/enforcer/vocabulary.ts";
import {
  PALETTE_COLOR_TOKENS,
  SPACING_TOKENS,
  TYPE_SIZE_TOKENS,
} from "../../../presentation/tokens/design-tokens.ts";
import {
  FIRST_INCARNATION_ID,
  SECOND_INCARNATION_ID,
} from "../../../registry/incarnations.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  type CapabilitySpec,
  defaultBehavioralErrorsForSchema,
  FULL_CAPABILITY_TOOLS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../registry/index.ts";
import {
  buildUnitPrompt,
  DEFAULT_UNIT_FIX_ATTEMPTS,
  generateCapabilityUnits,
  UnitGenerationError,
} from "../../index.ts";
import { checkGeneratedUnit } from "../safety/unit-checks.ts";
import {
  buildItemRendererDesignInjection,
  FEW_SHOT_DESIGN_EXAMPLES,
} from "./few-shot/few-shot-gallery.ts";
import { DELETE_HANDLER, ITEM_RENDERER, READ_HANDLER } from "./unit-fixtures.test-support.ts";
import type { UnitDescriptor } from "./units.ts";

const STUB_USAGE: TokenUsage = { inputTokens: 3, outputTokens: 5, totalTokens: 8 };

setDefaultTimeout(15_000);

interface RecordedProvider extends Provider {
  readonly calls: Array<{ prompt: string; content: string }>;
}

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
    plural_noun: "notes",
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: {
        direction: "A text-forward card that emphasizes text and pinned status.",
        shows: ["text", "pinned"],
      },
      collection: { layout: "feed" },
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
    tools: [...FULL_CAPABILITY_TOOLS],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

function fullNotesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  const base = notesSpec();
  return {
    ...base,
    tools: [...FULL_CAPABILITY_TOOLS],
    behavioral_errors: defaultBehavioralErrorsForSchema(base.schema),
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    ...overrides,
  };
}

/** The prompt the loop owes a unit after `error`: its own prompt carrying that failure back. */
function retryPromptAfter(unit: UnitDescriptor, error: string | undefined): string {
  if (error === undefined) throw new Error("the first attempt did not fail");
  return buildUnitPrompt(notesSpec(), unit, { ...unit, message: error });
}

function makeQueuedProvider(contents: readonly string[]): RecordedProvider {
  const calls: Array<{ prompt: string; content: string }> = [];
  let index = 0;

  return {
    calls,
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      const content = contents[index];
      index += 1;
      if (content === undefined) {
        throw new Error(`fake provider exhausted after ${calls.length} call(s)`);
      }
      calls.push({ prompt, content });
      const object = schema.parse({ content });

      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield object as DeepPartial<T>;
      }

      return {
        partialStream: stream(),
        object: Promise.resolve(object),
        usage: Promise.resolve(STUB_USAGE),
      };
    },
  };
}

function actionGenerationContext(prompt: string): Record<string, unknown> {
  const marker = "Action generation context JSON:\n";
  const start = prompt.indexOf(marker);
  if (start < 0) throw new Error("missing Action generation context JSON");
  return JSON.parse(prompt.slice(start + marker.length)) as Record<string, unknown>;
}

function projectedContextFixture(): {
  withDependencies: CapabilitySpec;
  catalog: readonly CapabilityRow[];
} {
  const base = fullNotesSpec({
    schema: {
      fields: [
        { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
        { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
        { name: "score", label: "Score", type: "number", required: false, lifecycle: "active" },
        {
          name: "retired_secret",
          label: "Retired secret",
          type: "string",
          required: true,
          lifecycle: "inactive",
        },
      ],
    },
    ui_intent: {
      form: {
        list_inputs: [{ field: "tags", mode: "comma_separated" }],
        choice_inputs: [],
        long_text: [],
        guidance: [],
      },
      item: { direction: "Show the note.", shows: ["text", "tags"] },
      collection: { layout: "feed" },
    },
  });
  const spec = {
    ...base,
    behavioral_errors: defaultBehavioralErrorsForSchema(base.schema),
  };
  const firstIncarnation = FIRST_INCARNATION_ID;
  const secondIncarnation = SECOND_INCARNATION_ID;
  const dependency = (id: string, incarnation_id: string): CapabilityRow => ({
    ...notesSpec(),
    id,
    label: id,
    incarnation_id,
    version: 1,
    artifacts_path: `capabilities/${id}/${incarnation_id}/v1/`,
    seed: 184206,
    logo: { status: "absent", attempts: 0 },
    display_label_override: null,
    schema: {
      fields: [
        {
          name: "public_text",
          label: "Public text",
          type: "string",
          required: false,
          lifecycle: "active",
        },
        {
          name: "hidden_text",
          label: "Hidden text",
          type: "string",
          required: false,
          lifecycle: "inactive",
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "Show public text.", shows: ["public_text"] },
      collection: { layout: "feed" },
    },
    behavioral_errors: [],
  });
  const catalog = [
    dependency("journals", firstIncarnation),
    dependency("recipes", secondIncarnation),
  ];
  return {
    catalog,
    withDependencies: {
      ...spec,
      read_dependencies: {
        create: [],
        read: [{ capability_id: "journals", incarnation_id: firstIncarnation }],
        update: [],
        delete: [],
        search: [{ capability_id: "recipes", incarnation_id: secondIncarnation }],
      },
    },
  };
}

// The create handler renders the inserted row through the injected `present` adapter — no row
// markup of its own. It carries `pinned`, which the shared fixture's notes-shaped create does not.
const CREATE_HANDLER = [
  "export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string> {",
  "  const values: Record<string, unknown> = { text: input.values.text };",
  '  if (input.submittedFields.has("pinned")) {',
  '    values.pinned = input.values.pinned === "true" || input.values.pinned === "on";',
  "  }",
  "",
  "  const row = mutation.create(values);",
  "  return present(row);",
  "}",
].join("\n");

// Update and search carry `pinned` and a single search term, so both stay local.
const UPDATE_HANDLER = [
  "export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {",
  "  const patch: Record<string, unknown> = {};",
  '  if (input.submittedFields.has("text")) patch.text = input.values.text;',
  '  if (input.submittedFields.has("pinned")) patch.pinned = input.values.pinned === "on";',
  "  return present(mutation.update(patch));",
  "}",
].join("\n");

const SEARCH_HANDLER = [
  "export default async function search({ input, query, present }: CapabilityContext): Promise<string> {",
  "  const raw = input.values.q;",
  '  const term = typeof raw === "string" ? raw.trim() : "";',
  '  const records = term === ""',
  "    ? query.records({",
  '        sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
  "      })",
  "    : query.records({",
  '        sql: \'SELECT "id" AS "target_id" FROM "cap_notes" WHERE instr(platform_search_normalize("text"), platform_search_normalize(?)) > 0 ORDER BY "created_at" DESC, "id" DESC\',',
  "        parameters: [term],",
  "      });",
  '  return records.map(({ record }) => present(record)).join("");',
  "}",
].join("\n");

// Fails the isolated type-check: an async handler returning a bare number.
const BAD_CREATE_HANDLER = `export default async function create({ input, mutation }: CapabilityCreateContext): Promise<string> {
  mutation.create({ text: input.values.text });
  return 123;
}`;

// Fails the type-check with implicit-any bindings (no annotation on the context param).
const UNTYPED_BAD_HANDLER = `export default async function create({ input, mutation }) {
  mutation.create({ text: input.values.text });
  return 123;
}`;

// Fails the item-renderer type-check: returns the raw `unknown` record value.
const BAD_ITEM_RENDERER = `export default function renderItem(record: Record<string, unknown>): string {
  return record.text;
}`;

// Mirrors the live Claude failure: the object itself is narrowed, but its optional
// `fields` property remains `unknown` when an array method is called on it.
const UNKNOWN_ERROR_FIELDS_UPDATE_HANDLER = [
  "export default async function update({ mutation, present }: CapabilityUpdateContext): Promise<string> {",
  "  try {",
  '    return present(mutation.update({ text: "updated" }));',
  "  } catch (failure: unknown) {",
  "    const candidate = failure as { code?: unknown; fields?: unknown };",
  '    if (candidate.code === "missing_required_fields" && candidate.fields.includes("text")) {',
  '      return \'<p data-role="error" data-error-code="missing_required_fields" data-error-fields="text">Text is required.</p>\';',
  "    }",
  "    throw failure;",
  "  }",
  "}",
].join("\n");

const NARROWED_ERROR_FIELDS_UPDATE_HANDLER = [
  "export default async function update({ mutation, present }: CapabilityUpdateContext): Promise<string> {",
  "  try {",
  '    return present(mutation.update({ text: "updated" }));',
  "  } catch (failure: unknown) {",
  '    if (typeof failure !== "object" || failure === null) throw failure;',
  "    const candidate = failure as { code?: unknown; fields?: unknown };",
  "    const rawFields = candidate.fields;",
  "    if (",
  '      candidate.code === "missing_required_fields" &&',
  "      Array.isArray(rawFields) &&",
  '      rawFields.every((field): field is string => typeof field === "string") &&',
  '      rawFields.includes("text")',
  "    ) {",
  '      return \'<p data-role="error" data-error-code="missing_required_fields" data-error-fields="text">Text is required.</p>\';',
  "    }",
  "    throw failure;",
  "  }",
  "}",
].join("\n");

// Mirrors the two coffee-diary failures. `Array.isArray` narrows mutable arrays,
// so its false branch does not prove that a `readonly string[]` union member is a string.
const READONLY_FALSE_BRANCH_UPDATE_HANDLER = [
  "function scalarValue(value: string | readonly string[]): string {",
  '  if (Array.isArray(value)) return value[0] ?? "";',
  "  return value;",
  "}",
  "export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {",
  "  const patch: Record<string, unknown> = {};",
  '  if (input.submittedFields.has("text")) patch.text = scalarValue(input.values.text ?? "");',
  "  return present(mutation.update(patch));",
  "}",
].join("\n");

// `noUncheckedIndexedAccess` adds `undefined` to every dynamic `input.values` read,
// even though the record's declared value type names only scalar and list values.
const UNDEFINED_INDEXED_INPUT_UPDATE_HANDLER = [
  "function scalarValue(value: string | readonly string[]): string {",
  '  if (typeof value === "string") return value;',
  '  return value[0] ?? "";',
  "}",
  "export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {",
  "  const patch: Record<string, unknown> = {};",
  '  if (input.submittedFields.has("text")) patch.text = scalarValue(input.values.text);',
  "  return present(mutation.update(patch));",
  "}",
].join("\n");

const SAFE_INDEXED_INPUT_UPDATE_HANDLER = [
  "function scalarValue(value: unknown): string {",
  '  if (typeof value === "string") return value;',
  '  return "";',
  "}",
  "export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string> {",
  "  const patch: Record<string, unknown> = {};",
  '  if (input.submittedFields.has("text")) patch.text = scalarValue(input.values.text);',
  "  return present(mutation.update(patch));",
  "}",
].join("\n");

describe("unit generation with bounded fix loop — generation and fix-loop regeneration", () => {
  test("generates item.ts and all five canonical Action handlers for a full spec", async () => {
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      CREATE_HANDLER,
      READ_HANDLER,
      UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: fullNotesSpec() });

    expect(provider.calls).toHaveLength(6);
    expect(result.units.map((unit) => unit.filename)).toEqual([
      "item.ts",
      "create.ts",
      "read.ts",
      "update.ts",
      "delete.ts",
      "search.ts",
    ]);
    expect(result.handlers).toEqual({
      create: CREATE_HANDLER,
      read: READ_HANDLER,
      update: UPDATE_HANDLER,
      delete: DELETE_HANDLER,
      search: SEARCH_HANDLER,
    });
  });

  test("records one clean attempt per unit", async () => {
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      CREATE_HANDLER,
      READ_HANDLER,
      UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    for (const unit of result.units) {
      expect(unit.attempts).toHaveLength(1);
      expect(unit.attempts[0]?.error).toBeUndefined();
      expect(unit.durationMs).toBeGreaterThanOrEqual(0);
      expect(unit.usage).toEqual(STUB_USAGE);
      expect(unit.attempts[0]?.usage).toEqual(STUB_USAGE);
    }
  });

  test("feeds an item-renderer type-check failure back into regeneration and accepts the fix", async () => {
    const provider = makeQueuedProvider([
      BAD_ITEM_RENDERER,
      ITEM_RENDERER,
      CREATE_HANDLER,
      READ_HANDLER,
      UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    expect(provider.calls).toHaveLength(7);
    expect(result.itemRenderer).toBe(ITEM_RENDERER);
    const rendererUnit = result.units.find((unit) => unit.kind === "item-renderer");
    expect(rendererUnit?.attempts).toHaveLength(2);
    expect(rendererUnit?.attempts[0]?.error).toContain("is not assignable to type 'string'");
    expect(rendererUnit?.attempts[1]?.error).toBeUndefined();
    expect(rendererUnit?.usage).toEqual({ inputTokens: 6, outputTokens: 10, totalTokens: 16 });

    // The retry prompt echoes the failure back so the model returns a corrected unit.
    expect(provider.calls[1]?.prompt).toBe(
      retryPromptAfter({ kind: "item-renderer", name: "item" }, rendererUnit?.attempts[0]?.error),
    );
  });

  test("feeds a handler type-check failure back into regeneration and accepts the fixed unit", async () => {
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      BAD_CREATE_HANDLER,
      CREATE_HANDLER,
      READ_HANDLER,
      UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    expect(provider.calls).toHaveLength(7);
    expect(result.handlers.create).toBe(CREATE_HANDLER);
    const createUnit = result.units.find(
      (unit) => unit.kind === "handler" && unit.name === "create",
    );
    expect(createUnit?.attempts).toHaveLength(2);
    expect(createUnit?.attempts[0]?.error).toContain("Type 'number' is not assignable");
    expect(createUnit?.attempts[1]?.error).toBeUndefined();
    expect(createUnit?.usage).toEqual({ inputTokens: 6, outputTokens: 10, totalTokens: 16 });

    expect(provider.calls[2]?.prompt).toBe(
      retryPromptAfter({ kind: "handler", name: "create" }, createUnit?.attempts[0]?.error),
    );
  });
});

describe("unit generation with bounded fix loop — the import ban", () => {
  test("refuses a handler that imports and keeps its import-free retry", async () => {
    const importing = `import { readFileSync } from "node:fs";\n${CREATE_HANDLER}`;
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      importing,
      CREATE_HANDLER,
      READ_HANDLER,
      UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });
    const create = result.units.find((unit) => unit.kind === "handler" && unit.name === "create");
    if (create === undefined) throw new Error("no create unit was generated");

    expect(result.handlers.create).toBe(CREATE_HANDLER);
    expect(create.attempts).toHaveLength(2);
    expect(create.attempts[0]?.error).toBeString();
    expect(create.attempts[0]?.error).toBe(
      checkGeneratedUnit(notesSpec(), create, importing)?.message,
    );
    expect(create.attempts[1]?.error).toBeUndefined();
  });
});

describe("unit generation with bounded fix loop — strict unknown-property repair", () => {
  test("feeds an unknown object-property failure back and accepts a locally narrowed fix", async () => {
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      CREATE_HANDLER,
      READ_HANDLER,
      UNKNOWN_ERROR_FIELDS_UPDATE_HANDLER,
      NARROWED_ERROR_FIELDS_UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });
    const update = result.units.find((unit) => unit.kind === "handler" && unit.name === "update");

    expect(update?.attempts).toHaveLength(2);
    expect(update?.attempts[0]?.error).toContain("'candidate.fields' is of type 'unknown'");
    expect(update?.attempts[1]?.error).toBeUndefined();
    expect(provider.calls[4]?.prompt).toBe(
      retryPromptAfter({ kind: "handler", name: "update" }, update?.attempts[0]?.error),
    );
    expect(result.handlers.update).toBe(NARROWED_ERROR_FIELDS_UPDATE_HANDLER);
  });
});

describe("unit generation with bounded fix loop — indexed update input repair", () => {
  test.each([
    {
      name: "readonly list remains in an Array.isArray false branch",
      broken: READONLY_FALSE_BRANCH_UPDATE_HANDLER,
      diagnostic: "Type 'readonly string[]' is not assignable to type 'string'",
    },
    {
      name: "indexed input may be undefined under noUncheckedIndexedAccess",
      broken: UNDEFINED_INDEXED_INPUT_UPDATE_HANDLER,
      diagnostic:
        "CapabilityInputValue | undefined' is not assignable to parameter of type 'string | readonly string[]'",
    },
  ])("repairs $name within the default two-attempt budget", async ({ broken, diagnostic }) => {
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      CREATE_HANDLER,
      READ_HANDLER,
      broken,
      SAFE_INDEXED_INPUT_UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });
    const update = result.units.find((unit) => unit.kind === "handler" && unit.name === "update");
    const retryPrompt = provider.calls[4]?.prompt ?? "";

    expect(update?.attempts).toHaveLength(DEFAULT_UNIT_FIX_ATTEMPTS);
    expect(update?.attempts[0]?.error).toContain(diagnostic);
    expect(update?.attempts[1]?.error).toBeUndefined();
    expect(retryPrompt).toBe(
      retryPromptAfter({ kind: "handler", name: "update" }, update?.attempts[0]?.error),
    );
    expect(result.handlers.update).toBe(SAFE_INDEXED_INPUT_UPDATE_HANDLER);
  });
});

describe("unit generation with bounded fix loop — attempt-cap exhaustion and static checks", () => {
  test("exhausts the default two-attempt cap on the item renderer and fails cleanly", async () => {
    await expect(
      generateCapabilityUnits({
        provider: makeQueuedProvider([BAD_ITEM_RENDERER, BAD_ITEM_RENDERER]),
        spec: notesSpec(),
      }),
    ).rejects.toThrow(UnitGenerationError);

    try {
      await generateCapabilityUnits({
        provider: makeQueuedProvider([BAD_ITEM_RENDERER, BAD_ITEM_RENDERER]),
        spec: notesSpec(),
      });
      throw new Error("expected unit generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(UnitGenerationError);
      const unitError = error as UnitGenerationError;
      expect(unitError.unit).toEqual({ kind: "item-renderer", name: "item" });
      expect(unitError.attempts).toHaveLength(DEFAULT_UNIT_FIX_ATTEMPTS);
      expect(unitError.attempts.every((attempt) => attempt.error)).toBe(true);
    }
  });

  test("exhausts the cap on a broken handler after the item renderer passes", async () => {
    try {
      await generateCapabilityUnits({
        provider: makeQueuedProvider([ITEM_RENDERER, UNTYPED_BAD_HANDLER, UNTYPED_BAD_HANDLER]),
        spec: notesSpec(),
      });
      throw new Error("expected unit generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(UnitGenerationError);
      const unitError = error as UnitGenerationError;
      expect(unitError.unit).toEqual({ kind: "handler", name: "create" });
      expect(unitError.attempts).toHaveLength(DEFAULT_UNIT_FIX_ATTEMPTS);
      expect(unitError.attempts[0]?.error).toContain(
        "Binding element 'input' implicitly has an 'any' type",
      );
    }
  });

  test("preserves the exact unknown-property history in the terminal generation error", async () => {
    try {
      await generateCapabilityUnits({
        provider: makeQueuedProvider([
          ITEM_RENDERER,
          CREATE_HANDLER,
          READ_HANDLER,
          UNKNOWN_ERROR_FIELDS_UPDATE_HANDLER,
          UNKNOWN_ERROR_FIELDS_UPDATE_HANDLER,
        ]),
        spec: notesSpec(),
      });
      throw new Error("expected unit generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(UnitGenerationError);
      const unitError = error as UnitGenerationError;
      expect(unitError.unit).toEqual({ kind: "handler", name: "update" });
      expect(unitError.attempts).toHaveLength(DEFAULT_UNIT_FIX_ATTEMPTS);
      expect(unitError.attempts[0]?.error).toContain("'candidate.fields' is of type 'unknown'");
      expect(unitError.attempts[1]?.error).toContain("'candidate.fields' is of type 'unknown'");
      expect(unitError.message).toContain("'candidate.fields' is of type 'unknown'");
      expect(unitError.diagnostic).toEqual({
        unit: { kind: "handler", name: "update" },
        attempts: unitError.attempts,
      });
    }
  });

  test("rejects an item renderer that imports or is async", () => {
    const importing = `import { escape } from "../x";\nexport default function renderItem(record: Record<string, unknown>): string {\n  return escape(String(record.text));\n}`;
    const importFailure = checkGeneratedUnit(
      notesSpec(),
      { kind: "item-renderer", name: "item" },
      importing,
    );
    expect(importFailure?.message).toContain("must not import anything");

    const asyncRenderer = `export default async function renderItem(record: Record<string, unknown>): Promise<string> {\n  return String(record.text);\n}`;
    const asyncFailure = checkGeneratedUnit(
      notesSpec(),
      { kind: "item-renderer", name: "item" },
      asyncRenderer,
    );
    expect(asyncFailure?.message).toContain("must be synchronous");
  });

  test("rejects item renderer access outside item.shows, including whole-record access", () => {
    const undeclared = `export default function renderItem(record: Record<string, unknown>): string {\n  return String(record.created_at);\n}`;
    expect(
      checkGeneratedUnit(notesSpec(), { kind: "item-renderer", name: "item" }, undeclared)?.message,
    ).toContain("not declared by ui_intent.item.shows: created_at");

    const dynamic = `export default function renderItem(record: Record<string, unknown>): string {\n  return Object.keys(record).join(",");\n}`;
    expect(
      checkGeneratedUnit(notesSpec(), { kind: "item-renderer", name: "item" }, dynamic)?.message,
    ).toContain("dynamic or whole-record access is not allowed");

    const destructured = `export default function renderItem(record: Record<string, unknown>): string {\n  const { created_at } = record;\n  return String(created_at);\n}`;
    expect(
      checkGeneratedUnit(notesSpec(), { kind: "item-renderer", name: "item" }, destructured)
        ?.message,
    ).toContain("not declared by ui_intent.item.shows: created_at");

    const allowedAlias = `export default function renderItem(record: Record<string, unknown>): string {\n  const item = record;\n  return String(item.text);\n}`;
    expect(
      checkGeneratedUnit(notesSpec(), { kind: "item-renderer", name: "item" }, allowedAlias),
    ).toBeUndefined();
  });
});

describe("unit generation with bounded fix loop — Action-scoped structural repair", () => {
  test("repairs only the Handler whose Action queries outside its declared catalog", async () => {
    const undeclaredRead = READ_HANDLER.replace("cap_notes", "cap_hidden");
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      CREATE_HANDLER,
      undeclaredRead,
      READ_HANDLER,
      UPDATE_HANDLER,
      DELETE_HANDLER,
      SEARCH_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });
    const read = result.units.find((unit) => unit.kind === "handler" && unit.name === "read");

    expect(result.handlers.read).toBe(READ_HANDLER);
    expect(read?.attempts).toHaveLength(2);
    expect(read?.attempts[0]?.error).toContain(
      'Generated handler "read" queries undeclared capability table: cap_hidden',
    );
    expect(read?.attempts[1]?.error).toBeUndefined();
    expect(provider.calls[3]?.prompt).toBe(
      retryPromptAfter({ kind: "handler", name: "read" }, read?.attempts[0]?.error),
    );
  });

  test("admits the same dependency SQL only for the Action that declares it", () => {
    const { withDependencies, catalog } = projectedContextFixture();
    const journalSql = [
      "export default async function read({ query }: CapabilityContext): Promise<string> {",
      "  const rows = query.all({",
      '    sql: \'SELECT "public_text" FROM "cap_journals"\',',
      '    result: [{ alias: "public_text", type: "string" }],',
      "  });",
      "  return String(rows.length);",
      "}",
    ].join("\n");

    expect(
      checkGeneratedUnit(withDependencies, { kind: "handler", name: "read" }, journalSql, catalog),
    ).toBeUndefined();
    expect(
      checkGeneratedUnit(
        withDependencies,
        { kind: "handler", name: "search" },
        journalSql.replace("function read", "function search"),
        catalog,
      )?.message,
    ).toContain('Generated handler "search" queries undeclared capability table: cap_journals');
  });
});

describe("unit generation with bounded fix loop — adversarial source syntax", () => {
  test("rejects modified DDL forms as raw mutation SQL", () => {
    for (const sql of [
      'CREATE UNIQUE INDEX generated_idx ON "cap_notes" ("text")',
      "CREATE TEMP TABLE generated_scratch (value TEXT)",
      "CREATE VIRTUAL TABLE generated_search USING fts5(value)",
    ]) {
      const handler = [
        "export default async function read(_context: CapabilityContext): Promise<string> {",
        `  const sql = ${JSON.stringify(sql)};`,
        "  void sql;",
        '  return "";',
        "}",
      ].join("\n");
      expect(
        checkGeneratedUnit(notesSpec(), { kind: "handler", name: "read" }, handler)?.message,
      ).toContain("raw mutation SQL");
    }
  });
});

describe("unit generation with bounded fix loop — adversarial toolbox syntax", () => {
  test("resolves composed query SQL and ignores capability names outside query calls", () => {
    const templateSql = [
      "export default async function read({ query }: CapabilityContext): Promise<string> {",
      '  const table = "hidden";',
      "  const rows = query.all({",
      "    sql: `SELECT text FROM cap_${table}` ,",
      '    result: [{ alias: "text", type: "string" }],',
      "  });",
      "  return String(rows.length);",
      "}",
    ].join("\n");
    const concatenatedSql = templateSql.replace(
      "`SELECT text FROM cap_${table}`",
      '"SELECT text FROM cap_" + table',
    );
    const aliasedQuery = templateSql
      .replace("  const rows = query.all({", "  const q = query;\n  const rows = q.all({")
      .replace("`SELECT text FROM cap_${table}`", '"SELECT text FROM cap_" + table');
    const renamedQuery = concatenatedSql
      .replace("{ query }", "{ query: q }")
      .replace("query.all", "q.all");
    const ordinaryCopy = [
      "export default async function read(_context: CapabilityContext): Promise<string> {",
      '  return "No records from cap_hidden are shown.";',
      "}",
    ].join("\n");

    for (const content of [templateSql, concatenatedSql, aliasedQuery, renamedQuery]) {
      expect(
        checkGeneratedUnit(notesSpec(), { kind: "handler", name: "read" }, content)?.message,
      ).toContain("undeclared capability table: cap_hidden");
    }
    expect(
      checkGeneratedUnit(notesSpec(), { kind: "handler", name: "read" }, ordinaryCopy),
    ).toBeUndefined();
  });

  test("rejects toolbox-derived connection access without reserving ordinary result fields", () => {
    const destructured = [
      "export default async function read({ query }: CapabilityContext): Promise<string> {",
      "  const { connection } = query as unknown as { connection: unknown };",
      "  void connection;",
      '  return "";',
      "}",
    ].join("\n");
    const computed = [
      "export default async function read({ query }: CapabilityContext): Promise<string> {",
      '  const key = "connection";',
      "  void (query as unknown as Record<string, unknown>)[key];",
      '  return "";',
      "}",
    ].join("\n");
    const renamedContext = [
      "export default async function read(ctx: CapabilityContext): Promise<string> {",
      "  void (ctx as unknown as { db: unknown }).db;",
      '  return "";',
      "}",
    ].join("\n");
    const dynamicConnection = [
      "export default async function read(ctx: CapabilityContext): Promise<string> {",
      '  const key = String(ctx.input.values.key ?? "");',
      "  void (ctx as unknown as Record<string, unknown>)[key];",
      '  return "";',
      "}",
    ].join("\n");
    for (const content of [destructured, computed, renamedContext, dynamicConnection]) {
      expect(
        checkGeneratedUnit(notesSpec(), { kind: "handler", name: "read" }, content)?.message,
      ).toContain("must not access a database connection directly");
    }

    for (const field of ["database", "db", "sqlite", "connection"]) {
      const resultField = [
        "export default async function read({ query }: CapabilityContext): Promise<string> {",
        "  const rows = query.all({",
        `    sql: 'SELECT "text" AS "${field}" FROM "cap_notes"',`,
        `    result: [{ alias: "${field}", type: "string" }],`,
        "  });",
        `  return String(rows[0]?.${field} ?? "");`,
        "}",
      ].join("\n");
      expect(
        checkGeneratedUnit(notesSpec(), { kind: "handler", name: "read" }, resultField),
      ).toBeUndefined();
    }
  });

  test("does not interpret SQL guidance in comments as executable mutation SQL", () => {
    const guidance = [
      "export default async function read(_context: CapabilityContext): Promise<string> {",
      "  // Never INSERT INTO capability tables directly.",
      "  // Never fetch https://example.com from a generated Handler.",
      '  return "";',
      "}",
    ].join("\n");
    expect(
      checkGeneratedUnit(notesSpec(), { kind: "handler", name: "read" }, guidance),
    ).toBeUndefined();
  });
});

describe("unit generation with bounded fix loop — item-renderer prompt", () => {
  test("builds the item-renderer prompt from the collection layout and the design direction", () => {
    const item = { kind: "item-renderer", name: "item" } as const;
    const feed = notesSpec();
    const grid = notesSpec({ ui_intent: { ...feed.ui_intent, collection: { layout: "grid" } } });
    const feedPrompt = buildUnitPrompt(feed, item);
    const gridPrompt = buildUnitPrompt(grid, item);

    expect(feedPrompt).toContain(feed.ui_intent.item.direction);
    expect(feedPrompt).toContain(buildItemRendererDesignInjection("feed"));
    expect(gridPrompt).toContain(buildItemRendererDesignInjection("grid"));
    // The closed vocabulary and every exemplar are injected whole (single source of truth).
    expect(linesNaming(feedPrompt, [...ALLOWED_CLASSES])).not.toEqual([]);
    for (const tokens of [PALETTE_COLOR_TOKENS, TYPE_SIZE_TOKENS, SPACING_TOKENS]) {
      expect(
        linesNaming(
          feedPrompt,
          [...tokens].map((token) => `var(--${token})`),
        ),
      ).not.toEqual([]);
    }
    for (const example of FEW_SHOT_DESIGN_EXAMPLES.filter(({ onlyFor }) => !onlyFor)) {
      expect(feedPrompt).toContain(example.title);
      expect(feedPrompt).toContain(example.rendererSource);
    }
    // No exemplar contradicts the ban on a drawn edge.
    expect(feedPrompt).not.toContain("border: var(--line)");
  });

  test("tells a feed and a grid item how to compose, not only which one it is", () => {
    const composing = (from: "feed" | "grid", to: "feed" | "grid") =>
      new Set(
        addedLines(
          buildItemRendererDesignInjection(from),
          buildItemRendererDesignInjection(to),
        ).map((line) => line.replaceAll(to, "LAYOUT")),
      );
    expect(composing("feed", "grid")).not.toEqual(composing("grid", "feed"));
  });

  test("projects exact shown name/type/label descriptors and hides inactive generation context", () => {
    const spec = notesSpec({
      schema: {
        fields: [
          { name: "text", label: "Entry", type: "string", required: true, lifecycle: "active" },
          {
            name: "note",
            label: "Side note",
            type: "string",
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
        form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
        item: {
          direction: "Show the entry and when it was created.",
          shows: ["text", "created_at"],
        },
        collection: { layout: "feed" },
      },
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
    });

    const itemPrompt = buildUnitPrompt(spec, { kind: "item-renderer", name: "item" });
    expect(linesNaming(itemPrompt, ["text", "string", "Entry"])).not.toEqual([]);
    expect(linesNaming(itemPrompt, ["created_at", "datetime"])).not.toEqual([]);
    expect(itemPrompt).not.toContain("Side note");
    expect(itemPrompt).not.toContain("retired_note");
    expect(itemPrompt).not.toContain("Retired note");

    const createPrompt = buildUnitPrompt(spec, { kind: "handler", name: "create" });
    // Both are strings, so only their requiredness can tell their lines apart.
    const fieldLine = (name: string) =>
      createPrompt.split("\n").find((line) => new RegExp(`^- ${name}\\b`).test(line));
    const textLine = fieldLine("text");
    const noteLine = fieldLine("note");
    expect(textLine).toBeDefined();
    expect(textLine?.replace("text", "field")).not.toBe(noteLine?.replace("note", "field"));
    expect(createPrompt).not.toContain("Entry");
    expect(createPrompt).not.toContain("Side note");
    expect(createPrompt).toContain("extra");
    expect(createPrompt).toContain("unavailable");
    expect(createPrompt).not.toContain("retired_note");
    expect(createPrompt).not.toContain("Retired note");
  });
});

describe("unit generation with bounded fix loop — read, few-shot, and present-adapter prompts", () => {
  test("the read handler prompt defers the empty state to the platform, never emitting its own", () => {
    // Regression: the read prompt used to ask for an empty state. A handler's own markup fills
    // `#<id>-records`, defeating the platform's `:empty` and lingering below a created record.
    const readPrompt = buildUnitPrompt(notesSpec(), { kind: "handler", name: "read" });

    // The stale instruction is gone: the handler must NOT author its own empty state.
    expect(readPrompt).not.toMatch(/empty state when there are no rows/i);

    // The shared "non-record text" note no longer offers an empty state as an example
    // of text a handler may emit — only genuinely handler-owned copy (validation errors).
    expect(readPrompt).not.toMatch(/non-record text you emit \([^)]*empty state/i);

    // The create prompt is unchanged: it still returns the inserted row through `present`.
    const createPrompt = buildUnitPrompt(notesSpec(), { kind: "handler", name: "create" });
    expect(createPrompt).toContain("return `present(row)`");
  });

  test("curates diverse repo-only few-shot exemplars, including a token-disciplined style hatch", () => {
    expect(FEW_SHOT_DESIGN_EXAMPLES.length).toBeGreaterThanOrEqual(3);
    expect(new Set(FEW_SHOT_DESIGN_EXAMPLES.map((example) => example.layout))).toEqual(
      new Set(["feed", "grid"]),
    );
    expect(FEW_SHOT_DESIGN_EXAMPLES.every((example) => example.previewSamples.length === 2)).toBe(
      true,
    );
    expect(
      FEW_SHOT_DESIGN_EXAMPLES.some((example) => example.rendererSource.includes("style=")),
    ).toBe(true);
    // No exemplar draws a boundary: the ink system owns every one, and an example that
    // declared a border would teach the model the thing the rung now refuses.
    expect(
      FEW_SHOT_DESIGN_EXAMPLES.every((example) => !example.rendererSource.includes("border")),
    ).toBe(true);
    expect(
      FEW_SHOT_DESIGN_EXAMPLES.every((example) =>
        example.rendererSource.includes("export default function renderItem"),
      ),
    ).toBe(true);
  });
});

describe("unit generation with bounded fix loop — dependency projection", () => {
  test("new Handler context includes only active fields from declared dependencies", () => {
    const base = notesSpec();
    const requiredError = base.behavioral_errors[0];
    if (!requiredError) throw new Error("notes fixture requires one validation error");
    const incarnation_id = FIRST_INCARNATION_ID;
    const dependency: CapabilityRow = {
      ...base,
      id: "recipes",
      label: "Recipes",
      incarnation_id,
      version: 2,
      artifacts_path: `capabilities/recipes/${incarnation_id}/v2/`,
      seed: 184206,
      logo: { status: "absent", attempts: 0 },
      display_label_override: null,
      schema: {
        fields: [
          { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
          {
            name: "retired_secret",
            label: "Retired secret",
            type: "string",
            required: false,
            lifecycle: "inactive",
          },
        ],
      },
      ui_intent: {
        ...base.ui_intent,
        item: { ...base.ui_intent.item, shows: ["title"] },
      },
      behavioral_errors: [
        {
          ...requiredError,
          fields: ["title"],
        },
      ],
    };
    const target: CapabilitySpec = {
      ...base,
      tools: [...FULL_CAPABILITY_TOOLS],
      behavioral_errors: defaultBehavioralErrorsForSchema(base.schema),
      read_dependencies: {
        create: [],
        read: [{ capability_id: dependency.id, incarnation_id }],
        update: [],
        delete: [],
        search: [],
      },
    };

    const prompt = buildUnitPrompt(target, { kind: "handler", name: "read" }, undefined, [
      dependency,
    ]);
    expect(prompt).toContain('"capability_id": "recipes"');
    expect(prompt).toContain('"name": "title"');
    expect(prompt).not.toContain("retired_secret");
  });
});

describe("unit generation with bounded fix loop — per-Action context projection", () => {
  test("search generation carries an authored ranking to the model", () => {
    const behavior = "Matching search results are ordered oldest first.";
    const search = buildUnitPrompt(fullNotesSpec({ behavior }), {
      kind: "handler",
      name: "search",
    });
    expect(search).toContain(behavior);
  });

  test("the update prompt no longer says the platform translates its failure", () => {
    const update = buildUnitPrompt(fullNotesSpec(), { kind: "handler", name: "update" });
    expect(update).not.toContain("the platform turns it into");
  });

  test("projects target fields, dependencies, and errors independently for every Action", () => {
    const { withDependencies, catalog } = projectedContextFixture();

    const create = actionGenerationContext(
      buildUnitPrompt(withDependencies, { kind: "handler", name: "create" }, undefined, catalog),
    );
    const read = actionGenerationContext(
      buildUnitPrompt(withDependencies, { kind: "handler", name: "read" }, undefined, catalog),
    );
    const update = actionGenerationContext(
      buildUnitPrompt(withDependencies, { kind: "handler", name: "update" }, undefined, catalog),
    );
    const remove = actionGenerationContext(
      buildUnitPrompt(withDependencies, { kind: "handler", name: "delete" }, undefined, catalog),
    );
    const search = actionGenerationContext(
      buildUnitPrompt(withDependencies, { kind: "handler", name: "search" }, undefined, catalog),
    );

    expect(create.schema).toEqual({
      fields: [
        { name: "text", type: "string", required: true },
        { name: "tags", type: "string[]", required: false },
        { name: "score", type: "number", required: false },
      ],
    });
    expect(update.schema).toEqual(create.schema);
    expect(search.schema).toEqual({
      fields: [
        { name: "text", type: "string" },
        { name: "tags", type: "string[]" },
      ],
    });
    expect(read.schema).toEqual({ fields: [] });
    expect(remove.schema).toEqual({ fields: [] });
    expect(
      (create.behavioral_errors as Array<{ action: string }>).map((item) => item.action),
    ).toEqual(["create"]);
    expect(
      (update.behavioral_errors as Array<{ action: string }>).map((item) => item.action),
    ).toEqual(["update"]);
    expect(read.behavioral_errors).toEqual([]);
    expect(read.read_dependencies).toEqual([
      expect.objectContaining({ capability_id: "journals" }),
    ]);
    expect(search.read_dependencies).toEqual([
      expect.objectContaining({ capability_id: "recipes" }),
    ]);
    expect(create.read_dependencies).toEqual([]);
    expect(JSON.stringify({ create, read, update, remove, search })).not.toContain(
      "retired_secret",
    );
    expect(JSON.stringify({ create, read, update, remove, search })).not.toContain("hidden_text");
    expect(JSON.stringify({ create, read, update, remove, search })).not.toContain('"extra"');
  });
});

describe("unit generation with bounded fix loop — retry, strict-index, and validation-marker prompts", () => {
  test("retry feedback calls out strict unchecked-index failures", () => {
    const unsafeRegexCapture = [
      "export default async function read({ query }: CapabilityContext): Promise<string> {",
      '  const rows = query.all({ sql: \'SELECT * FROM "cap_notes"\', result: [{ alias: "created_at", type: "datetime" }] });',
      '  const match = String(rows[0]?.created_at ?? "").match(/^(\\d{4}-\\d{2}-\\d{2})/);',
      "  if (match) return match[1];",
      '  return "";',
      "}",
    ].join("\n");

    const failure = checkGeneratedUnit(
      notesSpec(),
      { kind: "handler", name: "read" },
      unsafeRegexCapture,
    );
    expect(failure?.message).toContain("noUncheckedIndexedAccess");
    expect(failure?.message).toContain("regex captures");
    expect(failure?.message).toContain(
      "Type 'string | undefined' is not assignable to type 'string'",
    );
  });

  test("handler prompts include the stable validation error marker contract", () => {
    const prompt = buildUnitPrompt(notesSpec(), { kind: "handler", name: "create" });

    expect(prompt).toContain(
      `${BEHAVIORAL_ERROR_MARKERS.role_attribute}="${BEHAVIORAL_ERROR_MARKERS.role}"`,
    );
    expect(prompt).toContain(BEHAVIORAL_ERROR_MARKERS.code_attribute);
    expect(prompt).toContain(BEHAVIORAL_ERROR_MARKERS.fields_attribute);
    expect(prompt).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
    expect(prompt).not.toContain(
      "required empty values must reach the platform mutation validation and fail",
    );
  });
});
