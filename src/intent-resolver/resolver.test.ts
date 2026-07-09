// Tests for the classification-only Intent Resolver slice (Epic 2.4).
//
// No test calls a real provider. The fake below records the prompt/schema and
// validates the returned object through the same provider contract shape the real
// spine exposes.

import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZodType } from "zod";

import { openDatabase, type PlatformDatabase } from "../db.ts";
import { runMigrations } from "../migrations.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilityRow,
  insertCapability,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  classifyIntent,
  classifyIntentWithUsage,
  INTENT_TYPES,
  type IntentClassification,
  intentClassificationSchema,
} from "./index.ts";

interface RecordedGenerateCall {
  readonly prompt: string;
  readonly schema: ZodType<unknown>;
}

interface RecordingProvider extends Provider {
  readonly calls: RecordedGenerateCall[];
}

function notesRow(overrides: Partial<CapabilityRow> = {}): CapabilityRow {
  return {
    id: "notes",
    label: "Notes",
    version: 1,
    schema: { fields: [{ name: "text", type: "string", required: true }] },
    ui_intent: {
      item: "A text-forward card that emphasizes the note text.",
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
    artifacts_path: "capabilities/notes/v1/",
    prompt_context: "Stores the user's text notes.",
    ...overrides,
  };
}

function recipesRow(): CapabilityRow {
  return {
    id: "recipes",
    label: "Recipes",
    version: 2,
    schema: { fields: [{ name: "title", type: "string", required: true }] },
    ui_intent: {
      item: "A text-forward card that emphasizes the recipe name.",
      collection: { layout: "feed" },
      detail: { shows: ["title"] },
    },
    behavior: "Recipes have titles and cooking notes.",
    behavioral_errors: [
      {
        action: "create",
        trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
        fields: ["title"],
        expected_markers: BEHAVIORAL_ERROR_MARKERS,
      },
    ],
    tools: ["create", "read"],
    artifacts_path: "capabilities/recipes/v2/",
    prompt_context: "Stores recipes the user wants to cook again.",
  };
}

function makeRecordingProvider(raw: unknown): RecordingProvider {
  const calls: RecordedGenerateCall[] = [];

  return {
    calls,
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      calls.push({ prompt, schema: schema as ZodType<unknown> });

      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield schema.parse(raw) as DeepPartial<T>;
      }

      return {
        partialStream: stream(),
        object: Promise.resolve().then(() => schema.parse(raw)),
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
      };
    },
  };
}

function insertRows(database: Database, rows: readonly CapabilityRow[]): void {
  for (const row of rows) {
    insertCapability(row, database);
  }
}

describe("intent resolver classification", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omni-crud-intent-"));
    conns = openDatabase(join(dir, "test.db"));
    runMigrations(conns.readwrite);
  });

  afterEach(() => {
    conns.readwrite.close();
    conns.readonly.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the schema speaks the full intent enum plus the reject bucket and keeps confirmations off in M2", () => {
    for (const type of INTENT_TYPES) {
      expect(
        intentClassificationSchema.parse({
          type,
          confidence: 0.8,
          target_capability: type === "new_capability" || type === "reject" ? null : "notes",
          proposed_action: "Classify the user's request.",
          user_facing_label: "I'm sorting out what you want to track.",
          requires_confirmation: false,
        }).type,
      ).toBe(type);
    }

    expect(() =>
      intentClassificationSchema.parse({
        type: "new_capability",
        confidence: 0.8,
        target_capability: null,
        proposed_action: "Create a notes space.",
        user_facing_label: "I'll start a place for your notes.",
        requires_confirmation: true,
      }),
    ).toThrow();
  });

  test("assembles every registry prompt_context plus the active capability for the provider call", async () => {
    const provider = makeRecordingProvider({
      type: "new_capability",
      confidence: 0.91,
      target_capability: null,
      proposed_action: "Create a trips capability.",
      user_facing_label: "I'll make a place for your trips.",
      requires_confirmation: false,
    });
    insertRows(conns.readwrite, [recipesRow(), notesRow()]);

    await classifyIntent({
      provider,
      prompt: "track my trips",
      activeCapabilityId: "notes",
      database: conns.readonly,
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.schema).toBe(intentClassificationSchema);
    expect(provider.calls[0]?.prompt).toContain("track my trips");
    expect(provider.calls[0]?.prompt).toContain("prompt_context: Stores the user's text notes.");
    expect(provider.calls[0]?.prompt).toContain(
      "prompt_context: Stores recipes the user wants to cook again.",
    );
    expect(provider.calls[0]?.prompt).toContain("Active capability:\nid: notes");
    expect(provider.calls[0]?.prompt).toContain(
      "If the prompt overlaps an existing capability, choose extend_capability",
    );
    expect(provider.calls[0]?.prompt).toContain(
      "Existing capability check — do this before deciding",
    );
    expect(provider.calls[0]?.prompt).toContain(
      "The registry context below is the complete list of existing capabilities",
    );
    expect(provider.calls[0]?.prompt).toContain(
      "Choose new_capability when the prompt names a distinct kind of thing with its own natural structure",
    );
    expect(provider.calls[0]?.prompt).toContain(
      "Do not choose extend_capability just because a generic capability could technically hold the information as unstructured text",
    );
    expect(provider.calls[0]?.prompt).toContain(
      "Do not overspecialize an existing capability with fields or behavior that belong to a different real-world thing",
    );
    expect(provider.calls[0]?.prompt).toContain(
      "I want to keep track of my recipes' is new_capability",
    );
    expect(provider.calls[0]?.prompt).toContain("'add due dates to my notes' is extend_capability");
    expect(provider.calls[0]?.prompt).toContain(
      "'let me store notes with images' is extend_capability",
    );
    expect(provider.calls[0]?.prompt).toContain("do not invent suffixed duplicate ids");
  });

  test("narrates the resolver stage in product voice before the provider round trip", async () => {
    const order: string[] = [];
    const provider = makeRecordingProvider({
      type: "new_capability",
      confidence: 0.91,
      target_capability: null,
      proposed_action: "Create a trips capability.",
      user_facing_label: "I'll make a place for your trips.",
      requires_confirmation: false,
    });
    const send = async (event: "narration", data: string) => {
      order.push(`${event}:${data}`);
    };
    const originalGenerate = provider.generate.bind(provider);
    provider.generate = <T>(prompt: string, schema: ZodType<T>): GenerateResult<T> => {
      order.push("provider");
      return originalGenerate(prompt, schema);
    };

    await classifyIntentWithUsage({
      provider,
      prompt: "track my trips",
      database: conns.readonly,
      send,
    });

    expect(order[0]).toMatch(/^narration:/);
    expect(order[1]).toBe("provider");
    expect(order[0]).toContain("new place");
    expect(order[0]).toContain("already started");
    expect(order[0]).not.toMatch(/intent|resolver|capability|registry|schema|provider/i);
  });

  test('classifies "track my notes" as extend_capability through a fake provider when Notes already exists', async () => {
    const provider = makeRecordingProvider({
      type: "extend_capability",
      confidence: 0.94,
      target_capability: "notes",
      proposed_action: "Add another way to track notes inside the existing Notes capability.",
      user_facing_label: "I can add that to your notes.",
      requires_confirmation: false,
    });
    insertRows(conns.readwrite, [notesRow()]);

    const intent = await classifyIntent({
      provider,
      prompt: "track my notes",
      activeCapabilityId: null,
      database: conns.readonly,
    });

    expect(intent).toEqual<IntentClassification>({
      type: "extend_capability",
      confidence: 0.94,
      target_capability: "notes",
      proposed_action: "Add another way to track notes inside the existing Notes capability.",
      user_facing_label: "I can add that to your notes.",
      requires_confirmation: false,
    });
    expect(provider.calls).toHaveLength(1);
  });

  test("rejects non-conforming provider output through Zod validation", async () => {
    const provider = makeRecordingProvider({
      type: "new_capability",
      confidence: 0.5,
      target_capability: null,
      proposed_action: "Create notes.",
      user_facing_label: "I'll make a place for that.",
      requires_confirmation: true,
    });

    await expect(
      classifyIntent({ provider, prompt: "track notes", database: conns.readonly }),
    ).rejects.toThrow();
  });
});
