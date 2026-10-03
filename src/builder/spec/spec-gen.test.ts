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
import { zodSchema } from "ai";
import fc from "fast-check";
import { ZodError } from "zod";
import { INTENT_TYPES, type IntentClassification } from "../../pipeline/intent/index.ts";
import type { TokenUsage } from "../../platform/provider/index.ts";
import {
  addedLines,
  linesNaming,
  occurrences,
} from "../../platform/provider/prompt-lines.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  CHOICE_PRESENTATIONS,
  FORM_SHADOWING_FIELD_NAMES,
  FULL_CAPABILITY_TOOLS,
  fieldTypeSchema,
  LIST_INPUT_MODES,
  type ListInputMode,
  LOGO_HUE_FAMILIES,
  MAX_CAPABILITY_NOUN_LENGTH,
  MAX_CHOICE_GROUP_HEADING_LENGTH,
  MAX_CHOICE_GROUPS,
  MAX_CHOICE_OPTION_LABEL_LENGTH,
  MAX_CHOICE_OPTION_NOTE_LENGTH,
  MAX_CHOICE_OPTION_VALUE_LENGTH,
  MAX_CHOICE_OPTIONS,
  MAX_DECLARED_MAX_LENGTH,
  MAX_FIELD_GUIDANCE_LENGTH,
  MAX_LOGO_SUBJECT_LENGTH,
  MIN_DECLARED_MAX_LENGTH,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  PLATFORM_OWNED_ERROR_CODES,
  promptCapabilitySpecSchema,
  uiCollectionLayoutSchema,
} from "../../registry/index.ts";
import { buildSpecPrompt, generateSpec } from "../index.ts";

import {
  makeSpecProvider,
  notesIntent,
  notesSpec,
  recordingSend,
  structuredOutputKeys,
} from "./spec-gen.test-support.ts";

function specPrompt(request = "track my notes", intent: IntentClassification = notesIntent()) {
  return buildSpecPrompt({
    provider: makeSpecProvider(notesSpec()),
    prompt: request,
    intent,
    send: recordingSend().send,
    incarnationId: "inc_spec_test",
  });
}

/** The issue paths the stage's gate raises for a model's `raw` spec; empty when it passes. */
async function issuePathsOf(raw: unknown): Promise<string[]> {
  try {
    await generateSpec({
      provider: makeSpecProvider(raw),
      prompt: "track my notes",
      intent: notesIntent(),
      send: recordingSend().send,
      incarnationId: "inc_spec_test",
    });
    return [];
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    return error.issues.map((issue) => issue.path.join("."));
  }
}

describe("spec generation stage — schema contract, generation, and prompt", () => {
  test("emits OpenAI-compatible JSON Schema for the fixed five-Action list", async () => {
    const jsonSchema = await zodSchema(promptCapabilitySpecSchema).jsonSchema;
    const tools = jsonSchema.properties?.tools as
      | { items?: unknown; minItems?: number; maxItems?: number }
      | undefined;

    // OpenAI rejects tuple-style positional `items: [...]`, so the provider-facing schema is a
    // homogeneous fixed-length array; the Zod refinement stays the gate on the ordered value.
    expect(Array.isArray(tools?.items)).toBe(false);
    expect(tools?.minItems).toBe(FULL_CAPABILITY_TOOLS.length);
    expect(tools?.maxItems).toBe(FULL_CAPABILITY_TOOLS.length);

    const behavioralErrors = jsonSchema.properties?.behavioral_errors as
      | { items?: { properties?: { action?: { enum?: string[] } } } }
      | undefined;
    expect(behavioralErrors?.items?.properties?.action?.enum).toEqual([...FULL_CAPABILITY_TOOLS]);
  });

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
      incarnationId: "inc_spec_test",
    });

    expect(result.spec).toEqual(spec);
    expect(result.spec.ui_intent).toEqual({
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A text-forward card that emphasizes the note text.", shows: ["text"] },
      collection: { layout: "feed" },
    });
    expect(result.spec.ui_intent).not.toHaveProperty("views");
    expect(result.spec.ui_intent).not.toHaveProperty("modal");
    // Measurement is captured for the build's metrics row.
    expect(Number.isFinite(result.durationMs)).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.usage).toEqual(usage);
  });
});

describe("spec generation stage — required-field errors", () => {
  test("requires paired create/update missing-field cases exactly when fields are required", async () => {
    const required = notesSpec();
    const { send } = recordingSend();
    const generated = await generateSpec({
      provider: makeSpecProvider(required),
      prompt: "track notes",
      intent: notesIntent(),
      send,
      incarnationId: "inc_spec_test",
    });
    expect(generated.spec.behavioral_errors.map((errorCase) => errorCase.action)).toEqual([
      "create",
      "update",
    ]);
    expect(generated.spec.behavioral_errors.map((errorCase) => errorCase.fields)).toEqual([
      ["text"],
      ["text"],
    ]);

    const optional = notesSpec({
      schema: {
        fields: [
          { name: "text", label: "Text", type: "string", required: false, lifecycle: "active" },
        ],
      },
      behavioral_errors: [],
    });
    await expect(
      generateSpec({
        provider: makeSpecProvider(optional),
        prompt: "track optional notes",
        intent: notesIntent(),
        send,
        incarnationId: "inc_spec_test",
      }),
    ).resolves.toMatchObject({ spec: { behavioral_errors: [] } });

    await expect(
      generateSpec({
        provider: makeSpecProvider({
          ...required,
          behavioral_errors: [required.behavioral_errors[0]],
        }),
        prompt: "track notes",
        intent: notesIntent(),
        send,
        incarnationId: "inc_spec_test",
      }),
    ).rejects.toThrow("exact missing_required_fields cases");
  });
});

describe("spec generation stage — authored prompt", () => {
  test("the stage sends the prompt its exported builder makes from the same input", async () => {
    const provider = makeSpecProvider(notesSpec());
    const { send } = recordingSend();
    const intent = notesIntent();

    await generateSpec({
      provider,
      prompt: "track my notes",
      intent,
      send,
      incarnationId: "inc_spec_test",
    });

    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.prompt).toBe(
      buildSpecPrompt({
        provider,
        prompt: "track my notes",
        intent,
        send,
        incarnationId: "inc_spec_test",
      }),
    );
  });

  test("carries the resolved intent, and ends on the user's own words", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 8 }),
        fc.string({ minLength: 8 }),
        fc.string({ minLength: 8 }),
        fc.constantFrom(...INTENT_TYPES),
        (request, action, label, type) => {
          const intent = notesIntent({ type, proposed_action: action, user_facing_label: label });
          const prompt = specPrompt(request, intent);
          expect(prompt.endsWith(`\n${request}`)).toBe(true);
          const instructions = prompt.slice(0, -request.length);
          for (const value of [type, action, label]) expect(instructions).toContain(value);
        },
      ),
      { seed: 20260926, numRuns: 200 },
    );
  });

  test("names every closed vocabulary off the registry, each on one line", () => {
    const prompt = specPrompt();
    for (const vocabulary of [
      FULL_CAPABILITY_TOOLS,
      fieldTypeSchema.options,
      uiCollectionLayoutSchema.options,
      CHOICE_PRESENTATIONS,
      LIST_INPUT_MODES,
      LOGO_HUE_FAMILIES,
      PLATFORM_COLUMNS,
      FORM_SHADOWING_FIELD_NAMES,
      PLATFORM_OWNED_ERROR_CODES,
    ]) {
      expect(linesNaming(prompt, vocabulary), vocabulary.join()).not.toEqual([]);
    }
    const [toolLine] = linesNaming(prompt, FULL_CAPABILITY_TOOLS);
    const positions = FULL_CAPABILITY_TOOLS.map((tool) => toolLine?.indexOf(tool) ?? -1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("states every registry bound beside the one it pairs with", () => {
    const prompt = specPrompt();
    for (const bounds of [
      [MAX_CHOICE_OPTION_VALUE_LENGTH, MAX_CHOICE_OPTION_LABEL_LENGTH],
      [MAX_CHOICE_OPTIONS, MAX_CHOICE_GROUPS],
      [MIN_DECLARED_MAX_LENGTH, MAX_DECLARED_MAX_LENGTH],
      [MAX_CHOICE_OPTION_NOTE_LENGTH],
      [MAX_CHOICE_GROUP_HEADING_LENGTH],
      [MAX_FIELD_GUIDANCE_LENGTH],
      [MAX_LOGO_SUBJECT_LENGTH],
      [MAX_CAPABILITY_NOUN_LENGTH],
    ]) {
      expect(linesNaming(prompt, bounds), bounds.join()).not.toEqual([]);
    }
  });

  test("hands over the required-field case exactly as the Gate will compare it", () => {
    const markers = JSON.stringify(BEHAVIORAL_ERROR_MARKERS);
    expect(
      linesNaming(specPrompt(), [MISSING_REQUIRED_FIELDS_ERROR_CODE, markers, "create", "update"]),
    ).not.toEqual([]);
  });

  test("names every key the structured output asks for", async () => {
    const prompt = specPrompt();
    // A birth declares no dependency, so the two keys a dependency entry carries are never filled.
    const unfilled = new Set(["capability_id", "incarnation_id"]);
    const keys = await structuredOutputKeys();
    expect(keys.length).toBeGreaterThan(unfilled.size);
    for (const key of keys) if (!unfilled.has(key)) expect(prompt, key).toContain(key);
  });

  // Balancing the mentions was not enough: five probe builds against the balanced prompt came
  // back with the same companion three times, so variety is bought by seed in `resolveLogoShades`.
  test("offers every hue once, in the vocabulary, and singles none out anywhere else", () => {
    const prompt = specPrompt();
    for (const family of LOGO_HUE_FAMILIES) expect(occurrences(prompt, family), family).toBe(1);
  });

  test("leaks none of the logo request's own settings", () => {
    const prompt = specPrompt();
    for (const forbidden of ["substyle", "vector_illustration", "1024x1024", "no_text", "seed"]) {
      expect(prompt, `the prompt must not leak "${forbidden}"`).not.toContain(forbidden);
    }
    expect(prompt).not.toContain("signal");
    expect(prompt).not.toContain("ui_intent.detail");
  });
});

describe("spec generation stage — authored modes, narration, and identity", () => {
  test("admits every authored list-input mode and refuses one outside the closed set", async () => {
    const listSpec = (mode: string) =>
      notesSpec({
        schema: {
          fields: [
            { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
          ],
        },
        ui_intent: {
          form: {
            list_inputs: [{ field: "tags", mode: mode as ListInputMode }],
            choice_inputs: [],
            long_text: [],
            guidance: [],
          },
          item: { direction: "Show tags in their authored order.", shows: ["tags"] },
          collection: { layout: "feed" },
        },
        behavioral_errors: [],
      });

    for (const mode of LIST_INPUT_MODES) {
      expect(await issuePathsOf(listSpec(mode))).toEqual([]);
    }
    const unlisted = `${LIST_INPUT_MODES.join("_")}_unlisted`;
    expect(await issuePathsOf(listSpec(unlisted))).toEqual(["ui_intent.form.list_inputs.0.mode"]);
  });

  test("narrates in product voice from the intent label and leaks no internals", async () => {
    const provider = makeSpecProvider(notesSpec());
    const { events, send } = recordingSend();
    const intent = notesIntent();

    await generateSpec({
      provider,
      prompt: "track my notes",
      intent,
      send,
      incarnationId: "inc_spec_test",
    });

    const narration = events.filter((event) => event.event === "narration");
    expect(narration).toHaveLength(1);
    expect(narration[0]?.data).toBe(intent.user_facing_label);
    // The hard rule: no engineering internals in anything user-visible.
    for (const event of narration) {
      expect(event.data).not.toMatch(/\bspec\b|\bschema\b|\bhandler\b|\bmigration\b/i);
    }
  });

  test("refuses a spec whose id is the human label rather than an engineering name", async () => {
    expect(await issuePathsOf(notesSpec({ id: "reading_list", label: "Reading list" }))).toEqual(
      [],
    );
    expect(await issuePathsOf(notesSpec({ id: "Reading list", label: "Reading list" }))).toEqual([
      "id",
    ]);
  });

  test("keeps the namespace mechanism out of the Builder prompt", () => {
    const identity = { id: "work_contacts", label: "Work contacts" };
    const plain = specPrompt("track my work contacts separately", notesIntent());
    const bound = specPrompt(
      "track my work contacts separately",
      notesIntent({ target_capability: "contacts", proposed_identity: identity }),
    );

    expect(bound).not.toContain("namespace");
    expect(bound).not.toContain("overlap_resolution");
    // The resolver's identity is the only thing a bound identity adds, and nothing is taken away.
    const added = addedLines(plain, bound);
    expect(addedLines(bound, plain)).toEqual([]);
    expect(linesNaming(added.join("\n"), [identity.id])).toHaveLength(1);
    expect(linesNaming(added.join("\n"), [identity.label])).toHaveLength(1);
    expect(plain).not.toContain(identity.id);
  });
});

describe("spec generation stage — rejects non-conforming specs", () => {
  test("fails the build cleanly when the model's spec is non-conforming — nothing flows downstream", async () => {
    const spec = notesSpec();
    const [text] = spec.schema.fields;
    const outsideThePantry: Array<{ where: string; raw: unknown }> = [
      { where: "tools", raw: { ...spec, tools: FULL_CAPABILITY_TOOLS.slice(0, -1) } },
      { where: "ui_intent", raw: { ...spec, ui_intent: { ...spec.ui_intent, views: ["list"] } } },
      {
        where: "ui_intent.collection.layout",
        raw: { ...spec, ui_intent: { ...spec.ui_intent, collection: { layout: "masonry" } } },
      },
      { where: "ui_intent", raw: { ...spec, ui_intent: { ...spec.ui_intent, modal: true } } },
      {
        where: "ui_intent.item.shows",
        raw: {
          ...spec,
          ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["missing"] } },
        },
      },
      {
        where: "schema.fields.0.type",
        raw: { ...spec, schema: { fields: [{ ...text, type: "relation" }] } },
      },
      {
        where: "schema.fields.0.name",
        raw: { ...spec, schema: { fields: [{ ...text, name: PLATFORM_COLUMNS[0] }] } },
      },
      { where: "", raw: { ...spec, version: 1 } },
    ];

    expect(await issuePathsOf(spec)).toEqual([]);
    for (const { where, raw } of outsideThePantry) {
      const paths = await issuePathsOf(raw);
      expect(
        paths.some((path) => path === where || path.startsWith(`${where}.`)),
        where,
      ).toBe(true);
    }
  });
});
