// Candidate-spec generation. The context test pins decision 1's
// exact generation inputs: the committed spec including the capability's own
// inactive fields (present), the resolved intent, the field-lifecycle catalog,
// and the lease-frozen dependency-generation catalog whose entries carry active
// external fields only (inactive externals absent). The stage test proves the
// generate → total-validation gate with a fake provider — no network, no spend.

import { describe, expect, test } from "bun:test";

import type { SendBuildEvent } from "../../../pipeline/jobs/build-jobs.ts";
import { addedLines, linesNaming } from "../../../platform/provider/prompt-lines.test-support.ts";
import {
  BEHAVIORAL_ERROR_MARKERS,
  CHOICE_PRESENTATIONS,
  FORM_SHADOWING_FIELD_NAMES,
  FULL_CAPABILITY_TOOLS,
  fieldTypeSchema,
  LIST_INPUT_MODES,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  PLATFORM_COLUMNS,
  PLATFORM_OWNED_ERROR_CODES,
  promptCapabilitySpecSchema,
  uiCollectionLayoutSchema,
} from "../../../registry/index.ts";
import { structuredOutputKeys } from "../../spec/spec-gen.test-support.ts";
import { buildDependencyGenerationCatalog } from "../dependency-catalog.ts";
import {
  candidateFrom,
  evolutionDependencyCatalog,
  evolutionIntentFor,
  JOURNAL_INCARNATION_ID,
  journalCapabilityRow,
  makeCandidateProvider,
  SHELVES_INCARNATION_ID,
  shelvesCapabilityRow,
} from "./candidate.test-support.ts";
import {
  buildCandidateSpecPrompt,
  type GenerateCandidateSpecInput,
  generateCandidateSpec,
} from "./candidate-spec-gen.ts";
import { CandidateValidationError, committedSpecView } from "./candidate-validation.ts";

function collectingSend(): { send: SendBuildEvent; events: Array<[string, string]> } {
  const events: Array<[string, string]> = [];
  return {
    events,
    send: async (event, data) => {
      events.push([event, data]);
    },
  };
}

/** The prompt with its two JSON payloads taken out: only what the builder itself says. */
function instructionsOf(input: GenerateCandidateSpecInput): string {
  return buildCandidateSpecPrompt(input)
    .replace(JSON.stringify(committedSpecView(input.committed), null, 2), "")
    .replace(JSON.stringify(input.dependencyCatalog, null, 2), "");
}

function promptInput(
  overrides: Partial<GenerateCandidateSpecInput> = {},
): GenerateCandidateSpecInput {
  const committed = journalCapabilityRow();
  return {
    provider: makeCandidateProvider(candidateFrom(committed)).provider,
    committed,
    intent: evolutionIntentFor(committed, "Add a mood field to my journal"),
    dependencyCatalog: evolutionDependencyCatalog(),
    send: collectingSend().send,
    ...overrides,
  };
}

describe("the generation context (decision 1, pinned)", () => {
  test("the prompt carries the committed spec with its own inactive fields present", () => {
    const input = promptInput();
    const prompt = buildCandidateSpecPrompt(input);
    expect(prompt).toContain(JSON.stringify(committedSpecView(input.committed), null, 2));
    // The field-lifecycle catalog names every committed field with its state, one line each.
    for (const field of input.committed.schema.fields) {
      const facts = [field.name, field.type, field.lifecycle, field.label];
      expect(linesNaming(instructionsOf(input), facts), field.name).toHaveLength(1);
    }
    // Platform lifecycle values are never generation context: the committed spec JSON carries no
    // lifecycle-metadata key. (The bare words appear only in the "never return" instruction.)
    expect(prompt).not.toContain('"artifacts_path"');
    expect(prompt).not.toContain('"version"');
    expect(prompt).not.toContain(JOURNAL_INCARNATION_ID);
  });

  test("the dependency catalog rides along with active external fields only", () => {
    const input = promptInput();
    const prompt = buildCandidateSpecPrompt(input);
    expect(prompt).toContain(JSON.stringify(input.dependencyCatalog, null, 2));
    expect(prompt).toContain('"capability_id": "shelves"');
    expect(prompt).toContain(`"incarnation_id": "${SHELVES_INCARNATION_ID}"`);
    expect(prompt).toContain("shelf_name");
    // Inactive external fields are not generation context.
    expect(prompt).not.toContain("shelf_secret");
  });

  test("an empty catalog says so in one line of its own, and takes nothing else away", () => {
    const withCatalog = buildCandidateSpecPrompt(promptInput());
    const empty = buildCandidateSpecPrompt(promptInput({ dependencyCatalog: [] }));
    const [none, ...more] = addedLines(withCatalog, empty);
    expect(more).toEqual([]);
    expect(empty.replace(none ?? "", JSON.stringify(evolutionDependencyCatalog(), null, 2))).toBe(
      withCatalog,
    );
  });

  test("the resolved intent is in the prompt, and its target defaults to the committed id", () => {
    const input = promptInput();
    const instructions = instructionsOf(input);
    expect(instructions).toContain(input.intent.type);
    expect(instructions).toContain(input.intent.proposed_action);

    const untargeted = { ...input, intent: { ...input.intent, target_capability: null } };
    expect(buildCandidateSpecPrompt(untargeted)).toBe(buildCandidateSpecPrompt(input));
    const elsewhere = { ...input, intent: { ...input.intent, target_capability: "elsewhere" } };
    expect(
      linesNaming(
        addedLines(buildCandidateSpecPrompt(input), buildCandidateSpecPrompt(elsewhere)).join("\n"),
        ["elsewhere"],
      ),
    ).toHaveLength(1);
  });

  test("names every closed vocabulary off the registry, and every key the output asks for", async () => {
    const prompt = buildCandidateSpecPrompt(promptInput());
    for (const vocabulary of [
      FULL_CAPABILITY_TOOLS,
      fieldTypeSchema.options,
      uiCollectionLayoutSchema.options,
      CHOICE_PRESENTATIONS,
      LIST_INPUT_MODES,
      PLATFORM_COLUMNS,
      FORM_SHADOWING_FIELD_NAMES,
      PLATFORM_OWNED_ERROR_CODES,
    ]) {
      expect(linesNaming(prompt, vocabulary), vocabulary.join()).not.toEqual([]);
    }
    for (const key of await structuredOutputKeys()) expect(prompt, key).toContain(key);
    const markers = JSON.stringify(BEHAVIORAL_ERROR_MARKERS);
    expect(linesNaming(prompt, [MISSING_REQUIRED_FIELDS_ERROR_CODE, markers])).not.toEqual([]);
  });

  test("the immutable id and the logo's birth facts are quoted back as the values to return", () => {
    // The contract the platform then enforces: the model is told the three values and told they
    // cannot move, so a rejection is never a surprise about an unseen rule.
    const input = promptInput();
    const { id, subject, ground, companion } = input.committed;
    const instructions = instructionsOf(input);
    expect(instructions).toContain(`"${id}"`);
    expect(
      linesNaming(instructions, [`"${subject}"`, `"${ground}"`, `"${companion}"`]),
    ).toHaveLength(1);
    expect(instructions).not.toContain("regenerate the logo");
  });
});

describe("the dependency-generation catalog builder", () => {
  test("projects every other capability and excludes the evolving one", () => {
    const catalog = buildDependencyGenerationCatalog(
      [journalCapabilityRow(), shelvesCapabilityRow()],
      "journal",
    );
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toEqual({
      capability_id: "shelves",
      incarnation_id: SHELVES_INCARNATION_ID,
      label: "Shelves",
      prompt_context: "Stores the user's labelled shelves.",
      active_schema: {
        fields: [
          {
            name: "shelf_name",
            label: "Shelf name",
            type: "string",
            required: true,
            lifecycle: "active",
          },
        ],
      },
    });
  });
});

describe("the generation stage", () => {
  test("narrates, authors through the provider, and returns the validated candidate", async () => {
    const committed = journalCapabilityRow();
    const authored = candidateFrom(committed);
    authored.schema.fields.push({
      name: "mood",
      label: "Mood",
      type: "string",
      required: false,
      lifecycle: "active",
    });
    const { provider, prompts, schemas } = makeCandidateProvider(authored);
    const { send, events } = collectingSend();

    const result = await generateCandidateSpec({
      provider,
      committed,
      intent: evolutionIntentFor(committed, "Add a mood field"),
      dependencyCatalog: evolutionDependencyCatalog(),
      send,
    });

    expect(events[0]).toEqual(["narration", "Let me think through that change."]);
    expect(prompts).toHaveLength(1);
    // The provider is steered by the same schema that gates the output.
    expect(schemas[0]).toBe(promptCapabilitySpecSchema);
    expect(result.candidate.schema.fields.map((field) => field.name)).toContain("mood");
    expect(result.usage.totalTokens).toBe(96);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("a non-conforming authored candidate is this stage's own rejection", async () => {
    const committed = journalCapabilityRow();
    const authored = candidateFrom(committed);
    authored.schema.fields = authored.schema.fields.filter(
      (field) => field.name !== "archived_reason",
    );
    const { provider } = makeCandidateProvider(authored);

    expect(
      generateCandidateSpec({
        provider,
        committed,
        intent: evolutionIntentFor(committed, "Drop the archive note"),
        dependencyCatalog: evolutionDependencyCatalog(),
        send: collectingSend().send,
      }),
    ).rejects.toThrow(CandidateValidationError);
  });
});
