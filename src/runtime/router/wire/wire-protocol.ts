import { isFileKey } from "../../../platform/files/store/ledger.ts";
import {
  ALUNA_RESERVED_FIELD_PREFIX,
  type CapabilitySpec,
  FORM_CHANGED_ERROR_CODE,
  isFileFieldType,
  isFileListFieldType,
  isListFieldType,
  type SpecField,
} from "../../../registry/index.ts";
import {
  MAX_SEARCH_QUERY_LENGTH,
  MAX_SEARCH_TERMS,
  MissingRequiredFieldsError,
} from "../../data/index.ts";
import { listInputModeForField, normalizeListInputValues } from "../../field-types/list-input.ts";
import type { CapabilityInput, CapabilityInputValue } from "../contract.ts";

export const ALUNA_PRESENT_MARKER = `${ALUNA_RESERVED_FIELD_PREFIX}present`;
export const ALUNA_RECORD_ID_MARKER = `${ALUNA_RESERVED_FIELD_PREFIX}record_id`;
/**
 * What an edit's file field held when its form was drawn, posted beside its value, so a form drawn
 * before another window saved the field is told so, whether it keeps, replaces or clears.
 */
export const ALUNA_DRAWN_MARKER = `${ALUNA_RESERVED_FIELD_PREFIX}drawn`;

/** The {@link ALUNA_DRAWN_MARKER} value naming the keys `field` held, in order: `field:key,key`. */
export function drawnFileValue(field: string, keys: readonly string[]): string {
  return `${field}:${keys.join(",")}`;
}

export type WireProtocolAction = "create" | "read" | "update" | "delete" | "search";

export interface ParsedCapabilityRequest {
  readonly input: CapabilityInput;
  readonly recordTarget?: string;
  /** On an update, the keys each submitted file field held when the form was drawn. */
  readonly drawnFiles?: ReadonlyMap<string, readonly string[]>;
}

export class WireProtocolError extends Error {
  override readonly name = "WireProtocolError";
}

/**
 * A create or an edit from a form drawn before an evolution: it names a field since hidden, a
 * pending upload in it included, or leaves out one the form never drew (Module 7 PLAN decision
 * 34). The person is asked to open the form again rather than shown a protocol failure.
 */
export class FormChangedError extends Error {
  override readonly name = "FormChangedError";
  readonly code = FORM_CHANGED_ERROR_CODE;
  readonly action: "create" | "update";
  readonly fields: readonly string[];

  constructor(action: "create" | "update", fields: readonly string[]) {
    super(`The ${action} form was drawn before these fields changed: ${fields.join(", ")}.`);
    this.action = action;
    this.fields = [...fields];
  }
}

/**
 * A save refused for a required field its submission never marked: the form was drawn before it
 * was added or made required, so no control in it can fill that field (Module 7 PLAN decision 35a).
 */
export function asFormChanged(error: unknown, input: CapabilityInput): unknown {
  if (!(error instanceof MissingRequiredFieldsError)) return error;
  if (error.fields.every((field) => input.submittedFields.has(field))) return error;
  return new FormChangedError(error.action, error.fields);
}

/**
 * Parse and validate the closed capability HTTP protocol before generated code loads, binding the
 * record target an update or a delete acts on.
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
  const drawnMarkers = take(grouped, ALUNA_DRAWN_MARKER);
  // A form drawn at an earlier version may name a field since hidden: it is parsed as any field
  // is, so a malformed request stays a protocol error, and only then refused as stale.
  const formFields = spec.schema.fields;
  const recordTarget = validateRecordTarget(action, targetMarkers);
  const submittedFields = validatePresenceMarkers(action, presentMarkers, formFields);
  const drawnFiles = validateDrawnMarkers(action, drawnMarkers, formFields, submittedFields);
  const values = normalizeValues(action, grouped, formFields, submittedFields, spec.ui_intent.form);
  refuseStaleForm(action, spec, submittedFields);

  return {
    input: { values: Object.freeze(values), submittedFields },
    ...(recordTarget === undefined ? {} : { recordTarget }),
    ...(drawnFiles === undefined ? {} : { drawnFiles }),
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
      throw new WireProtocolError(`File input "${key}" is refused: a file field posts its key.`);
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
      key.startsWith(ALUNA_RESERVED_FIELD_PREFIX) &&
      key !== ALUNA_PRESENT_MARKER &&
      key !== ALUNA_RECORD_ID_MARKER &&
      key !== ALUNA_DRAWN_MARKER
    ) {
      throw new WireProtocolError(`Unknown reserved marker "${key}".`);
    }
  }
}

/**
 * A form that names a hidden field, or a create that leaves out an active field its form would
 * have drawn, was drawn before an evolution changed the capability.
 */
function refuseStaleForm(
  action: WireProtocolAction,
  spec: CapabilitySpec,
  submitted: ReadonlySet<string>,
): void {
  if (action !== "create" && action !== "update") return;
  const stale = spec.schema.fields
    .filter((field) =>
      field.lifecycle === "active"
        ? action === "create" && !isFileFieldType(field.type) && !submitted.has(field.name)
        : submitted.has(field.name),
    )
    .map((field) => field.name);
  if (stale.length > 0) throw new FormChangedError(action, stale);
}

function take(grouped: Map<string, string[]>, key: string): readonly string[] {
  const values = grouped.get(key) ?? [];
  grouped.delete(key);
  return values;
}

function validatePresenceMarkers(
  action: WireProtocolAction,
  markers: readonly string[],
  formFields: readonly SpecField[],
): ReadonlySet<string> {
  if (action !== "create" && action !== "update") {
    return rejectUnexpectedPresenceMarkers(action, markers);
  }
  // Every control a form draws posts its marker, so a create with none came from no form, unless
  // evolution hid every field and the form draws no control at all.
  const drawsControls = formFields.some((field) => field.lifecycle === "active");
  if (action === "create" && markers.length === 0 && drawsControls) {
    throw new WireProtocolError("Create carries no submitted field markers.");
  }
  return collectSubmittedFields(markers, formFields);
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
  formFields: readonly SpecField[],
): ReadonlySet<string> {
  const formNames = new Set(formFields.map((field) => field.name));
  const submitted = new Set<string>();
  for (const fieldName of markers) {
    if (fieldName.trim().length === 0 || !formNames.has(fieldName)) {
      throw new WireProtocolError(`Invalid submitted field marker "${fieldName}".`);
    }
    if (submitted.has(fieldName)) {
      throw new WireProtocolError(`Duplicate submitted field marker "${fieldName}".`);
    }
    submitted.add(fieldName);
  }
  return submitted;
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

/**
 * An update names, at most once, what each file field it submits held when drawn; nothing else
 * does. A field it leaves undrawn, as a form drawn before the marker existed does, is the file
 * rule's to answer: that form has to be opened again.
 */
function validateDrawnMarkers(
  action: WireProtocolAction,
  markers: readonly string[],
  formFields: readonly SpecField[],
  submittedFields: ReadonlySet<string>,
): ReadonlyMap<string, readonly string[]> | undefined {
  if (action !== "update") {
    if (markers.length > 0) {
      throw new WireProtocolError(`Drawn file markers are not accepted for ${action}.`);
    }
    return undefined;
  }
  const fileFields = new Map(
    formFields
      .filter((field) => isFileFieldType(field.type) && submittedFields.has(field.name))
      .map((field) => [field.name, isFileListFieldType(field.type)]),
  );
  const drawn = new Map<string, readonly string[]>();
  for (const marker of markers) {
    const [name, keys] = parseDrawnMarker(marker, fileFields);
    if (drawn.has(name)) throw new WireProtocolError(`Duplicate drawn file marker "${name}".`);
    drawn.set(name, keys);
  }
  return drawn;
}

/** @param fileFields each submitted file field, and whether it is a `file[]` */
function parseDrawnMarker(
  marker: string,
  fileFields: ReadonlyMap<string, boolean>,
): [string, readonly string[]] {
  const colon = marker.indexOf(":");
  const name = marker.slice(0, colon);
  const listed = marker.slice(colon + 1);
  const keys = listed === "" ? [] : listed.split(",");
  const isList = fileFields.get(name);
  const fits = isList === true || (isList === false && keys.length <= 1);
  if (colon < 0 || !fits || !keys.every(isFileKey) || new Set(keys).size !== keys.length) {
    throw new WireProtocolError(`Invalid drawn file marker "${marker}".`);
  }
  return [name, keys];
}

function normalizeValues(
  action: WireProtocolAction,
  grouped: ReadonlyMap<string, readonly string[]>,
  formFields: readonly SpecField[],
  submittedFields: ReadonlySet<string>,
  form: CapabilitySpec["ui_intent"]["form"],
): Record<string, CapabilityInputValue> {
  if (action === "read" || action === "delete") {
    return rejectUnexpectedValues(action, grouped);
  }
  if (action === "search") return normalizeSearchValues(grouped);
  return normalizeMutationValues(grouped, formFields, submittedFields, form);
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
    values.q = boundedSearchQuery(normalizeScalarValue(key, repeated));
  }
  return values;
}

function boundedSearchQuery(value: CapabilityInputValue): CapabilityInputValue {
  if (typeof value !== "string") return value;
  if (value.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new WireProtocolError(
      `A search may be at most ${MAX_SEARCH_QUERY_LENGTH} characters; this one is ${value.length}.`,
    );
  }
  // Counted the way the generated SQL splits it, so the bound is the bound on the work.
  const terms = value.split(/\s+/).filter((term) => term.length > 0);
  if (terms.length > MAX_SEARCH_TERMS) {
    throw new WireProtocolError(
      `A search may carry at most ${MAX_SEARCH_TERMS} terms; this one carries ${terms.length}.`,
    );
  }
  return value;
}

function normalizeMutationValues(
  grouped: ReadonlyMap<string, readonly string[]>,
  formFields: readonly SpecField[],
  submittedFields: ReadonlySet<string>,
  form: CapabilitySpec["ui_intent"]["form"],
): Record<string, CapabilityInputValue> {
  const formByName = new Map(formFields.map((field) => [field.name, field]));
  const values: Record<string, CapabilityInputValue> = {};

  for (const [key, repeated] of grouped) {
    const field = formByName.get(key);
    validateMutationValueKey(key, field, submittedFields);
    values[key] = normalizeRepeatedValue(key, repeated, field, form);
  }

  addSubmittedEmptyValues(values, formFields, submittedFields);
  return values;
}

function validateMutationValueKey(
  key: string,
  field: SpecField | undefined,
  submittedFields: ReadonlySet<string>,
): void {
  if (!submittedFields.has(key)) {
    throw new WireProtocolError(`Value "${key}" has no submitted field marker.`);
  }
  if (!field) throw new WireProtocolError(`Value "${key}" is not a field.`);
}

function normalizeRepeatedValue(
  key: string,
  repeated: readonly string[],
  field: SpecField | undefined,
  form: CapabilitySpec["ui_intent"]["form"],
): CapabilityInputValue {
  // A hidden list has no input mode left; its form is stale and refused once parsed.
  if (field && isListFieldType(field.type)) {
    if (field.lifecycle !== "active") return [...repeated];
    return normalizeListInputValues(listInputModeForField(form, field.name), repeated);
  }
  // A `file[]` posts one key per file, in order, kept as posted for the file rule to judge.
  if (field && isFileListFieldType(field.type)) return [...repeated];
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

/** A marked field with no value: an empty list, or a file field or `file[]` that holds nothing. */
function addSubmittedEmptyValues(
  values: Record<string, CapabilityInputValue>,
  formFields: readonly SpecField[],
  submittedFields: ReadonlySet<string>,
): void {
  for (const field of formFields) {
    if (!submittedFields.has(field.name) || Object.hasOwn(values, field.name)) continue;
    if (isListFieldType(field.type) || isFileListFieldType(field.type)) values[field.name] = [];
    else if (isFileFieldType(field.type)) values[field.name] = "";
  }
}
