import { activeSpecFields, type CapabilitySpec } from "../registry/index.ts";
import type { HandlerUnitName } from "./units.ts";

export function buildFullBehavioralTestPrompt(spec: CapabilitySpec): string {
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
    "- `expectFragmentIncludes`, `expectFragmentExcludes`, and `expectFragmentIncludesInOrder`: success-fragment assertions; use empty arrays when not needed. Search cases should exclude at least one seeded non-match when the behavior promises filtering.",
    "- `expectedError`: null for normal behavior, otherwise copy one Action-owned case exactly from `behavioral_errors`.",
    "- `expectedPlatformError`: null except for exactly one missing-record update case and one missing-record delete case, each with code `record_not_found`.",
    "",
    "Required coverage:",
    "- Include at least one normal case for each of create, read, update, delete, and search.",
    "- Include exactly one case for every authored `behavioral_errors` entry, including both create and update missing_required_fields when supplied.",
    "- For update missing_required_fields, submit each affected field with an empty string so the case exercises runtime field-presence semantics.",
    "- Include missing-record update and delete cases. Those failures are platform-owned and never appear in `behavioral_errors`.",
    "- Error cases assert only Action, stable code, affected fields, and semantic markers. Leave all fragment assertion arrays empty; never assert product wording.",
    "- Success fragment assertions may use only Action-relevant synthetic values: create/update use input or expectedRows; read/search use setupRows or expectedRows; delete uses none. Never assert generated product copy.",
    "- Every string in a fragment assertion array must exactly equal one of those allowed synthetic values. Do not assert labels, headings, status words, helper text, validation messages, or any other generated UI wording.",
    "- Prefer empty fragment assertion arrays for create/update/delete when expectedRows already proves the behavior. Read/search should include matching seeded record values and search should exclude a seeded non-match.",
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
