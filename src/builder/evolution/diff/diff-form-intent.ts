// The form's two subset collections as change facts: which string fields are drawn
// multi-line, and what each field says about itself underneath.
//
// They live apart from the rest of the matrix for the same reason the choice facts do —
// they are per-field movements inside one `ui_intent` region, and reading them beside the
// whole-spec comparisons would bury both. `diff-engine.ts` calls this and maps each fact to
// its column, exactly as it does for `diff-choice.ts`.
//
// Both are View facts and neither is stored, so neither changes validation shape and
// neither reaches a generated unit: a Handler is never told which control drew a value,
// and the item renderer never draws a form. Every comparison is over fields active in
// *both* specs, because a field that gained or lost that status is already a
// `new_active_field` or a `field_lifecycle` fact and its entry follows the lifecycle.

import type { CapabilitySpec } from "../../../registry/index.ts";
import type { ChangeFact } from "./diff-engine.ts";

export function detectFormIntentFacts(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
  facts: ChangeFact[],
): void {
  const shared = sharedActiveFields(committed, candidate);

  const before = new Set(committed.ui_intent.form.long_text);
  const after = new Set(candidate.ui_intent.form.long_text);
  for (const field of shared) {
    if (before.has(field) !== after.has(field)) {
      facts.push({ kind: "long_text_input", field });
    }
  }

  const committedText = guidanceByField(committed);
  const candidateText = guidanceByField(candidate);
  for (const field of shared) {
    // Absent and present compare here as well as changed: gaining a hint, losing one and
    // rewording one are all the same platform work, and one fact is what says so.
    if (committedText.get(field) !== candidateText.get(field)) {
      facts.push({ kind: "field_guidance", field });
    }
  }
}

/** Field names active in both specs, in the candidate's order, so the facts sort stably. */
function sharedActiveFields(
  committed: CapabilitySpec,
  candidate: CapabilitySpec,
): readonly string[] {
  const before = new Set(
    committed.schema.fields.filter((f) => f.lifecycle === "active").map((f) => f.name),
  );
  return candidate.schema.fields
    .filter((field) => field.lifecycle === "active" && before.has(field.name))
    .map((field) => field.name);
}

function guidanceByField(spec: CapabilitySpec): ReadonlyMap<string, string> {
  return new Map(spec.ui_intent.form.guidance.map((entry) => [entry.field, entry.text]));
}
