import { activeSpecFields, type CapabilitySpec } from "../registry/index.ts";
import type { HandlerUnitName } from "./units.ts";

export function buildFullBehavioralTestPrompt(spec: CapabilitySpec): string {
  const hasSearchableFields = activeSpecFields(spec.schema.fields).some(
    (field) => field.type === "string" || field.type === "string[]",
  );
  const searchCoverage = hasSearchableFields
    ? [
        "- Every normal search case must seed at least two matching rows with distinct synthetic marker values. Both ordered rows must mechanically match every whitespace-separated term in the nonblank `q` across active string/string[] fields, using platform normalization (Unicode NFKD compatibility decomposition, locale-independent lowercase, Latin-base diacritic folding, then NFKC recomposition).",
        "- For search, interpret the authored behavior to determine result order: use newest-first when behavior is neutral/default, or exercise its explicit deterministic custom ranking. `expectFragmentIncludesInOrder` must list one unique synthetic marker from each matching row in that exact order and may never be empty or single-item.",
        "- Do not add a non-match solely to prove filtering. If `expectFragmentExcludes` is nonempty, each excluded marker must identify exactly one setup row that mechanically does not match `q` under those same platform search rules.",
      ]
    : [
        "- This capability has no active string/string[] fields. Its normal search case must still submit exactly one nonblank `q`, but it cannot produce matching rows: leave all success-fragment assertion arrays empty. Platform smoke owns the empty match-set evidence; behavioral ordering is honestly inapplicable.",
      ];
  const actions = Object.fromEntries(
    spec.tools.map((action) => [
      action,
      {
        behavior: spec.behavior,
        schema: canonicalSchemaInput(spec, action),
        behavioral_errors: spec.behavioral_errors.filter(
          (errorCase) => errorCase.action === action,
        ),
        read_dependencies: (spec.read_dependencies as Record<string, readonly unknown[]>)[action],
      },
    ]),
  );
  return [
    "Generate deterministic black-box behavioral tests for every Action in this Aluna capability.",
    "",
    "Return one structured object with a `cases` array. Every case has these required fields:",
    "- `action`: the Action under test; every Action in the source material needs at least one normal case.",
    "- `setupRows`: synthetic preexisting rows, newest-first. Use only active fields.",
    "- `target`: null for create/read/search; `first_setup_row` for a real update/delete target; `missing_record` only for the platform record_not_found cases.",
    "- `input`: parsed form/query inputs as strings; repeat string[] entries to preserve order.",
    "  - create/update input fields are active schema field names; read/delete input is always empty; search input uses only the literal field `q` (searchable schema fields are row fields, never input names).",
    "- `expectedRows`: partial row values that must exist after the Action. Use an empty array when row identity is not the assertion.",
    "- `expectedRowCount`: the exact stored row count after the Action.",
    "- `expectFragmentIncludes`, `expectFragmentExcludes`, and `expectFragmentIncludesInOrder`: success-fragment assertions; use empty arrays when not needed. Search ordering evidence belongs in `expectFragmentIncludesInOrder`; platform smoke owns match-set/filtering evidence.",
    "- `expectedError`: null for normal behavior, otherwise copy one Action-owned case exactly from `behavioral_errors`.",
    "- `expectedPlatformError`: null except for exactly one missing-record update case and one missing-record delete case, each with code `record_not_found`.",
    "",
    "Required coverage:",
    "- Include at least one normal case for each of create, read, update, delete, and search.",
    ...searchCoverage,
    "- Include exactly one case for every authored `behavioral_errors` entry, including both create and update missing_required_fields when supplied.",
    "- For update missing_required_fields, submit each affected field with an empty string so the case exercises runtime field-presence semantics.",
    "- Include missing-record update and delete cases. Those failures are platform-owned and never appear in `behavioral_errors`.",
    "- Error cases assert only Action, stable code, affected fields, and semantic markers. Leave all fragment assertion arrays empty; never assert product wording.",
    "- Success fragment assertions may use only Action-relevant synthetic values: create/update use input or expectedRows; read/search use setupRows or expectedRows; delete uses none. Never assert generated product copy.",
    "- Every string in a fragment assertion array must exactly equal one of those allowed synthetic values. Do not assert labels, headings, status words, helper text, validation messages, or any other generated UI wording.",
    "- Prefer empty fragment assertion arrays for create/update/delete when expectedRows already proves the behavior. Read should include seeded record values; a search with searchable fields must use ordered markers from matching rows and may leave exclusions empty.",
    "- An update/delete case with `first_setup_row` must provide at least one setup row. A `missing_record` case may still seed rows to prove unrelated data is unchanged.",
    "",
    "Use only this per-Action source material; never infer from Handler code:",
    JSON.stringify({ actions }, null, 2),
  ].join("\n");
}

function canonicalSchemaInput(spec: CapabilitySpec, action: HandlerUnitName) {
  const active = activeSpecFields(spec.schema.fields);
  if (action === "read" || action === "delete") return [];
  if (action === "search") {
    return {
      input: { name: "q", type: "string" },
      searchable_fields: active
        .filter((field) => field.type === "string" || field.type === "string[]")
        .map(({ name, type }) => ({ name, type })),
    };
  }
  return active.map(({ name, type, required }) => ({ name, type, required }));
}
