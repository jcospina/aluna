// Unit-generation prompts — the instructions handed to the provider per unit.
//
// Module 3 (epic 3.4/02) generates three units: the **item renderer** and the
// `create`/`read` **Handlers**. Each is generated from a prompt assembled here: the
// hard authoring contract for that unit kind, the spec's fields, and — on a retry —
// the previous attempt's failure fed back so the model returns a corrected unit
// rather than a patch. The item-renderer prompt injects the closed design vocabulary
// and the capability's chosen `collection.layout` so the item is composed *knowing*
// how the collection arranges it (ADR-0005 §4 & §6); the Handler prompt tells the
// model to render every record through the injected `present` adapter instead of
// emitting its own row markup (ADR-0005 §2 — kills create/read drift by construction).

import {
  BEHAVIORAL_ERROR_MARKERS,
  type BehavioralErrorCase,
  type CapabilitySpec,
} from "../registry/index.ts";
import { buildItemRendererDesignInjection } from "./few-shot-gallery.ts";
import type { HandlerUnitName, UnitDescriptor, UnitGenerationFailure } from "./units.ts";

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
    unit.kind === "handler" ? buildHandlerPrompt(spec, unit.name) : buildItemRendererPrompt(spec);

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
  const fields = specFieldList(spec);
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
    "",
    "Rendering records — the presentation adapter:",
    "- Render every record by calling the injected `present(record)` adapter. It returns that record wrapped as safe item HTML (the accessible trigger, the escaped payload, click-to-open, and the enforced item markup).",
    "- Do NOT emit your own row/card/item markup, and do NOT build the item wrapper, a `data-item` attribute, or any click handling — the platform's adapter owns all of that.",
    "- You may include a small escaping helper locally for any non-record text you emit (an empty state, validation error copy); records themselves go through `present`.",
    "",
    "Available global types in the isolated type-check:",
    "- `CapabilityContext` has `{ input, data, present }`.",
    "- `input` is a flat record of form/query strings.",
    "- `data.insert(values)` returns the inserted row.",
    "- `data.select()` returns rows ordered newest first.",
    "- `present(record)` returns that record as a safe item HTML string.",
    "",
    "Action behavior:",
    action === "create"
      ? [
          "- Coerce form strings into the spec field types, call `data.insert`, and return `present(row)` for the inserted row.",
          "- Destructure `{ input, data, present }`: `export default async function create({ input, data, present }: CapabilityContext): Promise<string>`.",
        ].join("\n")
      : [
          "- Call `data.select()`, map each row through `present`, and join the results; include a helpful empty state when there are no rows.",
          "- Destructure only `{ data, present }`: `export default async function read({ data, present }: CapabilityContext): Promise<string>`.",
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

function buildItemRendererPrompt(spec: CapabilitySpec): string {
  const layout = spec.ui_intent.collection.layout;

  return [
    "Generate the item.ts item renderer for this Aluna capability.",
    "",
    "Return one structured object with a single `content` string containing the complete TypeScript file.",
    "",
    "The item renderer turns ONE record into the capability-specific inner markup for it — the creative surface of this capability's list. The platform wraps whatever you return in the accessible item trigger, embeds the record payload, wires click-to-open, and runs a runtime allow-list enforcer over your markup; you compose one record's own fields, nothing else.",
    "",
    "Hard contract:",
    "- No imports.",
    "- Exactly one export: `export default function ...`.",
    "- The function takes one parameter — the record — and returns a plain HTML `string`. It is synchronous: do NOT make it async.",
    "- Signature: `export default function renderItem(record: Record<string, unknown>): string`.",
    "- The isolated checker uses strict TypeScript, noUncheckedIndexedAccess, and rejects unused parameters and locals. A record value is typed `unknown` — coerce and narrow it (e.g. `String(value)`) before use.",
    "- Return ONLY the inner markup for one record. Do NOT emit the list container, an item wrapper/card frame, a `data-item` attribute, links, buttons, inputs, other interactive controls, `<script>`, or any event-handler attribute (`on*=`) — the platform owns all of that.",
    "- Escape every record value before placing it in markup (include a small escaping helper locally). Never interpolate a record value into a `style` attribute.",
    "",
    buildItemRendererDesignInjection(layout),
    "",
    `Design direction (ui_intent.item): ${spec.ui_intent.item}`,
    "",
    "Spec fields:",
    specFieldList(spec),
    "",
    "Capability spec JSON:",
    JSON.stringify(spec, null, 2),
  ].join("\n");
}

/** One-line-per-field summary of the spec's user fields, shared by both prompts. */
function specFieldList(spec: CapabilitySpec): string {
  return spec.schema.fields
    .map(
      (field) => `- ${field.name}: ${field.type}${field.required ? " (required)" : " (optional)"}`,
    )
    .join("\n");
}
