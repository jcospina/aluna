import { CandidateValidationError, type CapabilityDiff } from "../../builder/index.ts";
import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { CapabilityRow } from "../../registry/index.ts";

/** The only two classifications an evolution can answer. */
export type EvolutionIntentClassification = IntentClassification & {
  readonly type: "extend_capability" | "ui_change";
};

const UI_CHANGE_FACTS = new Set([
  "capability_label",
  "field_label",
  "list_input_mode",
  "item_presentation",
  "collection_layout",
]);

/**
 * The resolver's classification, re-checked against the capability the run is actually
 * aimed at. The intent *type* is already narrowed at the type level, so all that
 * is left is the pairing: a classification about one capability may never author a
 * candidate for another. `/prompt` resolves `active` **by** `target_capability` and
 * revalidates it at the lease head, so this cannot fire from there — it is the guard for
 * the next caller of the engine, which Module 7's implicit loop will be.
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
