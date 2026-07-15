import { listInputModeForField, normalizeListInputValues } from "../list-input/index.ts";
import { activeSpecFields, type CapabilitySpec, isListFieldType } from "../registry/index.ts";
import type { CapabilityInput, CapabilityInputValue } from "./contract.ts";

export const ALUNA_RESERVED_PREFIX = "__aluna_";
export const ALUNA_PRESENT_MARKER = "__aluna_present";
export const ALUNA_RECORD_ID_MARKER = "__aluna_record_id";

export type WireProtocolAction = "create" | "read" | "update" | "delete" | "search";

export interface ParsedCapabilityRequest {
  readonly input: CapabilityInput;
  readonly recordTarget?: string;
}

export class WireProtocolError extends Error {
  override readonly name = "WireProtocolError";
}

/**
 * Parse and validate the closed capability HTTP protocol before generated code
 * loads. This function deliberately supports the final M4 Action vocabulary so
 * 4.2 can bind the already-validated record target without re-parsing raw HTTP.
 */
export async function parseCapabilityRequest(
  request: Request,
  action: WireProtocolAction,
  spec: CapabilitySpec,
): Promise<ParsedCapabilityRequest> {
  const grouped = await collectValues(request);
  rejectUnknownReservedKeys(grouped);

  const presentMarkers = take(grouped, ALUNA_PRESENT_MARKER);
  const targetMarkers = take(grouped, ALUNA_RECORD_ID_MARKER);
  const activeFields = activeSpecFields(spec.schema.fields);
  const submittedFields = validatePresenceMarkers(action, presentMarkers, activeFields);
  const recordTarget = validateRecordTarget(action, targetMarkers);
  const values = normalizeValues(
    action,
    grouped,
    activeFields,
    submittedFields,
    spec.ui_intent.form,
  );

  return {
    input: { values: Object.freeze(values), submittedFields },
    ...(recordTarget === undefined ? {} : { recordTarget }),
  };
}

async function collectValues(request: Request): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  const entries: Iterable<[string, string | File]> =
    request.method === "GET"
      ? new URL(request.url).searchParams.entries()
      : (await request.formData()).entries();

  for (const [key, value] of entries) {
    if (typeof value !== "string") {
      throw new WireProtocolError(`File input "${key}" is not supported by this protocol yet.`);
    }
    const existing = grouped.get(key);
    if (existing) existing.push(value);
    else grouped.set(key, [value]);
  }
  return grouped;
}

function rejectUnknownReservedKeys(grouped: ReadonlyMap<string, readonly string[]>): void {
  for (const key of grouped.keys()) {
    if (
      key.startsWith(ALUNA_RESERVED_PREFIX) &&
      key !== ALUNA_PRESENT_MARKER &&
      key !== ALUNA_RECORD_ID_MARKER
    ) {
      throw new WireProtocolError(`Unknown reserved marker "${key}".`);
    }
  }
}

function take(grouped: Map<string, string[]>, key: string): readonly string[] {
  const values = grouped.get(key) ?? [];
  grouped.delete(key);
  return values;
}

function validatePresenceMarkers(
  action: WireProtocolAction,
  markers: readonly string[],
  activeFields: ReturnType<typeof activeSpecFields>,
): ReadonlySet<string> {
  if (action !== "create" && action !== "update") {
    return rejectUnexpectedPresenceMarkers(action, markers);
  }

  const submitted = collectSubmittedFields(markers, activeFields);
  if (action === "create") requireAllCreateFields(activeFields, submitted);
  return submitted;
}

function rejectUnexpectedPresenceMarkers(
  action: WireProtocolAction,
  markers: readonly string[],
): ReadonlySet<string> {
  if (markers.length > 0) {
    throw new WireProtocolError(`Presence markers are not accepted for ${action}.`);
  }
  return new Set<string>();
}

function collectSubmittedFields(
  markers: readonly string[],
  activeFields: ReturnType<typeof activeSpecFields>,
): ReadonlySet<string> {
  const activeNames = new Set(activeFields.map((field) => field.name));
  const submitted = new Set<string>();
  for (const fieldName of markers) {
    if (fieldName.trim().length === 0 || !activeNames.has(fieldName)) {
      throw new WireProtocolError(`Invalid submitted field marker "${fieldName}".`);
    }
    if (submitted.has(fieldName)) {
      throw new WireProtocolError(`Duplicate submitted field marker "${fieldName}".`);
    }
    submitted.add(fieldName);
  }
  return submitted;
}

function requireAllCreateFields(
  activeFields: ReturnType<typeof activeSpecFields>,
  submitted: ReadonlySet<string>,
): void {
  const missing = activeFields
    .map((field) => field.name)
    .filter((fieldName) => !submitted.has(fieldName));
  if (missing.length > 0) {
    throw new WireProtocolError(
      `Create is missing submitted field markers: ${missing.join(", ")}.`,
    );
  }
}

function validateRecordTarget(
  action: WireProtocolAction,
  markers: readonly string[],
): string | undefined {
  const requiresTarget = action === "update" || action === "delete";
  if (!requiresTarget) {
    if (markers.length > 0) {
      throw new WireProtocolError(`A record target is not accepted for ${action}.`);
    }
    return undefined;
  }

  if (markers.length !== 1 || markers[0]?.trim().length === 0) {
    throw new WireProtocolError(`${action} requires exactly one nonblank record target.`);
  }
  return markers[0];
}

function normalizeValues(
  action: WireProtocolAction,
  grouped: ReadonlyMap<string, readonly string[]>,
  activeFields: ReturnType<typeof activeSpecFields>,
  submittedFields: ReadonlySet<string>,
  form: CapabilitySpec["ui_intent"]["form"],
): Record<string, CapabilityInputValue> {
  if (action === "read" || action === "delete") {
    return rejectUnexpectedValues(action, grouped);
  }
  if (action === "search") return normalizeSearchValues(grouped);
  return normalizeMutationValues(grouped, activeFields, submittedFields, form);
}

function rejectUnexpectedValues(
  action: "read" | "delete",
  grouped: ReadonlyMap<string, readonly string[]>,
): Record<string, CapabilityInputValue> {
  const firstKey = grouped.keys().next().value;
  if (firstKey !== undefined) {
    throw new WireProtocolError(`Input "${firstKey}" is not accepted for ${action}.`);
  }
  return {};
}

function normalizeSearchValues(
  grouped: ReadonlyMap<string, readonly string[]>,
): Record<string, CapabilityInputValue> {
  const values: Record<string, CapabilityInputValue> = {};
  for (const [key, repeated] of grouped) {
    if (key !== "q") {
      throw new WireProtocolError(`Search input "${key}" is not accepted.`);
    }
    values.q = normalizeScalarValue(key, repeated);
  }
  return values;
}

function normalizeMutationValues(
  grouped: ReadonlyMap<string, readonly string[]>,
  activeFields: ReturnType<typeof activeSpecFields>,
  submittedFields: ReadonlySet<string>,
  form: CapabilitySpec["ui_intent"]["form"],
): Record<string, CapabilityInputValue> {
  const activeByName = new Map(activeFields.map((field) => [field.name, field]));
  const values: Record<string, CapabilityInputValue> = {};

  for (const [key, repeated] of grouped) {
    const field = activeByName.get(key);
    validateMutationValueKey(key, field, submittedFields);
    values[key] = normalizeRepeatedValue(key, repeated, field, form);
  }

  addSubmittedEmptyLists(values, activeFields, submittedFields);
  return values;
}

function validateMutationValueKey(
  key: string,
  field: ReturnType<typeof activeSpecFields>[number] | undefined,
  submittedFields: ReadonlySet<string>,
): void {
  if (!submittedFields.has(key)) {
    throw new WireProtocolError(`Value "${key}" has no submitted field marker.`);
  }
  if (!field) throw new WireProtocolError(`Value "${key}" is not an active field.`);
}

function normalizeRepeatedValue(
  key: string,
  repeated: readonly string[],
  field: ReturnType<typeof activeSpecFields>[number] | undefined,
  form: CapabilitySpec["ui_intent"]["form"],
): CapabilityInputValue {
  if (field && isListFieldType(field.type)) {
    return normalizeListInputValues(listInputModeForField(form, field.name), repeated);
  }
  return normalizeScalarValue(key, repeated);
}

function normalizeScalarValue(key: string, repeated: readonly string[]): CapabilityInputValue {
  if (repeated.length !== 1) {
    throw new WireProtocolError(`Scalar input "${key}" was submitted more than once.`);
  }
  const only = repeated[0];
  if (only === undefined) throw new WireProtocolError(`Input "${key}" has no value.`);
  return only;
}

function addSubmittedEmptyLists(
  values: Record<string, CapabilityInputValue>,
  activeFields: ReturnType<typeof activeSpecFields>,
  submittedFields: ReadonlySet<string>,
): void {
  for (const field of activeFields) {
    if (!submittedFields.has(field.name) || !isListFieldType(field.type) || field.name in values)
      continue;
    values[field.name] = [];
  }
}
