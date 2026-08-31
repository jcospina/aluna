// Candidate-spec generation. The context test pins decision 1's
// exact generation inputs: the committed spec including the capability's own
// inactive fields (present), the resolved intent, the field-lifecycle catalog,
// and the lease-frozen dependency-generation catalog whose entries carry active
// external fields only (inactive externals absent). The stage test proves the
// generate → total-validation gate with a fake provider — no network, no spend.

import { describe, expect, test } from "bun:test";

import type { SendBuildEvent } from "../../pipeline/jobs/build-jobs.ts";
import { promptCapabilitySpecSchema } from "../../registry/index.ts";
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
import { CandidateValidationError } from "./candidate-validation.ts";
import { buildDependencyGenerationCatalog } from "./dependency-catalog.ts";

function collectingSend(): { send: SendBuildEvent; events: Array<[string, string]> } {
  const events: Array<[string, string]> = [];
  return {
    events,
    send: async (event, data) => {
      events.push([event, data]);
    },
  };
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
    const prompt = buildCandidateSpecPrompt(promptInput());
    // Own inactive fields are candidate-spec context.
    expect(prompt).toContain("archived_reason");
    expect(prompt).toContain("old_labels");
    expect(prompt).toContain("old_rating");
    // The field-lifecycle catalog names every committed field with its state.
    expect(prompt).toContain("- archived_reason (string) — lifecycle inactive");
    expect(prompt).toContain("- title (string) — lifecycle active");
    // Platform lifecycle values are never generation context: the committed
    // spec JSON carries no lifecycle-metadata keys and no own-incarnation value.
    // (The bare words appear only inside the "never return" instruction.)
    expect(prompt).not.toContain('"artifacts_path"');
    expect(prompt).not.toContain('"version"');
    expect(prompt).not.toContain(JOURNAL_INCARNATION_ID);
  });

  test("the dependency catalog rides along with active external fields only", () => {
    const prompt = buildCandidateSpecPrompt(promptInput());
    expect(prompt).toContain('"capability_id": "shelves"');
    expect(prompt).toContain(`"incarnation_id": "${SHELVES_INCARNATION_ID}"`);
    expect(prompt).toContain('"prompt_context": "Stores the user\'s labelled shelves."');
    expect(prompt).toContain("shelf_name");
    // Inactive external fields are not generation context.
    expect(prompt).not.toContain("shelf_secret");
  });

  test("the resolved intent and the evolution contract are in the prompt", () => {
    const prompt = buildCandidateSpecPrompt(promptInput());
    expect(prompt).toContain("proposed_action: Add a mood field to my journal");
    expect(prompt).toContain("type: extend_capability");
    expect(prompt).toContain('Return exactly "journal"');
    expect(prompt).toContain("Return every committed field exactly once");
    expect(prompt).toContain('A newly introduced field must start lifecycle "active"');
    // The append-only option contract, stated where the model authors the candidate.
    expect(prompt).toContain("option values are stored data and are immutable");
    expect(prompt).toContain("Never remove or rename a committed value");
    // Order, notes, groups and disabled are presentation and move freely; retiring an
    // option is how it is taken out of use, because removing it is refused.
    expect(prompt).toContain("Set an option's disabled to true to retire it");
    expect(prompt).toContain("A committed option group's id is fixed");
    expect(prompt).toContain(
      "keep its label, required and any declared values exactly as committed",
    );
    expect(prompt).toContain(
      "ui_intent.form.choice_inputs contains exactly one { field, presentation } entry",
    );
    expect(prompt).toContain("choice presentation is exactly picker");
    expect(prompt).toContain("tools: exactly [create, read, update, delete, search]");
    expect(prompt).toContain("Never return incarnation, version, build id, snapshot metadata");
    expect(prompt).toContain("comma_separated | repeatable");
    expect(prompt).toContain(
      "Preserve the committed behavior byte-for-byte unless the resolved intent explicitly changes",
    );
    expect(prompt).toContain('"make it stand out" in ui_intent');
    expect(prompt).toContain(
      "Preserve it byte-for-byte unless the resolved intent changes the capability's purpose",
    );
  });

  test("the logo's birth facts are quoted back as the exact values to return", () => {
    // The contract the platform then enforces: the model is told the three values and
    // told they cannot move, so a rejection is never a surprise about a rule it was
    // never given.
    const prompt = buildCandidateSpecPrompt(promptInput());
    expect(prompt).toContain(
      'subject, ground and companion are the logo\'s birth facts and are immutable. Return exactly "an open notebook", "grass_green" and "coral_orange".',
    );
    expect(prompt).toContain("The artwork was drawn once from them and is never redrawn");
    // The noun is the one logo-adjacent value that may move — as View copy, never as
    // a reason to draw anything.
    expect(prompt).toContain("noun is the singular common noun for one stored record");
    expect(prompt).not.toContain("regenerate the logo");
  });

  test("an empty catalog states there is nothing to depend on", () => {
    const prompt = buildCandidateSpecPrompt(promptInput({ dependencyCatalog: [] }));
    expect(prompt).toContain("- none: declare no external dependencies.");
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
