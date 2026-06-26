// Tests for the spec-generation stage (Epic 2.5, issue 02).
//
// No test calls a real provider. A fake records the prompt + schema and returns a
// chosen object and usage through the same provider contract the real spine
// exposes — so these cover the happy path and the non-conforming-output path
// without spending against a key. The fake resolves `.object` to the raw value
// *unparsed* on purpose: it makes the stage's own Zod gate the thing under test,
// proving a malformed spec is refused here regardless of how lax the provider is
// (the real spine additionally rejects `.object`, so the gate is belt-and-suspenders).

import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";

import type { SendBuildEvent } from "../build-jobs.ts";
import { type IntentClassification, intentClassificationSchema } from "../intent-resolver/index.ts";
import type { DeepPartial, GenerateResult, Provider, TokenUsage } from "../provider/index.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import { buildSpecPrompt, generateSpec, hardcodedNewCapabilityIntent } from "./index.ts";

const STUB_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

interface RecordedCall {
  readonly prompt: string;
  readonly schema: ZodType<unknown>;
}

interface RecordingProvider extends Provider {
  readonly calls: RecordedCall[];
}

// A fake provider: records the call, then resolves `.object` to `raw` exactly as
// given (no internal parse) so the stage's validation is what gates the output.
function makeSpecProvider(raw: unknown, usage: TokenUsage = STUB_USAGE): RecordingProvider {
  const calls: RecordedCall[] = [];

  return {
    calls,
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      calls.push({ prompt, schema: schema as ZodType<unknown> });

      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield raw as DeepPartial<T>;
      }

      return {
        partialStream: stream(),
        object: Promise.resolve(raw as T),
        usage: Promise.resolve(usage),
      };
    },
  };
}

// Captures everything narrated over the job's stream, so a test can assert the
// product voice and that no internals leak.
function recordingSend(): { events: Array<{ event: string; data: string }>; send: SendBuildEvent } {
  const events: Array<{ event: string; data: string }> = [];
  const send: SendBuildEvent = async (event, data) => {
    events.push({ event: String(event), data });
  };
  return { events, send };
}

function notesIntent(overrides: Partial<IntentClassification> = {}): IntentClassification {
  return {
    type: "new_capability",
    confidence: 0.92,
    target_capability: null,
    proposed_action: "Create a place to keep the user's notes.",
    user_facing_label: "I'll make a place for your notes.",
    requires_confirmation: false,
    ...overrides,
  };
}

function notesSpec(overrides: Partial<CapabilitySpec> = {}): CapabilitySpec {
  return {
    id: "notes",
    label: "Notes",
    schema: { fields: [{ name: "text", type: "string", required: true }] },
    ui_intent: { views: ["list", "create"] },
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

describe("spec generation stage", () => {
  test("yields a Zod-valid spec from prompt + intent and reports the measurements", async () => {
    const spec = notesSpec();
    const usage: TokenUsage = { inputTokens: 412, outputTokens: 96, totalTokens: 508 };
    const provider = makeSpecProvider(spec, usage);
    const { send } = recordingSend();

    const result = await generateSpec({
      provider,
      prompt: "I want to keep track of my notes",
      intent: notesIntent(),
      send,
    });

    expect(result.spec).toEqual(spec);
    // Measurement is captured for the build's metrics row (ARCH §6.2).
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.usage).toEqual(usage);
  });

  test("asks the model for the spec inside the Module 2 pantry, with identity and intent context", async () => {
    const provider = makeSpecProvider(notesSpec());
    const { send } = recordingSend();
    const intent = notesIntent();

    await generateSpec({
      provider,
      prompt: "track my notes",
      intent,
      send,
    });

    expect(provider.calls).toHaveLength(1);
    const prompt = provider.calls[0]?.prompt ?? "";
    // The stage builds its prompt with the exported builder — same input, same text.
    expect(prompt).toBe(buildSpecPrompt({ provider, prompt: "track my notes", intent, send }));
    // The pantry, stated to the model (the schema is the hard wall behind it).
    expect(prompt).toContain("tools: only create, read.");
    expect(prompt).toContain("ui_intent.views: only list, create.");
    expect(prompt).toContain("string | number | boolean | datetime");
    expect(prompt).toContain("id, created_at, extra are platform-owned");
    // Identity: engineering id vs user-facing label, kept distinct.
    expect(prompt).toContain("id is the engineering identity");
    expect(prompt).toContain("label is the short user-facing capability name");
    expect(prompt).toContain("not a sentence, narration, promise, or confirmation");
    expect(prompt).toContain("behavioral_errors: structured validation-error cases");
    expect(prompt).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
    expect(prompt).toContain('"data-error-fields"');
    // The resolved intent and the user's words both reach the model.
    expect(prompt).toContain(intent.proposed_action);
    expect(prompt).toContain(intent.user_facing_label);
    expect(prompt).toContain("track my notes");
  });

  test("narrates in product voice from the intent label and leaks no internals", async () => {
    const provider = makeSpecProvider(notesSpec());
    const { events, send } = recordingSend();
    const intent = notesIntent();

    await generateSpec({ provider, prompt: "track my notes", intent, send });

    const narration = events.filter((event) => event.event === "narration");
    expect(narration).toHaveLength(1);
    expect(narration[0]?.data).toBe(intent.user_facing_label);
    // The hard rule (ARCH §9.7): no engineering internals in anything user-visible.
    for (const event of narration) {
      expect(event.data).not.toMatch(/\bspec\b|\bschema\b|\bhandler\b|\bmigration\b/i);
    }
  });

  test("derives an engineering id distinct from the user-facing label", async () => {
    const provider = makeSpecProvider(notesSpec({ id: "reading_list", label: "Reading list" }));
    const { send } = recordingSend();

    const { spec } = await generateSpec({
      provider,
      prompt: "keep a reading list",
      intent: notesIntent(),
      send,
    });

    // The id is the SQL-safe engineering name; the label is the human one.
    expect(spec.id).toBe("reading_list");
    expect(spec.label).toBe("Reading list");
    expect(spec.id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  test("fails the build cleanly when the model's spec is non-conforming — nothing flows downstream", async () => {
    const outsideThePantry: Array<{ why: string; raw: unknown }> = [
      {
        why: "a tool outside create+read",
        raw: { ...notesSpec(), tools: ["create", "read", "update"] },
      },
      {
        why: "a view outside list+create",
        raw: { ...notesSpec(), ui_intent: { views: ["list", "detail"] } },
      },
      {
        why: "a field type outside the four",
        raw: {
          ...notesSpec(),
          schema: { fields: [{ name: "tags", type: "string[]", required: false }] },
        },
      },
      {
        why: "a platform-owned field name",
        raw: {
          ...notesSpec(),
          schema: { fields: [{ name: "id", type: "string", required: true }] },
        },
      },
      { why: "an extra top-level key", raw: { ...notesSpec(), version: 1 } },
    ];

    for (const { why, raw } of outsideThePantry) {
      const provider = makeSpecProvider(raw);
      const { send } = recordingSend();
      await expect(
        generateSpec({ provider, prompt: "track my notes", intent: notesIntent(), send }),
        why,
      ).rejects.toThrow();
    }
  });
});

describe("hardcodedNewCapabilityIntent (the pre-resolver stand-in)", () => {
  test("produces a valid new_capability intent with confirmations off", () => {
    const intent = hardcodedNewCapabilityIntent("I want to keep track of my notes");

    // Conforms to the real classification shape, so it flows through the stage
    // exactly as a resolved intent will once epic 2.4 is wired in front.
    expect(() => intentClassificationSchema.parse(intent)).not.toThrow();
    expect(intent.type).toBe("new_capability");
    expect(intent.requires_confirmation).toBe(false);
    expect(intent.user_facing_label.trim().length).toBeGreaterThan(0);
  });
});
