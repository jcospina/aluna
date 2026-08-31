import { describe, expect, test } from "bun:test";
import { journalCapabilityRow } from "../../builder/evolution/candidate.test-support.ts";
import {
  CandidateValidationError,
  committedSpecView,
  diffCapabilitySpec,
} from "../../builder/index.ts";
import type { IntentClassification } from "../../intent-resolver/index.ts";
import { classifyEvolutionFailure } from "./evolution-failure.ts";
import { validateEvolutionIntentScope } from "./evolution-intent.ts";

function intent(type: "extend_capability" | "ui_change"): IntentClassification {
  return {
    type,
    confidence: 0.98,
    target_capability: "journal",
    resolution: "extend",
    proposed_identity: null,
    proposed_action: "Apply the requested change to the journal.",
    user_facing_label: "I'll make that change to your journal.",
    requires_confirmation: false,
  };
}

describe("resolved evolution intent scope", () => {
  test("ui_change admits only the closed presentation fact vocabulary", () => {
    const committed = committedSpecView(journalCapabilityRow());
    const candidate = {
      ...committed,
      label: "Daily journal",
      schema: {
        fields: committed.schema.fields.map((field) =>
          field.name === "title" ? { ...field, label: "Entry title" } : field,
        ),
      },
      ui_intent: {
        ...committed.ui_intent,
        form: { list_inputs: [{ field: "tags", mode: "repeatable" as const }], choice_inputs: [] },
        item: {
          direction: "A calm entry card with title and tags in a compact hierarchy.",
          shows: ["title", "tags"],
        },
        collection: { layout: "grid" as const },
      },
    };
    const diff = diffCapabilitySpec(committed, candidate);

    expect(() => validateEvolutionIntentScope(intent("ui_change"), diff)).not.toThrow();
    expect(diff.facts.map((fact) => fact.kind)).toEqual([
      "capability_label",
      "field_label",
      "list_input_mode",
      "item_presentation",
      "collection_layout",
    ]);
  });

  test("ui_change admits a changed record noun — it is platform copy, like the name", () => {
    // A rename that changes what the thing *is* moves both together ("call these
    // Recipes" → label Recipes, noun recipe). Admitting the label but not the noun
    // would hard-fail the most ordinary rename there is.
    const committed = committedSpecView(journalCapabilityRow());
    const diff = diffCapabilitySpec(committed, {
      ...committed,
      label: "Diary",
      noun: "diary entry",
    });

    expect(diff.facts.map((fact) => fact.kind)).toEqual(["capability_label", "empty_state_noun"]);
    expect(() => validateEvolutionIntentScope(intent("ui_change"), diff)).not.toThrow();
  });

  test("ui_change rejects data and behavior facts before assembly or activation", () => {
    const committed = committedSpecView(journalCapabilityRow());
    const candidate = {
      ...committed,
      schema: {
        fields: [
          ...committed.schema.fields,
          {
            name: "due_date",
            label: "Due date",
            type: "date" as const,
            required: false,
            lifecycle: "active" as const,
          },
        ],
      },
      behavior: "A title is required. Due dates drive follow-up reminders.",
    };
    const diff = diffCapabilitySpec(committed, candidate);

    let rejection: unknown;
    try {
      validateEvolutionIntentScope(intent("ui_change"), diff);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(CandidateValidationError);
    expect(classifyEvolutionFailure(rejection, "diff")).toMatchObject({
      stage: "spec_gen",
    });
    expect(() => validateEvolutionIntentScope(intent("extend_capability"), diff)).not.toThrow();
  });
});
