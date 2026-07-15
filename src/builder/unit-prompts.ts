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
  activeSpecFields,
  BEHAVIORAL_ERROR_MARKERS,
  type BehavioralErrorCase,
  type CapabilitySpec,
  presentationFieldDescriptors,
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
    "- You may include a small escaping helper locally for any non-record text you emit (validation error copy); records themselves go through `present`.",
    "",
    "Available global types in the isolated type-check:",
    "- `CapabilityContext` has `{ input, data, present }`.",
    "- `input.values` is a record of parsed `string | readonly string[]` values; repeated keys keep arrival order and spec-known list fields are always arrays.",
    "- `input.submittedFields` is a platform-validated `ReadonlySet<string>`; reserved `__aluna_` markers never reach generated code.",
    "- `data.insert(values)` returns the inserted row.",
    "- `data.select()` returns rows ordered newest first.",
    "- Data rows expose only `id`, `created_at`, and active schema fields. Platform-owned `extra` and inactive fields are unavailable and must never be read or written.",
    "- `present(record)` returns that record as a safe item HTML string.",
    "",
    "Action behavior:",
    action === "create"
      ? [
          "- Read values only from `input.values`, coerce them into the spec field types, call `data.insert`, and return `present(row)` for the inserted row.",
          "- Create presence is explicit: every active field is in `input.submittedFields`. A submitted empty optional scalar becomes `null`; an absent submitted boolean becomes `false`; never invent a value for a required field.",
          "- When this spec declares a missing_required_fields case, detect every missing required field before calling `data.insert`; return the declared validation-error fragment instead. Do not rely on `data.insert` throwing, because the Handler owns that user-visible error fragment.",
          "- A string[] input is already a readonly string array in submitted order. Narrow with `Array.isArray`, pass a flat mutable copy such as `[...value]` to data.insert, and never wrap the array in another array or split commas. The platform discards blank placeholders and validates required lists.",
          "- Destructure `{ input, data, present }`: `export default async function create({ input, data, present }: CapabilityContext): Promise<string>`.",
        ].join("\n")
      : [
          "- Call `data.select()`, map each row through `present`, join the results, and return that joined string.",
          "- When there are no rows, return an empty string. Do not render your own empty state or placeholder text — the platform owns the list's empty state, and returning nothing lets it show (and lets the first created record replace it cleanly).",
          "- Destructure only `{ data, present }`: `export default async function read({ data, present }: CapabilityContext): Promise<string>`.",
        ].join("\n"),
    "",
    "Validation error contract:",
    validationErrorContract,
    "",
    "Spec fields:",
    fields,
    "",
    "Action generation context JSON:",
    JSON.stringify(handlerGenerationContext(spec, action), null, 2),
  ].join("\n");
}

function buildValidationErrorContract(errorCases: readonly BehavioralErrorCase[]): string {
  return [
    "- Before calling `data.insert`, detect every missing required field covered by the cases below.",
    "- When one applies, return the declared validation-error fragment instead and do not insert a row.",
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
    "- For string[] fields, narrow with Array.isArray, preserve element order, and escape each element independently. Do not stringify or comma-split the list as one scalar.",
    "",
    buildItemRendererDesignInjection(layout),
    "",
    `Design direction (ui_intent.item.direction): ${spec.ui_intent.item.direction}`,
    "",
    "Declared item fields (the renderer receives exactly these names/types/labels):",
    itemFieldList(spec),
    "",
    "Item generation context JSON:",
    JSON.stringify(itemGenerationContext(spec), null, 2),
  ].join("\n");
}

/** One-line-per-field summary of the spec's user fields, shared by both prompts. */
function specFieldList(spec: CapabilitySpec): string {
  return activeSpecFields(spec.schema.fields)
    .map(
      (field) => `- ${field.name}: ${field.type}${field.required ? " (required)" : " (optional)"}`,
    )
    .join("\n");
}

function itemFieldList(spec: CapabilitySpec): string {
  return presentationFieldDescriptors(spec, spec.ui_intent.item.shows)
    .map((field) => `- ${field.name}: ${field.type}, label ${JSON.stringify(field.label)}`)
    .join("\n");
}

function handlerGenerationContext(spec: CapabilitySpec, action: HandlerUnitName): object {
  return {
    id: spec.id,
    schema: { fields: activeSpecFields(spec.schema.fields) },
    behavior: spec.behavior,
    behavioral_errors: spec.behavioral_errors.filter((errorCase) => errorCase.action === action),
  };
}

function itemGenerationContext(spec: CapabilitySpec): object {
  return {
    id: spec.id,
    collection: spec.ui_intent.collection,
    item: {
      direction: spec.ui_intent.item.direction,
      fields: presentationFieldDescriptors(spec, spec.ui_intent.item.shows),
    },
  };
}
