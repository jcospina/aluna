// The form's two subset collections as change facts: which string fields are drawn multi-line,
// and what each field says about itself underneath.
//
// They live apart from the rest of the matrix for the reason the choice facts do — per-field
// movements inside one `ui_intent` region. `diff-engine.ts` maps each fact to its column.
//
// Both are View facts and neither is stored, so neither changes validation shape and neither
// reaches a generated unit. Every comparison is over fields active in *both* specs: one that
// gained or lost that status is already a `new_active_field` or `field_lifecycle` fact.

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
