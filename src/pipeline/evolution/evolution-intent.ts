import {
  CandidateValidationError,
  type CapabilityDiff,
  handSuppliedEvolutionIntent,
} from "../../builder/index.ts";
import type { IntentClassification } from "../../intent-resolver/index.ts";
import type { CapabilityRow } from "../../registry/index.ts";

const UI_CHANGE_FACTS = new Set([
  "capability_label",
  "field_label",
  "list_input_mode",
  "detail_shows",
  "item_presentation",
  "collection_layout",
]);

export function resolveEvolutionIntent(
  active: CapabilityRow,
  intentText: string,
  resolvedIntent?: IntentClassification,
): IntentClassification {
  const intent = resolvedIntent ?? handSuppliedEvolutionIntent(active, intentText);
  if (
    (intent.type !== "extend_capability" && intent.type !== "ui_change") ||
    intent.target_capability !== active.id
  ) {
    throw new CandidateValidationError([
      {
        path: "resolved_intent",
        message: `evolution must target "${active.id}" as extend_capability or ui_change`,
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
