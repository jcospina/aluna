import { CandidateValidationError, type CapabilityDiff } from "../../../builder/index.ts";
import type { CapabilityRow } from "../../../registry/index.ts";
import type { IntentClassification } from "../../intent/index.ts";

/** The only two classifications an evolution can answer. */
export type EvolutionIntentClassification = IntentClassification & {
  readonly type: "extend_capability" | "ui_change";
};

const UI_CHANGE_FACTS = new Set([
  "capability_label",
  // The word a capability calls one of its records is platform copy, exactly like its
  // name — and a rename that changes what the thing *is* moves both together.
  "empty_state_noun",
  "field_label",
  "list_input_mode",
  // Which control a string field draws, and the line it says about itself: like `list_input_mode`,
  // nothing stored moves, nothing validates differently, and no generated unit is regenerated.
  "long_text_input",
  "field_guidance",
  "item_presentation",
  "collection_layout",
]);

/**
 * The resolver's classification, re-checked against the capability the run aims at, so one about
 * a capability never authors a candidate for another. `/prompt` cannot fire this; Module 7 can.
 */
export function resolveEvolutionIntent(
  active: CapabilityRow,
  intent: EvolutionIntentClassification,
): EvolutionIntentClassification {
  if (intent.target_capability !== active.id) {
    throw new CandidateValidationError([
      {
        path: "resolved_intent",
        message: `evolution must target "${active.id}", not "${intent.target_capability}"`,
      },
    ]);
  }
  return intent;
}

export function validateEvolutionIntentScope(
  intent: IntentClassification,
  diff: CapabilityDiff,
): void {
  if (intent.type !== "ui_change") return;
  const outOfScope = diff.facts.filter((fact) => !UI_CHANGE_FACTS.has(fact.kind));
  if (outOfScope.length === 0) return;
  throw new CandidateValidationError(
    outOfScope.map((fact) => ({
      path: `resolved_intent.ui_change.${fact.kind}`,
      message: `ui_change cannot produce the ${fact.kind} change fact`,
    })),
  );
}
