// The link step's answer, checked entry by entry. No test calls a real provider: a recording
// fake answers what each test scripts.

import { describe, expect, test } from "bun:test";
import { zodSchema } from "ai";
import type { GenerateResult, Provider, TokenUsage } from "../../platform/provider/index.ts";
import { ProviderStageTimeoutError } from "../../platform/provider/spine.ts";
import type { CapabilitySpec, Relation } from "../../registry/index.ts";
import { validSpec } from "../../registry/spec/spec.test-support.ts";
import {
  AUTHORS,
  AUTHORS_INCARNATION,
  BOOKS,
  BOOKS_INCARNATION,
  deskRow,
  MEMOS,
  textField,
} from "../../server/routes/lifecycle/link.test-support.ts";
import { relatedCapabilityView } from "../spec/related-capabilities.ts";
import { makeSpecProvider } from "../spec/spec-gen.test-support.ts";
import { linkStepAnswerSchema, runLinkStep } from "./link-step.ts";

const INVENTORY: CapabilitySpec = (() => {
  const spec = validSpec({
    id: "inventory",
    label: "Inventory",
    noun: "copy",
    plural_noun: "copies",
    schema: {
      fields: [
        textField("book", "Book"),
        textField("writer", "Writer", { max_length: 120 }),
        textField("review", "Review"),
        textField("short_title", "Short title", { max_length: 50 }),
        textField("memo", "Memo"),
        { name: "copies", label: "Copies", type: "number", required: true, lifecycle: "active" },
      ],
    },
  });
  return {
    ...spec,
    ui_intent: { ...spec.ui_intent, form: { ...spec.ui_intent.form, long_text: ["review"] } },
  };
})();

const CATALOG = [deskRow(AUTHORS), deskRow(BOOKS), deskRow(MEMOS)];
const FLAGGED = CATALOG.filter(({ id }) => id === BOOKS.id || id === AUTHORS.id);

const REQUEST = "track how many copies of each book I own";
const COST: TokenUsage = { inputTokens: 900, outputTokens: 40, totalTokens: 940 };

interface Overrides {
  readonly spec?: CapabilitySpec;
  readonly relations?: readonly Relation[];
  readonly flagged?: typeof CATALOG;
  readonly provider?: Provider;
}

function linkWith(answer: unknown, overrides: Overrides = {}) {
  const recording = makeSpecProvider(answer, COST);
  const spec = overrides.spec ?? INVENTORY;
  const result = runLinkStep({
    provider: overrides.provider ?? recording,
    request: REQUEST,
    source: {
      ...spec,
      incarnation_id: "inc_inventory",
      display_label_override: null,
      relations: overrides.relations ?? [],
    },
    flagged: overrides.flagged ?? FLAGGED,
    catalog: CATALOG,
  });
  return { result, calls: recording.calls };
}

/** The pretty-printed JSON block a prompt line opens with `open` alone and closes with `close`. */
function block(prompt: string, open: string, close: string): unknown {
  const lines = prompt.split("\n");
  const start = lines.indexOf(open);
  return JSON.parse(lines.slice(start, lines.indexOf(close, start) + 1).join("\n"));
}

const entry = (field: string, capability: string, target_field: string) => ({
  field,
  capability,
  target_field,
});

const bookToTitle: Relation = {
  field: "book",
  to: { capability: BOOKS.id, incarnation: BOOKS_INCARNATION, field: "title" },
};
const writerToName: Relation = {
  field: "writer",
  to: { capability: AUTHORS.id, incarnation: AUTHORS_INCARNATION, field: "name" },
};

describe("the link step's answer", () => {
  test("each entry is checked on its own: a bad one is dropped and the good ones kept", async () => {
    const { result } = linkWith({
      relations: [
        entry("book", BOOKS.id, "title"),
        entry("ghost", BOOKS.id, "title"),
        entry("memo", MEMOS.id, "subject"),
        entry("review", BOOKS.id, "title"),
        entry("memo", BOOKS.id, "notes"),
        entry("short_title", BOOKS.id, "title"),
        entry("book", BOOKS.id, "author"),
        { ...entry("writer", AUTHORS.id, "name"), reason: "a stray key costs nothing" },
      ],
    });

    expect((await result).relations).toStrictEqual([bookToTitle, writerToName]);
  });

  test("a field that already holds a relation is neither offered nor linked again", async () => {
    const { result, calls } = linkWith(
      { relations: [entry("book", BOOKS.id, "author"), entry("writer", AUTHORS.id, "name")] },
      { relations: [bookToTitle] },
    );

    expect((await result).relations).toStrictEqual([writerToName]);
    const offered = block(calls[0]?.prompt ?? "", "{", "}") as {
      single_line_text_fields: { name: string }[];
    };
    expect(offered.single_line_text_fields.map(({ name }) => name)).not.toContain("book");
  });

  test("the model sees the request and each side's single-line text fields with their limits", async () => {
    const noTextFields = deskRow({ ...BOOKS, id: "shelves", fields: BOOKS.fields.slice(2) });
    const { result, calls } = linkWith({ relations: [] }, { flagged: [...FLAGGED, noTextFields] });
    await result;
    const prompt = calls[0]?.prompt ?? "";
    const field = (name: string, label: string, max_length: number | null = null) => ({
      name,
      label,
      max_length,
    });

    expect(block(prompt, "{", "}")).toStrictEqual({
      ...relatedCapabilityView({ ...INVENTORY, display_label_override: null }),
      single_line_text_fields: [
        field("book", "Book"),
        field("writer", "Writer", 120),
        field("short_title", "Short title", 50),
        field("memo", "Memo"),
      ],
    });
    expect(block(prompt, "[", "]")).toStrictEqual(
      FLAGGED.map((row) => ({ id: row.id, ...relatedCapabilityView(row) })),
    );
    expect(prompt).toContain(REQUEST);
  });
});

describe("the link step's call", () => {
  const down = new Error("the provider is down");
  const broke = new Error("the stream broke");
  const timedOut = new ProviderStageTimeoutError("five minutes");
  test.each([
    [
      "throws",
      down,
      null,
      (): GenerateResult<never> => {
        throw down;
      },
    ],
    [
      "fails",
      broke,
      COST,
      (): GenerateResult<never> => ({
        partialStream: (async function* () {})(),
        object: Promise.reject(broke),
        usage: Promise.resolve(COST),
      }),
    ],
    [
      "times out",
      timedOut,
      null,
      (): GenerateResult<never> => {
        const late = Promise.reject(timedOut);
        return { partialStream: (async function* () {})(), object: late, usage: late };
      },
    ],
  ])("a step that %s links nothing, says why, and keeps what the call cost", async (_, why, cost, generate) => {
    const linked = await linkWith(undefined, { provider: { generate } }).result;

    expect(linked.relations).toStrictEqual([]);
    expect(linked.usage).toStrictEqual(cost);
    expect(linked.failure).toBe(why);
  });

  test("an answer off the shape links nothing, says why, and keeps what the call cost", async () => {
    const linked = await linkWith({ relations: [{ field: "book", capability: 7 }] }).result;

    expect(linked.relations).toStrictEqual([]);
    expect(linked.usage).toStrictEqual(COST);
    expect(linked.failure).toBeInstanceOf(Error);
  });

  test("the answer's provider schema requires every key", async () => {
    const objects: { properties: Record<string, unknown>; required?: string[] }[] = [];
    const visit = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      const { properties } = node as { properties?: Record<string, unknown> };
      if (properties) objects.push(node as (typeof objects)[number]);
      for (const child of Object.values(node)) visit(child);
    };
    visit(await zodSchema(linkStepAnswerSchema).jsonSchema);

    expect(objects.flatMap(({ properties }) => Object.keys(properties)).sort()).toStrictEqual(
      ["capability", "field", "relations", "target_field"].sort(),
    );
    for (const { properties, required } of objects) {
      expect([...(required ?? [])].sort()).toStrictEqual(Object.keys(properties).sort());
    }
    expect(linkStepAnswerSchema.safeParse({ relations: [{ field: "book" }] }).success).toBe(false);
  });

  test("no call is made when no relation could join the two sides", async () => {
    const numbersOnly = validSpec({
      schema: {
        fields: [
          { name: "count", label: "Count", type: "number", required: true, lifecycle: "active" },
        ],
      },
    });
    const noTextFields = deskRow({ ...BOOKS, fields: BOOKS.fields.slice(2) });
    for (const overrides of [{ flagged: [] }, { flagged: [noTextFields] }, { spec: numbersOnly }]) {
      const { result, calls } = linkWith(
        { relations: [entry("book", BOOKS.id, "title")] },
        overrides,
      );
      expect((await result).relations).toStrictEqual([]);
      expect(calls).toHaveLength(0);
    }
  });
});
