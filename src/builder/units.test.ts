// Tests for unit generation with the bounded fix loop (Epic 2.5, issue 04).
//
// Every provider here is fake. The stage still drives the real loop: structured
// generation through the Provider contract, isolated handler type-checks, static
// ADR-0004 contract checks, view hook validation, feedback prompts, and attempt
// metrics.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { ZodType } from "zod";

import type { DeepPartial, GenerateResult, Provider, TokenUsage } from "../provider/index.ts";
import type { CapabilitySpec } from "../registry/index.ts";
import {
  buildUnitPrompt,
  DEFAULT_UNIT_FIX_ATTEMPTS,
  generateCapabilityUnits,
  UnitGenerationError,
} from "./index.ts";

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
    ui_intent: { views: ["list", "create"] },
    behavior: "Text is required. Newest notes appear first.",
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

const CREATE_HANDLER = [
  "export default async function create({ input, data }: CapabilityContext): Promise<string> {",
  "  const values: Record<string, unknown> = { text: input.text };",
  "  if (input.pinned !== undefined) {",
  '    values.pinned = input.pinned === "true" || input.pinned === "on";',
  "  }",
  "",
  "  const note = data.insert(values);",
  "",
  '  return `<article class="note"><p>$' + "{escapeHtml(note.text)}</p></article>`;",
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

const READ_HANDLER = [
  "export default async function read({ data }: CapabilityContext): Promise<string> {",
  "  const notes = data.select();",
  "  if (notes.length === 0) {",
  '    return \'<ul class="notes" data-empty="true"></ul>\';',
  "  }",
  "",
  "  const items = notes",
  '    .map((note) => `<li class="note">$' + "{escapeHtml(note.text)}</li>`)",
  '    .join("");',
  "",
  '  return `<ul class="notes">$' + "{items}</ul>`;",
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

const LIST_VIEW = `<section class="capability-view" aria-labelledby="notes-heading">
  <header>
    <h2 id="notes-heading">Notes</h2>
  </header>
  <div id="notes-list" hx-get="/capability/notes/read" hx-trigger="load" hx-swap="innerHTML"></div>
</section>`;

const CREATE_VIEW = `<form class="capability-form" hx-post="/capability/notes/create" hx-target="#notes-list" hx-swap="afterbegin">
  <label>
    <span>Text</span>
    <textarea name="text" required></textarea>
  </label>
  <label>
    <input type="checkbox" name="pinned" value="on" />
    <span>Pinned</span>
  </label>
  <button type="submit">Add</button>
</form>`;

const BAD_CREATE_HANDLER = `export default async function create({ input, data }: CapabilityContext): Promise<string> {
  data.insert({ text: input.text });
  return 123;
}`;

const UNTYPED_BAD_HANDLER = `export default async function create({ input, data }) {
  data.insert({ text: input.text });
  return 123;
}`;

describe("unit generation with bounded fix loop", () => {
  test("generates the four M2 units, validates their contracts, and records metrics", async () => {
    const provider = makeQueuedProvider([CREATE_HANDLER, READ_HANDLER, LIST_VIEW, CREATE_VIEW]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    expect(provider.calls).toHaveLength(4);
    expect(result.units.map((unit) => `${unit.kind}:${unit.name}`)).toEqual([
      "handler:create",
      "handler:read",
      "view:list",
      "view:create",
    ]);
    expect(result.handlers.create).toBe(CREATE_HANDLER);
    expect(result.handlers.read).toBe(READ_HANDLER);
    expect(result.views.list).toBe(LIST_VIEW);
    expect(result.views.create).toBe(CREATE_VIEW);

    for (const unit of result.units) {
      expect(unit.attempts).toHaveLength(1);
      expect(unit.attempts[0]?.error).toBeUndefined();
      expect(unit.durationMs).toBeGreaterThanOrEqual(0);
      expect(unit.usage).toEqual(STUB_USAGE);
      expect(unit.attempts[0]?.usage).toEqual(STUB_USAGE);
    }

    expect(result.handlers.create).not.toMatch(
      /\bimport\b|\bfetch\b|\bRequest\b|\bResponse\b|cap_notes/,
    );
    expect(result.views.list).toContain('hx-get="/capability/notes/read"');
    expect(result.views.create).toContain('hx-post="/capability/notes/create"');
    expect(result.views.list).not.toMatch(/\bdata-id=|\bcreated_at\b|<li\b/i);
  });

  test("feeds a type-check failure back into regeneration and accepts the fixed unit", async () => {
    const provider = makeQueuedProvider([
      BAD_CREATE_HANDLER,
      CREATE_HANDLER,
      READ_HANDLER,
      LIST_VIEW,
      CREATE_VIEW,
    ]);

    const result = await generateCapabilityUnits({ provider, spec: notesSpec() });

    expect(provider.calls).toHaveLength(5);
    expect(result.handlers.create).toBe(CREATE_HANDLER);
    const createUnit = result.units.find(
      (unit) => unit.kind === "handler" && unit.name === "create",
    );
    expect(createUnit?.attempts).toHaveLength(2);
    expect(createUnit?.attempts[0]?.error).toContain("Type 'number' is not assignable");
    expect(createUnit?.attempts[1]?.error).toBeUndefined();
    expect(createUnit?.usage).toEqual({ inputTokens: 6, outputTokens: 10, totalTokens: 16 });

    expect(provider.calls[1]?.prompt).toContain("Previous attempt failed");
    expect(provider.calls[1]?.prompt).toContain("Type 'number' is not assignable");
  });

  test("uses the default two-attempt cap and fails without returning a broken unit", async () => {
    const provider = makeQueuedProvider([UNTYPED_BAD_HANDLER, UNTYPED_BAD_HANDLER]);

    await expect(generateCapabilityUnits({ provider, spec: notesSpec() })).rejects.toThrow(
      UnitGenerationError,
    );

    try {
      await generateCapabilityUnits({
        provider: makeQueuedProvider([UNTYPED_BAD_HANDLER, UNTYPED_BAD_HANDLER]),
        spec: notesSpec(),
      });
      throw new Error("expected unit generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(UnitGenerationError);
      const unitError = error as UnitGenerationError;
      expect(unitError.unit).toEqual({ kind: "handler", name: "create" });
      expect(unitError.attempts).toHaveLength(DEFAULT_UNIT_FIX_ATTEMPTS);
      expect(unitError.attempts.every((attempt) => attempt.error)).toBe(true);
      expect(unitError.attempts[0]?.error).toContain(
        "Binding element 'input' implicitly has an 'any' type",
      );
    }
  });

  test("rejects cached views that bake row data instead of loading through the read action", async () => {
    const badListView = `<section>
  <ul><li data-id="sample">A saved note</li></ul>
</section>`;
    const provider = makeQueuedProvider([CREATE_HANDLER, READ_HANDLER, badListView, badListView]);

    await expect(generateCapabilityUnits({ provider, spec: notesSpec() })).rejects.toThrow(
      UnitGenerationError,
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
});
