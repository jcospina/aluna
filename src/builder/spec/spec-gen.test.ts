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
import type { TokenUsage } from "../../provider/index.ts";
import {
  FULL_CAPABILITY_TOOLS,
  LOGO_HUE_FAMILIES,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  promptCapabilitySpecSchema,
} from "../../registry/index.ts";
import { buildSpecPrompt, generateSpec } from "../index.ts";
import {
  makeSpecProvider,
  notesIntent,
  notesSpec,
  recordingSend,
} from "./spec-gen.test-support.ts";

describe("spec generation stage — schema contract, generation, and prompt", () => {
  test("emits OpenAI-compatible JSON Schema for the fixed five-Action list", async () => {
    const jsonSchema = await zodSchema(promptCapabilitySpecSchema).jsonSchema;
    const tools = jsonSchema.properties?.tools as
      | { items?: unknown; minItems?: number; maxItems?: number }
      | undefined;

    // OpenAI rejects tuple-style positional `items: [...]`. The provider-facing
    // schema must be a homogeneous fixed-length array; the Zod refinement remains
    // the hard gate for the exact ordered five-Action value.
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
      }),
    ).rejects.toThrow("exact missing_required_fields cases");
  });
});

describe("spec generation stage — authored prompt", () => {
  test("asks the model for the spec inside the field/action pantry, with reshaped ui_intent", async () => {
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
    expect(prompt).toContain(
      "tools: exactly [create, read, update, delete, search] in that canonical order",
    );
    expect(prompt).toContain('"update": [], "delete": [], "search": []');
    expect(prompt).toContain("ui_intent.item");
    expect(prompt).toContain("ui_intent.form.list_inputs contains exactly one");
    expect(prompt).toContain("comma_separated only for short atomic values");
    expect(prompt).toContain("tags, genres, categories, skills");
    expect(prompt).toContain("quotes, addresses, citations, or names as entered");
    expect(prompt).toContain("never choose it for comma-bearing element semantics");
    expect(prompt).toContain("ui_intent.collection.layout is one of: feed | grid");
    expect(prompt).not.toContain("ui_intent.detail");
    expect(prompt).toContain("Do not include ui_intent.views");
    expect(prompt).toContain("Do not author how a record opens");
    expect(prompt).toContain("string | number | boolean | datetime | date | choice | string[]");
    expect(prompt).toContain("string[] is the only list type");
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

  test("asks for the logo's subject and one of the eight hue families, and for the record noun", () => {
    const provider = makeSpecProvider(notesSpec());
    const { send } = recordingSend();
    const prompt = buildSpecPrompt({
      provider,
      prompt: "track my notes",
      intent: notesIntent(),
      send,
    });

    // Both colours are word lists read off the registry's own enum, so the prompt
    // cannot drift from the schema that gates the answer.
    expect(prompt).toContain(`ground is exactly one of: ${LOGO_HUE_FAMILIES.join(" | ")}`);
    expect(prompt).toContain(
      "companion is exactly one of the same list and must never be the same value as ground",
    );
    expect(prompt).not.toContain("signal");
    // Subject: one concrete object, no art direction, no lettering.
    expect(prompt).toContain("subject is a short noun phrase naming one concrete object");
    expect(prompt).toContain(
      "Never letters, words, initials, logos, or a described scene; never a style, medium, palette, layout, or composition instruction.",
    );
    // The user does not steer it — the subject comes from what the capability is for.
    expect(prompt).toContain(
      "Derive the subject from what the capability is for, never from art direction in the user's words.",
    );
    // One rule, not two: the builder is told where the subject comes from, and the
    // refusing is left to the intent classifier (ADR-0007).
    expect(prompt).toContain("not a second refusal");
    expect(prompt).toContain("chosen once, at birth, and can never be changed afterwards");
    // Each colour is asked for by what it does, so the model has something to choose
    // against: the ground is the field, the companion is the object. This is the whole
    // of the presentation the model touches — no size, no style, no composition.
    expect(prompt).toContain("It is the hue of the flat colour the whole square is filled with");
    expect(prompt).toContain("It is the hue the object itself is drawn in");
    // The model names a hue, not a colour: it is told so, because a model asked for a
    // colour and handed a hue would reasonably think its choice was the final word.
    expect(prompt).toContain("Aluna resolves which of that hue's four shades");
    for (const forbidden of ["substyle", "vector_illustration", "1024x1024", "no_text", "seed"]) {
      expect(prompt, `the prompt must not leak "${forbidden}"`).not.toContain(forbidden);
    }
    expect(prompt).toContain("noun is the singular common noun for one stored record");
  });

  // A worked example is the most concrete thing in an instruction, so an anchor named in
  // one is a thumb on the scale — the first pass at this balanced the mentions so that no
  // colour was named more often than another. That was not enough. Five probe builds
  // against the balanced prompt came back with the same companion three times, on a
  // vocabulary where every value was named exactly once: the model collapses to a mode
  // whatever the examples say, and an even scale only moves which value it collapses on.
  //
  // So the colour instructions carry no worked examples at all. The scale cannot lean if
  // there is nothing on it, and variety is bought where it can actually be bought — the
  // seed, in `resolveLogoShades`. This is the stronger invariant and it cannot rot: a
  // future example naming one hue fails here whatever the counts are.
  test("the colour instructions name no hue at all outside the vocabulary list", () => {
    const provider = makeSpecProvider(notesSpec());
    const { send } = recordingSend();
    const prompt = buildSpecPrompt({
      provider,
      prompt: "track my notes",
      intent: notesIntent(),
      send,
    });

    const instructions = prompt
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("- ground is exactly one of") ||
          line.startsWith("- companion is exactly one of") ||
          line.startsWith("- There is no default hue"),
      )
      .join(" ")
      .replace(LOGO_HUE_FAMILIES.join(" | "), "");

    expect(instructions).not.toBe("");
    for (const family of LOGO_HUE_FAMILIES) {
      expect(
        instructions.match(new RegExp(`\\b${family}\\b`, "g")),
        `"${family}" is named in the colour instructions`,
      ).toBeNull();
    }
  });

  // The failure mode the four live capabilities showed, named out loud. A subject with no
  // colour of its own is where the mode bites, and "what a background usually looks like"
  // is the answer it kept reaching for.
  test("tells the model there is no default hue", () => {
    const provider = makeSpecProvider(notesSpec());
    const { send } = recordingSend();
    const prompt = buildSpecPrompt({
      provider,
      prompt: "track my notes",
      intent: notesIntent(),
      send,
    });

    expect(prompt).toContain("There is no default hue and no safe choice");
    expect(prompt).toContain("never from what a backdrop usually looks like");
  });
});

describe("spec generation stage — authored modes, narration, and identity", () => {
  test("admits semantically appropriate authored modes from prompt-built list capabilities", async () => {
    for (const [field, mode, prompt] of [
      ["tags", "comma_separated", "keep a list of books with genres and tags"],
      ["quotes", "repeatable", "keep quotations exactly as entered"],
    ] as const) {
      const spec = notesSpec({
        id: field,
        label: field === "tags" ? "Tagged books" : "Quotes",
        schema: {
          fields: [
            {
              name: field,
              label: field === "tags" ? "Tags" : "Quotes",
              type: "string[]",
              required: false,
              lifecycle: "active",
            },
          ],
        },
        ui_intent: {
          form: { list_inputs: [{ field, mode }], choice_inputs: [], long_text: [], guidance: [] },
          item: { direction: `Show ${field} in their authored order.`, shows: [field] },
          collection: { layout: "feed" },
        },
        behavioral_errors: [],
      });
      const provider = makeSpecProvider(spec);
      const { send } = recordingSend();
      const result = await generateSpec({ provider, prompt, intent: notesIntent(), send });
      expect(result.spec.ui_intent.form.list_inputs).toEqual([{ field, mode }]);
    }
  });

  test("narrates in product voice from the intent label and leaks no internals", async () => {
    const provider = makeSpecProvider(notesSpec());
    const { events, send } = recordingSend();
    const intent = notesIntent();

    await generateSpec({ provider, prompt: "track my notes", intent, send });

    const narration = events.filter((event) => event.event === "narration");
    expect(narration).toHaveLength(1);
    expect(narration[0]?.data).toBe(intent.user_facing_label);
    // The hard rule: no engineering internals in anything user-visible.
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

  test("keeps the namespace mechanism out of the Builder prompt", async () => {
    const provider = makeSpecProvider(notesSpec({ id: "work_contacts", label: "Work contacts" }));
    const { send } = recordingSend();
    const intent = notesIntent({
      target_capability: "contacts",
      resolution: "namespace",
      proposed_identity: { id: "work_contacts", label: "Work contacts" },
      proposed_action: "Create a separate capability for work contacts.",
    });
    const prompt = buildSpecPrompt({
      provider,
      prompt: "track my work contacts separately",
      intent,
      send,
    });

    expect(prompt).not.toContain("namespace");
    expect(prompt).not.toContain("overlap_resolution");
    expect(prompt).toContain("meaningful semantic label and id");
    expect(prompt).toContain("Resolver-owned distinct identity — return these values exactly");
    expect(prompt).toContain("- id: work_contacts");
    expect(prompt).toContain("- label: Work contacts");
  });
});

describe("spec generation stage — rejects non-conforming specs", () => {
  test("fails the build cleanly when the model's spec is non-conforming — nothing flows downstream", async () => {
    const outsideThePantry: Array<{ why: string; raw: unknown }> = [
      {
        why: "a partial Action inventory",
        raw: { ...notesSpec(), tools: ["create", "read", "update"] },
      },
      {
        why: "the retired views shape",
        raw: { ...notesSpec(), ui_intent: { views: ["list", "create"] } },
      },
      {
        why: "a collection layout outside feed+grid",
        raw: {
          ...notesSpec(),
          ui_intent: {
            form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
            item: { direction: "A visual tile.", shows: ["text"] },
            collection: { layout: "masonry" },
          },
        },
      },
      {
        why: "a stored modal flag",
        raw: {
          ...notesSpec(),
          ui_intent: {
            form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
            item: { direction: "A visual tile.", shows: ["text"] },
            collection: { layout: "grid" },
            modal: true,
          },
        },
      },
      {
        why: "a detail field not present in schema",
        raw: {
          ...notesSpec(),
          ui_intent: {
            form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
            item: { direction: "A text-forward card.", shows: ["missing"] },
            collection: { layout: "feed" },
          },
        },
      },
      {
        why: "a field type outside the pantry",
        raw: {
          ...notesSpec(),
          schema: {
            fields: [
              {
                name: "tags",
                label: "Tags",
                type: "string[]",
                required: false,
                lifecycle: "active",
              },
            ],
          },
        },
      },
      {
        why: "a platform-owned field name",
        raw: {
          ...notesSpec(),
          schema: {
            fields: [
              { name: "id", label: "Id", type: "string", required: true, lifecycle: "active" },
            ],
          },
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
