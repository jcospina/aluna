// Unit-generation prompts — the instructions handed to the provider per unit.
//
// Each of the four M2 units (the `create`/`read` handlers and `list`/`create`
// views) is generated from a prompt assembled here: the hard authoring contract for
// that unit kind, the spec's fields, and — on a retry — the previous attempt's
// failure fed back so the model returns a corrected unit rather than a patch.

import {
  BEHAVIORAL_ERROR_MARKERS,
  type BehavioralErrorCase,
  type CapabilitySpec,
} from "../registry/index.ts";
import type {
  HandlerUnitName,
  UnitDescriptor,
  UnitGenerationFailure,
  ViewUnitName,
} from "./units.ts";

/**
 * The prompt for one unit: the kind-specific authoring contract plus the spec, with
 * the previous attempt's failure appended on a retry so the model returns a complete
 * corrected unit (not a patch).
 */
export function buildUnitPrompt(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  previousFailure?: UnitGenerationFailure,
): string {
  const base =
    unit.kind === "handler"
      ? buildHandlerPrompt(spec, unit.name)
      : buildViewPrompt(spec, unit.name);

  if (!previousFailure) return base;

  return [
    base,
    "",
    "Previous attempt failed. Return a complete corrected unit, not a patch.",
    "Failure to fix:",
    previousFailure.message,
  ].join("\n");
}

function buildHandlerPrompt(spec: CapabilitySpec, action: HandlerUnitName): string {
  const fields = spec.schema.fields
    .map(
      (field) => `- ${field.name}: ${field.type}${field.required ? " (required)" : " (optional)"}`,
    )
    .join("\n");
  const validationErrors = spec.behavioral_errors.filter(
    (errorCase) => errorCase.action === action,
  );
  const validationErrorContract =
    validationErrors.length > 0
      ? buildValidationErrorContract(validationErrors)
      : "- No spec-owned validation error cases apply to this action.";

  return [
    `Generate the ${action}.ts handler for this Aluna capability.`,
    "",
    "Return one structured object with a single `content` string containing the complete TypeScript file.",
    "",
    "Hard contract:",
    "- No imports.",
    "- No raw HTTP: no Request, Response, Headers, or fetch.",
    "- No table names or SQL. Use only the injected `data` tool.",
    "- Exactly one export: `export default async function ...`.",
    "- The function receives one `CapabilityContext` parameter and returns `Promise<string>`.",
    "- The isolated checker uses strict TypeScript, noUncheckedIndexedAccess, and rejects unused parameters and locals.",
    "- Do not use unchecked array indexes or regex captures. Guard them first or provide a fallback before returning/assigning them as strings.",
    "- It returns an HTML fragment string.",
    "- Include any escaping helper locally in the file.",
    "",
    "Available global types in the isolated type-check:",
    "- `CapabilityContext` has `{ input, data }`.",
    "- `input` is a flat record of form/query strings.",
    "- `data.insert(values)` returns the inserted row.",
    "- `data.select()` returns rows ordered newest first.",
    "",
    "Action behavior:",
    action === "create"
      ? "- Coerce form strings into the spec field types, call `data.insert`, and return a fragment for the new row."
      : [
          "- Call `data.select()` and return a fragment for the current rows, including a helpful empty state.",
          "- For `read`, destructure only `{ data }`: `export default async function read({ data }: CapabilityContext): Promise<string>`.",
        ].join("\n"),
    "",
    "Validation error contract:",
    validationErrorContract,
    "",
    "Spec fields:",
    fields,
    "",
    "Capability spec JSON:",
    JSON.stringify(spec, null, 2),
  ].join("\n");
}

function buildValidationErrorContract(errorCases: readonly BehavioralErrorCase[]): string {
  return [
    "- Before calling `data.insert`, detect the validation errors listed below.",
    "- When one applies, return an HTML error fragment and do not insert a row.",
    "- The user-facing copy inside the fragment can vary in Aluna's product voice.",
    "- The stable contract is semantic attributes on the error element:",
    `  - ${BEHAVIORAL_ERROR_MARKERS.role_attribute}="${BEHAVIORAL_ERROR_MARKERS.role}"`,
    `  - ${BEHAVIORAL_ERROR_MARKERS.code_attribute} set to the case code`,
    `  - ${BEHAVIORAL_ERROR_MARKERS.fields_attribute} set to affected field names joined by "${BEHAVIORAL_ERROR_MARKERS.fields_separator}"`,
    "- Validation error cases:",
    JSON.stringify(errorCases, null, 2),
  ].join("\n");
}

function buildViewPrompt(spec: CapabilitySpec, view: ViewUnitName): string {
  const fieldControls = spec.schema.fields
    .map(
      (field) => `- ${field.name}: ${field.type}${field.required ? " (required)" : " (optional)"}`,
    )
    .join("\n");

  return [
    `Generate the ${view}.html view for this Aluna capability.`,
    "",
    "Return one structured object with a single `content` string containing the complete HTML fragment.",
    "",
    "Hard contract:",
    "- Data-free scaffolding only. Do not include sample rows, record ids, created_at values, or user data.",
    "- No scripts and no template/interpolation placeholders.",
    "- Use the fixed router convention; generated views never invent routes.",
    view === "list"
      ? [
          `- Include one dynamic region with id="${spec.id}-records" that loads through hx-get="/capability/${spec.id}/read".`,
          "- Do not include any create/edit form, submit button, or hx-post in the list view.",
        ].join("\n")
      : [
          `- Include exactly one form that submits through hx-post="/capability/${spec.id}/create".`,
          `- The form must target the live list region with hx-target="#${spec.id}-records" and hx-swap="afterbegin".`,
        ].join("\n"),
    "- Do not include native form action/method attributes or links to capability URLs; generated views use only fixed HTMX attributes.",
    "",
    "Fields for create controls:",
    fieldControls,
    "",
    "Capability spec JSON:",
    JSON.stringify(spec, null, 2),
  ].join("\n");
}
