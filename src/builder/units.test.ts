// Tests for unit generation with the bounded fix loop (Epic 2.5, re-cut in 3.4/02).
//
// Every provider here is fake. The stage still drives the real loop: structured
// generation through the Provider contract, the item-renderer + handler static checks
// (export shape, no imports, isolated type-checks against the ADR-0004/0005 contracts),
// feedback prompts, and attempt metrics. The three generated units are the item
// renderer (first, the creative surface) then the create/read handlers that render
// records through the injected `present` adapter.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ZodType } from "zod";

import type { DeepPartial, GenerateResult, Provider, TokenUsage } from "../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  buildUnitPrompt,
  DEFAULT_UNIT_FIX_ATTEMPTS,
  generateCapabilityUnits,
  UnitGenerationError,
} from "./index.ts";
import { checkGeneratedUnit } from "./unit-checks.ts";

const STUB_USAGE: TokenUsage = { inputTokens: 3, outputTokens: 5, totalTokens: 8 };

setDefaultTimeout(15_000);

interface RecordedProvider extends Provider {
  readonly calls: Array<{ prompt: string; content: string }>;
}

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "text", type: "string", required: true },
        { name: "pinned", type: "boolean", required: false },
      ],
    },
    ui_intent: {
      item: "A text-forward card that emphasizes text and pinned status.",
      collection: { layout: "feed" },
      detail: { shows: ["text", "pinned"] },
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
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
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

// The one generated presentation surface: record → inner markup, composed from the
// closed primitive vocabulary, escaping every field value. Synchronous default export.
const ITEM_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  "  const text = escapeHtml(record.text);",
  '  return `<div class="stack"><span class="text-lg text-bold truncate">$' +
    "{text}</span></div>`;",
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

// The create handler renders the inserted row through the injected `present` adapter —
// no row markup of its own (ADR-0005 §2).
const CREATE_HANDLER = [
  "export default async function create({ input, data, present }: CapabilityContext): Promise<string> {",
  "  const values: Record<string, unknown> = { text: input.text };",
  "  if (input.pinned !== undefined) {",
  '    values.pinned = input.pinned === "true" || input.pinned === "on";',
  "  }",
  "",
  "  const row = data.insert(values);",
  "  return present(row);",
  "}",
].join("\n");

// The read handler maps every row through `present` and joins them — identical item
// markup to create, by construction.
const READ_HANDLER = [
  "export default async function read({ data, present }: CapabilityContext): Promise<string> {",
  "  const notes = data.select();",
  "  if (notes.length === 0) return '<p class=\"capability-empty-hint\">No notes yet.</p>';",
  '  return notes.map((note) => present(note)).join("");',
  "}",
].join("\n");

// Fails the isolated type-check: an async handler returning a bare number.
const BAD_CREATE_HANDLER = `export default async function create({ input, data }: CapabilityContext): Promise<string> {
  data.insert({ text: input.text });
  return 123;
}`;

// Fails the type-check with implicit-any bindings (no annotation on the context param).
const UNTYPED_BAD_HANDLER = `export default async function create({ input, data }) {
  data.insert({ text: input.text });
  return 123;
}`;

// Fails the item-renderer type-check: returns the raw `unknown` record value.
const BAD_ITEM_RENDERER = `export default function renderItem(record: Record<string, unknown>): string {
  return record.text;
}`;

describe("unit generation with bounded fix loop", () => {
  test("generates one item renderer + create/read handlers, validates contracts, records metrics", async () => {
    const provider = makeQueuedProvider([ITEM_RENDERER, CREATE_HANDLER, READ_HANDLER]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    expect(provider.calls).toHaveLength(3);
    expect(result.units.map((unit) => `${unit.kind}:${unit.name}`)).toEqual([
      "item-renderer:item",
      "handler:create",
      "handler:read",
    ]);
    expect(result.units.map((unit) => unit.filename)).toEqual(["item.ts", "create.ts", "read.ts"]);
    expect(result.itemRenderer).toBe(ITEM_RENDERER);
    expect(result.handlers.create).toBe(CREATE_HANDLER);
    expect(result.handlers.read).toBe(READ_HANDLER);

    for (const unit of result.units) {
      expect(unit.attempts).toHaveLength(1);
      expect(unit.attempts[0]?.error).toBeUndefined();
      expect(unit.durationMs).toBeGreaterThanOrEqual(0);
      expect(unit.usage).toEqual(STUB_USAGE);
      expect(unit.attempts[0]?.usage).toEqual(STUB_USAGE);
    }

    // Handlers render records through the injected adapter and import nothing.
    expect(result.handlers.create).toContain("present(row)");
    expect(result.handlers.read).toContain("present(note)");
    expect(result.handlers.create).not.toMatch(
      /\bimport\b|\bfetch\b|\bRequest\b|\bResponse\b|cap_notes/,
    );
    // The item renderer is a synchronous default-exported function.
    expect(result.itemRenderer).toContain("export default function renderItem");
    expect(result.itemRenderer).not.toContain("async");
  });

  test("feeds an item-renderer type-check failure back into regeneration and accepts the fix", async () => {
    const provider = makeQueuedProvider([
      BAD_ITEM_RENDERER,
      ITEM_RENDERER,
      CREATE_HANDLER,
      READ_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    expect(provider.calls).toHaveLength(4);
    expect(result.itemRenderer).toBe(ITEM_RENDERER);
    const rendererUnit = result.units.find((unit) => unit.kind === "item-renderer");
    expect(rendererUnit?.attempts).toHaveLength(2);
    expect(rendererUnit?.attempts[0]?.error).toContain("is not assignable to type 'string'");
    expect(rendererUnit?.attempts[1]?.error).toBeUndefined();
    expect(rendererUnit?.usage).toEqual({ inputTokens: 6, outputTokens: 10, totalTokens: 16 });

    // The retry prompt echoes the failure back so the model returns a corrected unit.
    expect(provider.calls[1]?.prompt).toContain("Previous attempt failed");
    expect(provider.calls[1]?.prompt).toContain("is not assignable to type 'string'");
  });

  test("feeds a handler type-check failure back into regeneration and accepts the fixed unit", async () => {
    const provider = makeQueuedProvider([
      ITEM_RENDERER,
      BAD_CREATE_HANDLER,
      CREATE_HANDLER,
      READ_HANDLER,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    expect(provider.calls).toHaveLength(4);
    expect(result.handlers.create).toBe(CREATE_HANDLER);
    const createUnit = result.units.find(
      (unit) => unit.kind === "handler" && unit.name === "create",
    );
    expect(createUnit?.attempts).toHaveLength(2);
    expect(createUnit?.attempts[0]?.error).toContain("Type 'number' is not assignable");
    expect(createUnit?.attempts[1]?.error).toBeUndefined();
    expect(createUnit?.usage).toEqual({ inputTokens: 6, outputTokens: 10, totalTokens: 16 });

    expect(provider.calls[2]?.prompt).toContain("Previous attempt failed");
    expect(provider.calls[2]?.prompt).toContain("Type 'number' is not assignable");
  });

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

  test("rejects an item renderer that imports or is async", () => {
    const importing = `import { escape } from "./x";\nexport default function renderItem(record: Record<string, unknown>): string {\n  return escape(String(record.text));\n}`;
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

  test("builds the item-renderer prompt knowing the collection layout and design direction", () => {
    const feedPrompt = buildUnitPrompt(notesSpec(), { kind: "item-renderer", name: "item" });
    expect(feedPrompt).toContain("Generate the item.ts item renderer");
    expect(feedPrompt).toContain(
      "export default function renderItem(record: Record<string, unknown>): string",
    );
    expect(feedPrompt).toContain('arranged in a "feed" collection');
    expect(feedPrompt).toContain("full-width row");
    expect(feedPrompt).toContain("A text-forward card that emphasizes text and pinned status.");
    // The closed primitive vocabulary is injected (single source of truth).
    expect(feedPrompt).toContain("line-clamp-2");
    expect(feedPrompt).toContain("var(--space-*)");

    const gridPrompt = buildUnitPrompt(
      notesSpec({ ui_intent: { ...notesSpec().ui_intent, collection: { layout: "grid" } } }),
      { kind: "item-renderer", name: "item" },
    );
    expect(gridPrompt).toContain('arranged in a "grid" collection');
    expect(gridPrompt).toContain("compact, self-contained card");
  });

  test("handler prompts tell the model to render records through the present adapter", () => {
    const createPrompt = buildUnitPrompt(notesSpec(), { kind: "handler", name: "create" });
    expect(createPrompt).toContain("Generate the create.ts handler");
    expect(createPrompt).toContain("Render every record by calling the injected `present(record)`");
    expect(createPrompt).toContain("return `present(row)`");
    expect(createPrompt).toContain("Do NOT emit your own row/card/item markup");

    const readPrompt = buildUnitPrompt(notesSpec(), { kind: "handler", name: "read" });
    expect(readPrompt).toContain(
      "Destructure only `{ data, present }`: `export default async function read({ data, present }: CapabilityContext): Promise<string>`.",
    );
  });

  test("builds retry prompts from the unit contract and prior failure", () => {
    const prompt = buildUnitPrompt(
      notesSpec(),
      { kind: "handler", name: "read" },
      {
        kind: "handler",
        name: "read",
        message: "Generated handlers must not import anything.",
      },
    );

    expect(prompt).toContain("Generate the read.ts handler");
    expect(prompt).toContain("No imports.");
    expect(prompt).toContain("Previous attempt failed");
    expect(prompt).toContain("Generated handlers must not import anything.");
  });

  test("handler prompts and retry feedback call out strict unchecked-index failures", () => {
    const prompt = buildUnitPrompt(notesSpec(), { kind: "handler", name: "read" });
    expect(prompt).toContain("noUncheckedIndexedAccess");
    expect(prompt).toContain("Do not use unchecked array indexes or regex captures");

    const unsafeRegexCapture = [
      "export default async function read({ data }: CapabilityContext): Promise<string> {",
      "  const rows = data.select();",
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

    expect(prompt).toContain("Validation error contract:");
    expect(prompt).toContain(`${BEHAVIORAL_ERROR_MARKERS.role_attribute}="error"`);
    expect(prompt).toContain(BEHAVIORAL_ERROR_MARKERS.code_attribute);
    expect(prompt).toContain(BEHAVIORAL_ERROR_MARKERS.fields_attribute);
    expect(prompt).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
  });
});
