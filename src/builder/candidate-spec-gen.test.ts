// Candidate-spec generation — Module 4.6/01. The context test pins decision 1's
// exact generation inputs: the committed spec including the capability's own
// inactive fields (present), the resolved intent, the field-lifecycle catalog,
// and the lease-frozen dependency-generation catalog whose entries carry active
// external fields only (inactive externals absent). The stage test proves the
// generate → total-validation gate with a fake provider — no network, no spend.

import { describe, expect, test } from "bun:test";

import type { SendBuildEvent } from "../build-jobs.ts";
import { promptCapabilitySpecSchema } from "../registry/index.ts";
import {
  candidateFrom,
  evolutionDependencyCatalog,
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
  handSuppliedEvolutionIntent,
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
    intent: handSuppliedEvolutionIntent(committed, "Add a mood field to my journal"),
    dependencyCatalog: evolutionDependencyCatalog(),
    send: collectingSend().send,
    ...overrides,
  };
}

describe("the generation context (decision 1, pinned)", () => {
  test("the prompt carries the committed spec with its own inactive fields present", () => {
    const prompt = buildCandidateSpecPrompt(promptInput());
    // Own inactive fields are candidate-spec context (decision 2).
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
    // Inactive external fields are not generation context (decision 2).
    expect(prompt).not.toContain("shelf_secret");
  });

  test("the resolved intent and the evolution contract are in the prompt", () => {
    const prompt = buildCandidateSpecPrompt(promptInput());
    expect(prompt).toContain("proposed_action: Add a mood field to my journal");
    expect(prompt).toContain("type: extend_capability");
    expect(prompt).toContain('Return exactly "journal"');
    expect(prompt).toContain("Return every committed field exactly once");
    expect(prompt).toContain('A newly introduced field must start lifecycle "active"');
    expect(prompt).toContain("tools: exactly [create, read, update, delete, search]");
    expect(prompt).toContain("Never return incarnation, version, build id, snapshot metadata");
    expect(prompt).toContain("comma_separated | repeatable");
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
      intent: handSuppliedEvolutionIntent(committed, "Add a mood field"),
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
        intent: handSuppliedEvolutionIntent(committed, "Drop the archive note"),
        dependencyCatalog: evolutionDependencyCatalog(),
        send: collectingSend().send,
      }),
    ).rejects.toThrow(CandidateValidationError);
  });
});

describe("the hand-supplied intent seam (until 4.8)", () => {
  test("wraps the typed text as an extend_capability classification", () => {
    const intent = handSuppliedEvolutionIntent(journalCapabilityRow(), "Track a mood too");
    expect(intent).toEqual({
      type: "extend_capability",
      confidence: 1,
      target_capability: "journal",
      proposed_action: "Track a mood too",
      user_facing_label: "Let me think through that change.",
      requires_confirmation: false,
    });
  });
});
