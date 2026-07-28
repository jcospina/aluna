// Per-Action behavioral test generation prompt — Module 4.7/01 (PLAN decision 23).
//
// The prompt takes `ActionTestInputs` and never a `CapabilitySpec`, so the closed input
// set is enforced by the type system rather than by prompt discipline: there is no
// Handler source, no field label, no field order, no inactive field, no `ui_intent`, and
// no dependency schema anywhere in scope to leak.

import { MISSING_REQUIRED_FIELDS_ERROR_CODE } from "../../../registry/index.ts";
import type { HandlerUnitName } from "../../units/units.ts";
import {
  type ActionFixtureVocabulary,
  type ActionTestInputs,
  canonicalTestInputJson,
  isSearchSchemaInput,
} from "./behavioral-test-inputs.ts";

/** The literal line a reader (and the test fake) uses to identify the Action under test. */
export const ACTION_UNDER_TEST_PREFIX = "Action under test:";

export function buildActionBehavioralTestPrompt(
  inputs: ActionTestInputs,
  fixture: ActionFixtureVocabulary,
): string {
  return [
    `Generate deterministic black-box behavioral tests for exactly one Action of this Aluna capability: \`${inputs.action}\`.`,
    "",
    `${ACTION_UNDER_TEST_PREFIX} ${inputs.action}`,
    "",
    "Return one structured object with a `cases` array. Every case has these required fields:",
    `- \`action\`: always \`${inputs.action}\`. Never emit a case for another Action.`,
    "- `name`: a short, stable description of what the case proves.",
    "- `setupRows`: synthetic preexisting rows, newest-first. Use only the field names listed under `row_fields` below.",
    ...targetGuidance(inputs.action),
    ...inputGuidance(inputs.action),
    "- `expectedRows`: partial row values that must exist after the Action. Use an empty array when row identity is not the assertion.",
    "- `expectedRowCount`: the exact stored row count after the Action.",
    "- `expectFragmentIncludes`, `expectFragmentExcludes`, and `expectFragmentIncludesInOrder`: success-fragment assertions; use empty arrays when not needed.",
    "- `expectedError`: null for normal behavior, otherwise copy one case exactly from `behavioral_errors`.",
    ...platformErrorGuidance(inputs.action),
    "",
    "Required coverage:",
    ...coverage(inputs),
    "- Error cases assert only Action, stable code, affected fields, and semantic markers. Leave all three fragment assertion arrays empty; never assert product wording.",
    "",
    "Observable response shape — the platform rejects a suite that contradicts it:",
    ...responseShape(inputs.action),
    "- Every string in a fragment assertion array must exactly equal one of the allowed synthetic values above. Never assert labels, headings, status words, helper text, validation messages, or any other generated UI wording.",
    "",
    `Use only this closed source material for \`${inputs.action}\`; never infer from Handler code, field labels, field order, or a dependency's schema:`,
    canonicalTestInputJson(inputs),
    "",
    "Synthetic row vocabulary — the only field names `setupRows` and `expectedRows` may use. These are fixture mechanics, not behavior: they say what a row can be made of, never what the Action should do.",
    canonicalTestInputJson(fixture),
  ].join("\n");
}

function targetGuidance(action: HandlerUnitName): readonly string[] {
  if (action === "update" || action === "delete") {
    return [
      `- \`target\`: \`first_setup_row\` for a real ${action} target; \`missing_record\` only for the platform record_not_found case.`,
    ];
  }
  return [`- \`target\`: always null for ${action}.`];
}

function inputGuidance(action: HandlerUnitName): readonly string[] {
  if (action === "create" || action === "update") {
    return [
      "- `input`: parsed form inputs as strings, keyed by the active schema field names in the source material; repeat `string[]` entries to preserve order.",
    ];
  }
  if (action === "search") {
    return [
      "- `input`: exactly one entry using the literal field `q`. The searchable schema fields are row fields, never input names.",
    ];
  }
  return [`- \`input\`: always empty for ${action}.`];
}

function platformErrorGuidance(action: HandlerUnitName): readonly string[] {
  if (action === "update" || action === "delete") {
    return [
      `- \`expectedPlatformError\`: null except for exactly one missing-record ${action} case, with code \`record_not_found\`.`,
    ];
  }
  return [`- \`expectedPlatformError\`: always null for ${action}.`];
}

function coverage(inputs: ActionTestInputs): readonly string[] {
  const lines = [`- Include at least one normal ${inputs.action} case.`];
  if (inputs.behavioral_errors.length > 0) {
    lines.push(
      "- Include exactly one case for every entry in `behavioral_errors`, copied field-for-field.",
    );
  }
  if (inputs.action === "update" && hasMissingRequiredCase(inputs)) {
    lines.push(
      "- For a `missing_required_fields` update case, submit every affected field as an empty string so the case exercises runtime field-presence semantics.",
    );
  }
  if (inputs.action === "update" || inputs.action === "delete") {
    lines.push(
      `- Include exactly one missing-record ${inputs.action} case. That failure is platform-owned and never appears in \`behavioral_errors\`. It may still seed rows to prove unrelated data is unchanged.`,
      `- A normal ${inputs.action} case bound to \`first_setup_row\` must provide at least one setup row.`,
    );
  }
  if (inputs.action === "read") {
    lines.push(
      "- The normal read case must seed at least one row and assert at least one unique synthetic row marker in the returned collection. Do not use an empty collection as the normal read case; exact empty-read mechanics belong to always-on smoke.",
    );
  }
  if (inputs.action === "search") lines.push(...searchCoverage(inputs));
  return lines;
}

function searchCoverage(inputs: ActionTestInputs): readonly string[] {
  if (!hasSearchableFields(inputs)) {
    return [
      "- This capability has no active string/string[] fields. The normal search case must still submit exactly one nonblank `q`, but it cannot produce matching rows: leave all three fragment assertion arrays empty. Platform smoke owns the empty match-set evidence; behavioral ordering is honestly inapplicable.",
    ];
  }
  return [
    "- The normal search case must seed at least two matching rows with distinct synthetic marker values. Both ordered rows must mechanically match every whitespace-separated term in the nonblank `q` across the searchable fields, using platform normalization (Unicode NFKD compatibility decomposition, locale-independent lowercase, Latin-base diacritic folding, then NFKC recomposition).",
    "- Interpret the authored `behavior` to determine result order: newest-first when behavior is neutral/default, or its explicit deterministic custom ranking. `expectFragmentIncludesInOrder` must list one unique synthetic marker from each matching row in that exact order and may never be empty or single-item.",
    "- Do not add a non-match solely to prove filtering. If `expectFragmentExcludes` is nonempty, each excluded marker must identify exactly one setup row that mechanically does not match `q` under those same platform search rules.",
  ];
}

function responseShape(action: HandlerUnitName): readonly string[] {
  if (action === "create" || action === "update") {
    return [
      `- ${action} returns the one mutated item, never the refreshed collection. Leave \`expectFragmentIncludesInOrder\` empty: collection ordering is a state assertion, not fragment evidence.`,
      "- Unordered fragment assertions may use submitted `input` values, or values from `expectedRows` only when it holds exactly one affected mutated row (for example a normalized result).",
      "- Every fragment marker must be absent from unrelated setup rows, even when it is also a submitted value. Unrelated preserved rows are proved through `expectedRowCount` and `expectedRows`, never through the fragment.",
      "- Prefer leaving every fragment array empty when state alone proves the behavior.",
    ];
  }
  if (action === "read" || action === "search") {
    return [
      `- ${action} returns the collection, so ordered row markers are admissible. Fragment assertions may use \`setupRows\` or \`expectedRows\` values.`,
    ];
  }
  return [
    "- delete returns no observable item evidence: leave all three fragment assertion arrays empty on every case. Deletion is proved from scratch state through `expectedRows` and `expectedRowCount`.",
  ];
}

function hasSearchableFields(inputs: ActionTestInputs): boolean {
  return isSearchSchemaInput(inputs.schema) && inputs.schema.searchable_fields.length > 0;
}

function hasMissingRequiredCase(inputs: ActionTestInputs): boolean {
  return inputs.behavioral_errors.some(
    (errorCase) => errorCase.code === MISSING_REQUIRED_FIELDS_ERROR_CODE,
  );
}
