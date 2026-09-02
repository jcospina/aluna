// Unit-generation prompts — the instructions handed to the provider per unit.
//
// Module 4.4 generates six units: the **item renderer** and all five Action
// **Handlers**. Each is generated from a prompt assembled here: the
// hard authoring contract for that unit kind, the spec's fields, and — on a retry —
// the previous attempt's failure fed back so the model returns a corrected unit
// rather than a patch. The item-renderer prompt injects the closed design vocabulary
// and the capability's chosen `collection.layout` so the item is composed *knowing*
// how the collection arranges it; the Handler prompt tells the
// model to render every record through the injected `present` adapter instead of
// emitting its own row markup (ADR-0005 §2 — kills create/read drift by construction).

import {
  activeSpecFields,
  admittedChoiceValues,
  BEHAVIORAL_ERROR_MARKERS,
  type BehavioralErrorCase,
  type CapabilityRow,
  type CapabilitySpec,
  isChoiceFieldType,
  isListFieldType,
  presentationFieldDescriptors,
  type SpecField,
} from "../../registry/index.ts";
import { deriveCapabilityTableDdl } from "../../runtime/data/index.ts";
import { buildItemRendererDesignInjection } from "./few-shot-gallery.ts";
import type { HandlerUnitName, UnitDescriptor, UnitGenerationFailure } from "./units.ts";

/**
 * The prompt for one unit: the kind-specific authoring contract plus the spec, with
 * the previous attempt's failure appended on a retry so the model returns a complete
 * corrected unit (not a patch).
 *
 * `priorSource` is an evolution regeneration's optional extra context. It is
 * appended only when the caller has already proven it admissible against *this* spec —
 * this builder never decides admissibility, it only places what it is given, so an
 * inadmissible unit's prompt is byte-for-byte the prompt a fresh unit would receive.
 */
export function buildUnitPrompt(
  spec: CapabilitySpec,
  unit: UnitDescriptor,
  previousFailure?: UnitGenerationFailure,
  dependencyCatalog: readonly CapabilityRow[] = [],
  priorSource?: string,
): string {
  const base =
    unit.kind === "handler"
      ? buildHandlerPrompt(spec, unit.name, dependencyCatalog)
      : buildItemRendererPrompt(spec);
  const withPriorSource = priorSource
    ? [base, "", ...priorSourceSection(unit, priorSource)].join("\n")
    : base;

  if (!previousFailure) return withPriorSource;

  return [
    withPriorSource,
    "",
    "Previous attempt failed. Return a complete corrected unit, not a patch.",
    "Failure to fix:",
    previousFailure.message,
    ...indexedInputRepairGuidance(unit, previousFailure.message),
  ].join("\n");
}

/**
 * The prior committed source, framed as what it is: reference material that was proven to
 * reference nothing outside the contract stated above, and that the contract above still
 * outranks. Placed after the contract and before any failure feedback, so the last thing
 * the model reads on a retry is still the failure it has to fix.
 */
function priorSourceSection(unit: UnitDescriptor, priorSource: string): string[] {
  return [
    `Prior committed source for this ${unit.kind === "handler" ? `${unit.name}.ts handler` : "item renderer"} (reference only):`,
    "- It was written for the previous version of this capability. It was proven to reference no data outside the contract above, but the behavior it implements may be exactly what is changing.",
    "- The contract above is authoritative — its Action behavior, fields, and dependencies all outrank this source. Keep what still fits; drop anything the contract above no longer states. Do not reintroduce fields, dependencies, or behavior from here.",
    "- Return the complete new unit, not a patch or a diff against this source.",
    "```typescript",
    priorSource,
    "```",
  ];
}

function indexedInputRepairGuidance(unit: UnitDescriptor, message: string): string[] {
  if (
    unit.kind !== "handler" ||
    (!message.includes("CapabilityInputValue | undefined") &&
      !(
        message.includes("readonly string[]") && message.includes("not assignable to type 'string'")
      ))
  ) {
    return [];
  }

  return [
    "",
    "Required repair for indexed input values:",
    "- Replace the unsafe scalar extraction with this readonly-safe shape; do not preserve or rearrange the failed narrowing:",
    '  `function scalarValue(value: string | readonly string[] | undefined): string { if (typeof value === "string") return value; return ""; }`',
    ...(unit.name === "update"
      ? [
          "- Keep update field admission separate: test `input.submittedFields.has(fieldName)` before adding that field to the patch.",
        ]
      : []),
  ];
}

function buildHandlerPrompt(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  dependencyCatalog: readonly CapabilityRow[],
): string {
  const fields = handlerFieldList(spec, action);
  const validationErrors = spec.behavioral_errors.filter(
    (errorCase) => errorCase.action === action,
  );
  const validationErrorContract =
    validationErrors.length > 0
      ? buildValidationErrorContract(action, validationErrors)
      : "- No spec-owned validation error cases apply to this action.";
  const rendersRecords = action !== "delete";

  return [
    `Generate the ${action}.ts handler for this Aluna capability.`,
    "",
    "Return one structured object with a single `content` string containing the complete TypeScript file.",
    "",
    "Hard contract:",
    "- No imports.",
    "- No raw HTTP: no Request, Response, Headers, or fetch.",
    "- Nothing ambient: no `process`, `globalThis`, `Bun`, `require`, `eval`, `Function`, `Reflect`, `import(...)` or `import.meta`, and no `.constructor`/`.prototype`/`.__proto__` access. The injected context is the only input.",
    "- No `<script>`, no `<style>`, and no event-handler attribute (`on*=`) anywhere in the fragment you return.",
    "- No raw mutation SQL. Canonical writes use only the injected `mutation` port; reads use only the injected `query` port.",
    "- Exactly one export: `export default async function ...`.",
    "- The function receives one Action-specific context parameter and returns `Promise<string>`.",
    "- The isolated checker uses strict TypeScript, noUncheckedIndexedAccess, and rejects unused parameters and locals.",
    "- Do not use unchecked array indexes or regex captures. Guard them first or provide a fallback before returning/assigning them as strings.",
    "- It returns an HTML fragment string.",
    "",
    ...(rendersRecords
      ? [
          "Rendering records — the presentation adapter:",
          "- Render every record by calling the injected `present(record)` adapter. It returns that target record wrapped as safe item HTML (the accessible trigger, escaped payload, click-to-open behavior, and enforced item markup).",
          "- Do NOT emit your own row/card/item markup, and do NOT build the item wrapper, a `data-item` attribute, or any click handling — the platform's adapter owns all of that.",
          "- Every other value you place in the fragment — a search term echoed back, a count, a name, any validation copy carrying user input — MUST be escaped first. Include a small escaping helper locally and run every interpolated value through it; records themselves go through `present`.",
          "",
        ]
      : []),
    "Available global types in the isolated type-check:",
    contextContract(action),
    ...inputValueContract(action),
    "- `input.submittedFields` is a platform-validated `ReadonlySet<string>`; reserved `__aluna_` markers never reach generated code.",
    "- A choice field's value has already been checked against its declared values by the platform, which answers an undeclared one itself. Never re-validate the option set or emit an error for it.",
    "- A string field's length has already been checked against its declared max_length by the platform, which answers an over-length submission itself. Never re-validate string length, truncate a value, or emit an error for it.",
    ...queryPortContract(action),
    "- Canonical ids, platform-owned `extra`, and inactive target fields are unavailable and must never be read or written.",
    ...actionPortContract(action),
    "",
    "Action behavior:",
    actionBehavior(spec, action),
    "",
    "Validation error contract:",
    validationErrorContract,
    "",
    "Action-safe target fields:",
    fields,
    "",
    "Action generation context JSON:",
    JSON.stringify(handlerGenerationContext(spec, action, dependencyCatalog), null, 2),
  ].join("\n");
}

function inputValueContract(action: HandlerUnitName): string[] {
  const declared =
    "- `input.values` is a `Readonly<Record<string, string | readonly string[]>>`; repeated keys keep arrival order and spec-known list fields are arrays when a value exists.";
  if (action === "read" || action === "delete") return [declared];

  const scalarRules = [
    declared,
    "- Every indexed `input.values[name]` read may be `undefined` under `noUncheckedIndexedAccess`—including a direct known-field read such as `input.values.title`. Its real indexed type is `string | readonly string[] | undefined`.",
    "- `input.submittedFields.has(name)` is runtime presence information; it does not narrow a separate `input.values[name]` expression for TypeScript. Read and narrow the value independently.",
    '- For scalar fields, narrow with `typeof value === "string"` first. Do not use `Array.isArray` and then return the unchecked false branch as a string: TypeScript may retain the `readonly string[]` member there.',
    '- Safe scalar extractor: `function scalarValue(value: string | readonly string[] | undefined): string { if (typeof value === "string") return value; return ""; }`.',
  ];
  if (action === "search") return scalarRules;

  return [
    ...scalarRules,
    "- Use the scalar extractor only for scalar schema fields. For a string[] field, use `Array.isArray(value) ? [...value] : []`; do not take only its first element.",
    "- A submitted unchecked boolean may have no `input.values` entry. Interpret that `undefined` as false only after `input.submittedFields` proves the boolean was submitted.",
    ...(action === "update"
      ? [
          "- Only add a field to an update patch when `input.submittedFields.has(fieldName)`; the extracted fallback is a submitted value, never evidence that an omitted field should be patched.",
        ]
      : []),
  ];
}

function buildValidationErrorContract(
  action: HandlerUnitName,
  errorCases: readonly BehavioralErrorCase[],
): string {
  const enforcement =
    action === "create"
      ? [
          "- You must detect every missing required field before calling `mutation.create`, using the cases below.",
          "- When one applies, return the declared validation-error fragment instead and do not insert a row.",
        ]
      : [
          "- Build the submitted merge patch without inventing omitted values. The target-bound update adapter validates the complete merged record and raises a typed failure whose `code` and `fields` match one case below.",
          "- Catch only that matching typed failure, translate it into variable product-voice copy, and return the declared validation-error fragment. Rethrow every other failure.",
          "- Narrow the caught `unknown` structurally before reading its `code` or `fields`; do not import a platform error class.",
          '- Guard the caught value before reading any property, then store each `unknown` property in a local variable before narrowing it. Safe catch-block pattern: `if (typeof failure !== "object" || failure === null) throw failure; const candidate = failure as { code?: unknown; fields?: unknown }; const rawFields = candidate.fields; if (Array.isArray(rawFields) && rawFields.every((field): field is string => typeof field === "string") && rawFields.includes("field_name")) { /* handle the known failure */ }`.',
        ];
  return [
    ...enforcement,
    "- The user-facing copy inside the fragment can vary in Aluna's product voice.",
    "- The stable contract is semantic attributes on the error element:",
    `  - ${BEHAVIORAL_ERROR_MARKERS.role_attribute}="${BEHAVIORAL_ERROR_MARKERS.role}"`,
    `  - ${BEHAVIORAL_ERROR_MARKERS.code_attribute} set to the case code`,
    `  - ${BEHAVIORAL_ERROR_MARKERS.fields_attribute} set to affected field names joined by "${BEHAVIORAL_ERROR_MARKERS.fields_separator}"`,
    "- Validation error cases:",
    JSON.stringify(errorCases, null, 2),
  ].join("\n");
}

function queryPortContract(action: HandlerUnitName): string[] {
  const common = [
    "- `query` parameters are positional SQLite values only (`string | number | bigint | boolean | null | Uint8Array`) paired with `?` placeholders. Never use named placeholders or `{ name, value }` parameter objects.",
    "- `query.all({ sql, parameters, result })` runs parameterized SQL inside this Action's declared catalog. Extra result descriptors use exactly `{ alias, type }` and return only those aliases.",
    "- Capability-table SQL may name only this capability's target table and the dependencies declared for this Action; the static checker rejects every other `cap_*` table before execution.",
  ];
  if (action !== "read" && action !== "search") return common;

  const records =
    "- Record-producing SQL for this Action returns ordered target ids through `query.records({ sql, parameters, targetIdAlias, result })`; each result is `{ record, values }`. The target-id alias is special: omit `result` when there are no additional projected values, and never declare the target id in `result`.";
  if (action === "read") return [...common, records];

  return [
    ...common,
    records,
    "- Search SQL must normalize both stored values and terms with the registered `platform_search_normalize(value)` SQL function (JavaScript NFKD compatibility decomposition + locale-independent lowercase + Latin-base combining-diacritic folding + NFKC recomposition).",
  ];
}

function contextContract(action: HandlerUnitName): string {
  if (action === "create") {
    return "- `CapabilityCreateContext` has exactly `{ input, mutation, query, present }`; its mutation port exposes only `create(values)`.";
  }
  if (action === "update") {
    return "- `CapabilityUpdateContext` has exactly `{ input, mutation, query, present }`; its target-bound mutation port exposes only `update(values)`.";
  }
  if (action === "delete") {
    return "- `CapabilityDeleteContext` has exactly `{ input, mutation, query }`; its target-bound mutation port exposes only `delete()` and there is no presentation adapter.";
  }
  return "- `CapabilityContext` has exactly `{ input, query, present }` and no mutation authority.";
}

function actionPortContract(action: HandlerUnitName): string[] {
  if (action === "create") {
    return [
      "- `mutation.create(values)` returns the inserted Action-safe record; it has no table, capability, or record selector.",
      "- `present(record)` returns that record as a safe item HTML string.",
    ];
  }
  if (action === "update") {
    return [
      "- `mutation.update(values)` merges only submitted fields into the router-bound target and returns the updated Action-safe record; it has no table, capability, or record selector.",
      "- `present(record)` returns that record as a safe item HTML string.",
    ];
  }
  if (action === "delete") {
    return [
      "- `mutation.delete()` deletes only the router-bound target and returns void; it has no table, capability, or record selector.",
    ];
  }
  return ["- `present(record)` returns that record as a safe item HTML string."];
}

function actionBehavior(spec: CapabilitySpec, action: HandlerUnitName): string {
  const tableName = deriveCapabilityTableDdl(spec).tableName;
  if (action === "create") {
    return [
      "- Read values only from `input.values`, coerce them into the Action-safe field types, call `mutation.create`, and return `present(row)` for the inserted row.",
      '- Create presence is explicit: every active field is in `input.submittedFields`. A submitted empty optional scalar becomes `null`; treat either "on" (browser checkbox) or "true" (Gate synthetic input) as a checked boolean, while an unchecked submitted boolean has no value and becomes `false`; never invent a value for a required field.',
      "- A string[] input is already a readonly string array in submitted order. Narrow with `Array.isArray`, pass a flat mutable copy such as `[...value]` to `mutation.create`, and never wrap the array in another array or split commas.",
      "- Destructure `{ input, mutation, present }`: `export default async function create({ input, mutation, present }: CapabilityCreateContext): Promise<string>`.",
    ].join("\n");
  }
  if (action === "read") {
    return [
      `- Call \`query.records\` with SQL \`SELECT "id" AS "target_id" FROM "${tableName}" ORDER BY "created_at" DESC, "id" DESC\`, map each returned \`record\` through \`present\`, join the results, and return that joined string.`,
      "- When there are no rows, return an empty string. Do not render your own empty state; the platform owns the list's empty state.",
      "- Destructure only `{ query, present }`: `export default async function read({ query, present }: CapabilityContext): Promise<string>`.",
    ].join("\n");
  }
  if (action === "update") {
    return [
      "- Build a patch from fields present in `input.submittedFields` only. Omitted fields mean preserve and must not appear in the patch.",
      '- A submitted empty optional scalar becomes `null`; treat either "on" (browser checkbox) or "true" (Gate synthetic input) as a checked boolean, while a submitted boolean without a value becomes `false`; a submitted string[] is already an ordered readonly array and must be copied flat with `[...value]`.',
      "- Call `mutation.update(patch)` and return `present(row)` for the updated row. The target is already bound by the platform and is never Handler input.",
      "- Destructure `{ input, mutation, present }`: `export default async function update({ input, mutation, present }: CapabilityUpdateContext): Promise<string>`.",
    ].join("\n");
  }
  if (action === "delete") {
    return [
      "- Call `mutation.delete()` exactly once and return an empty string. Platform chrome owns confirmation, success copy, and the records-region refresh.",
      "- Destructure only `{ mutation }`: `export default async function remove({ mutation }: CapabilityDeleteContext): Promise<string>`.",
    ].join("\n");
  }
  return [
    "- Read scalar `q` from `input.values`; missing, empty, or Unicode-whitespace-only input must return exactly the canonical read rows in default order.",
    "- Split a nonblank query on Unicode whitespace into literal terms. Every normalized term must match somewhere across any active string field or any element of any active string[] field (AND across terms, OR across fields/elements).",
    "- Use parameterized SQL and `instr(platform_search_normalize(stored_value), platform_search_normalize(term))`; do not use `LIKE`, `lower`, or `NOCASE`. Quotes and SQL wildcard characters are literal data.",
    '- Pass all terms as one JSON array parameter: `parameters: [JSON.stringify(terms)]`, then expand them in SQL with `WITH "search_terms" AS (SELECT "value" AS "term" FROM json_each(?))`. Do not generate dynamic placeholders or parameter objects.',
    "- For string[] fields, search elements through `json_each`. Exclude non-text fields, inactive fields, platform columns, and undeclared dependency data.",
    `- Return ordered unique target ids from "${tableName}" through \`query.records\`; omit \`result\` unless projecting additional declared dependency values, map records through \`present\`, and join them.`,
    "- When behavior explicitly authors a deterministic search-specific ranking for nonblank matches, implement it instead of the default; the behavioral tier must prove that authored ranking. A general collection/read ordering that agrees with the default is behavior-neutral, not a search-specific rerank.",
    "- For a behavior-neutral search, order nonblank matches by `created_at DESC, id DESC`.",
    "- Destructure `{ input, query, present }`: `export default async function search({ input, query, present }: CapabilityContext): Promise<string>`.",
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
    "- Nothing ambient: no `process`, `globalThis`, `Bun`, `require`, `fetch`, `eval`, `Function`, `Reflect`, `import(...)` or `import.meta`, and no `.constructor`/`.prototype`/`.__proto__` access. The record you are handed is the only input.",
    "- Exactly one export: `export default function ...`.",
    "- The function takes one parameter — the record — and returns a plain HTML `string`. It is synchronous: do NOT make it async.",
    "- Signature: `export default function renderItem(record: Record<string, unknown>): string`.",
    "- The isolated checker uses strict TypeScript, noUncheckedIndexedAccess, and rejects unused parameters and locals. A record value is typed `unknown` — coerce and narrow it (e.g. `String(value)`) before use.",
    "- Return ONLY the inner markup for one record. Do NOT emit the list container, an item wrapper/card frame, a `data-item` attribute, links, buttons, inputs, other interactive controls, `<script>`, or any event-handler attribute (`on*=`) — the platform owns all of that.",
    "- Escape every record value before placing it in markup (include a small escaping helper locally). Never interpolate a record value into a `style` attribute.",
    "- Any URL you emit must be same-origin — a path — or an inline `data:image/*`. Never point at another host: a record does not fetch from anywhere else, which is the same rule that forbids `url(...)` in a style.",
    "- For string[] fields, narrow with Array.isArray, preserve element order, and escape each element independently. Do not stringify or comma-split the list as one scalar.",
    "",
    buildItemRendererDesignInjection(layout),
    "",
    `Design direction (ui_intent.item.direction): ${spec.ui_intent.item.direction}`,
    "",
    "Declared item fields (the renderer receives exactly these names/types/labels):",
    itemFieldList(spec),
    "- A choice field's record value is one of its option `value` strings. Present the matching option `label`, never the raw stored value; fall back to the stored value only if no option matches.",
    "",
    "Item generation context JSON:",
    JSON.stringify(itemGenerationContext(spec), null, 2),
  ].join("\n");
}

function handlerFieldList(spec: CapabilitySpec, action: HandlerUnitName): string {
  const fields = handlerFieldProjection(spec, action);
  if (fields.length === 0) return "- None.";
  return fields
    .map((field) =>
      "required" in field
        ? `- ${field.name}: ${field.type}${field.required ? " (required)" : " (optional)"}`
        : `- ${field.name}: ${field.type}`,
    )
    .join("\n");
}

function itemFieldList(spec: CapabilitySpec): string {
  return presentationFieldDescriptors(spec, spec.ui_intent.item.shows)
    .map((field) => {
      const options =
        "values" in field && field.values !== undefined
          ? `, options ${JSON.stringify(field.values)}`
          : "";
      return `- ${field.name}: ${field.type}, label ${JSON.stringify(field.label)}${options}`;
    })
    .join("\n");
}

function handlerGenerationContext(
  spec: CapabilitySpec,
  action: HandlerUnitName,
  dependencyCatalog: readonly CapabilityRow[],
): object {
  const declared =
    action in spec.read_dependencies
      ? spec.read_dependencies[action as keyof typeof spec.read_dependencies]
      : [];
  const dependencies = declared.map((dependency) => {
    const row = dependencyCatalog.find(
      (candidate) =>
        candidate.id === dependency.capability_id &&
        candidate.incarnation_id === dependency.incarnation_id,
    );
    if (!row) {
      throw new Error(
        `Generation catalog is missing ${dependency.capability_id}/${dependency.incarnation_id}.`,
      );
    }
    return {
      capability_id: row.id,
      incarnation_id: row.incarnation_id,
      label: row.label,
      prompt_context: row.prompt_context,
      active_schema: { fields: activeSpecFields(row.schema.fields) },
    };
  });
  return {
    id: spec.id,
    schema: { fields: handlerFieldProjection(spec, action) },
    behavior: spec.behavior,
    behavioral_errors: spec.behavioral_errors.filter((errorCase) => errorCase.action === action),
    read_dependencies: dependencies,
  };
}

type MutationFieldProjection = Pick<SpecField, "name" | "type" | "required"> & {
  readonly values?: readonly string[];
};
type SearchFieldProjection = Pick<SpecField, "name" | "type">;

/**
 * Searchability, decided the same way the Diff Engine and the behavioral total inputs
 * decide it. All four must move together, or the Diff would select `search` for a field
 * this projection never names.
 */
function isSearchableProjectionType(type: SpecField["type"]): boolean {
  return type === "string" || isChoiceFieldType(type) || isListFieldType(type);
}

function handlerFieldProjection(
  spec: CapabilitySpec,
  action: HandlerUnitName,
): readonly (MutationFieldProjection | SearchFieldProjection)[] {
  const active = activeSpecFields(spec.schema.fields);
  if (action === "create" || action === "update") {
    // A choice carries the value strings it admits, so the Handler can read a stored
    // selection and write behavior around it. It is context, not a validation duty: the
    // platform has already refused anything undeclared before the Handler runs.
    //
    // The strings alone, in value order. A Handler never draws the control, so a label, a
    // note, a heading, the authored order and whether an option is still on offer are all
    // things it must not be able to go stale about — which is what lets the Diff matrix
    // map those facts to platform work without copying a Handler that knew them.
    return active.map(({ name, type, required, values }) => ({
      name,
      type,
      required,
      ...(values === undefined
        ? {}
        : { values: [...admittedChoiceValues({ name, type, values })].sort() }),
    }));
  }
  if (action === "search") {
    return active
      .filter((field) => isSearchableProjectionType(field.type))
      .map(({ name, type }) => ({ name, type }));
  }
  return [];
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
