// The centralized create/edit field renderer: the single platform module that renders a
// capability's fields deterministically from its spec, in the two modes there are.
//
//   • CREATE — the platform-owned <form> of input controls the "New X" button opens,
//     with its HTMX wiring and cancel/close behavior baked in.
//   • EDIT   — the same controls, prefilled, wired to update, and the surface a record
//     opens into. Read-only is not a third: the form is the only view a record has, so
//     no field is ever printed rather than filled and an absent value is an empty input.
//
// Both modes dispatch on the field-type pantry (string | number | boolean | datetime |
// date | choice | string[]) through a **total switch**, so an unhandled type cannot ship
// silently:
// a new field type extends exactly one place (the switches below), and until it does the
// type-checker refuses to build. The exhaustiveness keys on registry `FieldType`, the one
// source of truth for the pantry.
//
// Presentation only — no capability rule, no canonical state, and no user data cached in
// the module. Live values arrive at render time as function arguments, so the platform
// View stays data-free. Every interpolated field name and record value is escaped on the
// way into markup; the form itself is platform chrome rather than generated item markup,
// so the runtime allow-list enforcer never runs on it.

import { listInputModeForField } from "../list-input/index.ts";
import {
  activeSpecFields,
  type ChoiceFieldType,
  type FieldType,
  isChoiceFieldType,
  isListFieldType,
  type ListFieldType,
  type SpecField,
  type UiFormIntent,
} from "../registry/index.ts";
import {
  ALUNA_PRESENT_MARKER,
  ALUNA_RECORD_ID_MARKER,
  type WireProtocolAction,
} from "../router/wire-protocol.ts";
import { escapeHtml } from "../web/html.ts";
import { renderChoiceField } from "./choice-control.ts";

/**
 * The slice of a capability the field renderer needs: its engineering `id` (the
 * create form posts to `/capability/<id>/create` and targets its live region),
 * its user-facing `label` (the form's accessible name), and its `schema.fields`.
 * Both {@link import("../registry/index.ts").CapabilitySpec} and `CapabilityRow`
 * satisfy it structurally, so create (spec) and edit (a committed row + record)
 * share one entry point.
 */
export interface RenderableCapability {
  readonly id: string;
  readonly label: string;
  /** The singular record noun the platform's empty-state sentence is written around. */
  readonly noun: string;
  readonly schema: { readonly fields: readonly SpecField[] };
  readonly form: UiFormIntent;
  /** The committed closed Action inventory; platform chrome fails closed against it. */
  readonly actions: readonly WireProtocolAction[];
  readonly item?: { readonly shows: readonly string[] };
}

/**
 * The DOM event a successful create dispatches (bubbling) once the platform form's
 * close-on-success wiring fires. The list container listens for it to close and
 * refresh — exported so those modules key on one constant rather than re-typing
 * the string.
 */
export const RECORD_CREATED_EVENT = "aluna:record-created";

/**
 * The local DOM event the create form dispatches when its Cancel button resets the
 * draft. The owning list container listens on the nearest collection to close the
 * disclosure and restore focus to its "New X" trigger.
 */
export const CREATE_CANCELLED_EVENT = "aluna:create-cancelled";

/**
 * The id of a capability's live records region — the create form's `hx-target`,
 * rendered by the list container. Derived from the engineering id (itself
 * `[a-z][a-z0-9_]*`, so the result is a safe HTML id) so both modules agree by
 * construction rather than by a copied string literal.
 */
export function capabilityRecordsRegionId(capabilityId: string): string {
  return `${capabilityId}-records`;
}

/** The live region that receives structured create-validation feedback. */
export function capabilityCreateErrorId(capabilityId: string): string {
  return `${capabilityId}-create-error`;
}

/** The live region that receives structured update-validation feedback. */
export function capabilityEditErrorId(capabilityId: string): string {
  return `${capabilityId}-edit-error`;
}

/**
 * The live region a failed record delete is retargeted to
 * (`src/router/failure-responses.ts`). It rides the confirmation that replaces the record
 * form's action row, which is the only place a record delete is ever asked for; the id is
 * the wire contract both ends agree on.
 */
export function capabilityDeleteErrorId(capabilityId: string): string {
  return `${capabilityId}-delete-error`;
}

/**
 * The confirmation's own copy, named so both its controls are described by the sentence
 * they act on. One record view is live at a time, so one live element carries this.
 */
export function capabilityDeleteConfirmationId(capabilityId: string): string {
  return `${capabilityId}-delete-confirmation`;
}

function searchRefreshAttributes(capability: RenderableCapability): string {
  return capability.actions.includes("search")
    ? ` data-search-url="/capability/${capability.id}/search"`
    : "";
}

/**
 * Render the platform-owned create form: one input control per spec field, the
 * HTMX wiring that posts a new record and defers to the shared post-mutation
 * whole-region refresh, the close-on-success behavior (reset the form, dispatch
 * {@link RECORD_CREATED_EVENT}), and a Cancel affordance that discards the local
 * draft before asking the owning collection to close. Deterministic from the spec —
 * never generated.
 */
export function renderCreateForm(capability: RenderableCapability): string {
  const capabilityId = capability.id;
  const regionId = capabilityRecordsRegionId(capabilityId);
  const errorId = capabilityCreateErrorId(capabilityId);
  const fields = activeSpecFields(capability.schema.fields)
    .map((field) => renderCreateField(capabilityId, field, capability.form))
    .join("");
  return (
    `<form class="capability-create-form" aria-label="Add to ${escapeHtml(capability.label)}"` +
    ` hx-post="/capability/${capabilityId}/create"` +
    ` hx-swap="none"` +
    ` data-post-mutation-refresh` +
    ` data-mutation-kind="create"` +
    ` data-capability-id="${capabilityId}"` +
    ` data-records-target-id="${regionId}"` +
    ` data-read-url="/capability/${capabilityId}/read"` +
    searchRefreshAttributes(capability) +
    `>` +
    `<div id="${errorId}" class="capability-create-form__error" aria-live="polite"></div>` +
    `<div class="capability-create-form__fields">${fields}</div>` +
    `<div class="capability-create-form__actions">` +
    `<button class="btn btn--primary" type="submit">Add</button>` +
    `<button class="btn btn--outline" type="button" data-create-cancel` +
    ` @click="$el.ownerDocument.defaultView.HTMLFormElement.prototype.reset.call($el.form);` +
    ` $el.ownerDocument.getElementById('${errorId}').replaceChildren();` +
    ` $dispatch('${CREATE_CANCELLED_EVENT}')">Cancel</button>` +
    `</div>` +
    `</form>`
  );
}

/**
 * Render the platform-owned edit form for one record — the record's only view. It uses the
 * same exhaustive field dispatch and authored list-input mode contract as create, but
 * prefills active values and submits the closed update wire markers. Inactive fields,
 * `extra`, and `created_at` are never rendered; the mutation port preserves them from
 * canonical server state.
 *
 * Cancel is the record view's other exit: it leaves the record the way the back control
 * above the form does, since the window is the whole surface and there is nothing behind
 * it to click. Going back is a fresh read of the collection, so the form carries no
 * refresh wiring of its own — and no marker naming the item it came from, because the
 * record view above it is what the swap reads that from.
 *
 * The action row also carries Delete. The confirmation it opens is rendered beside this
 * form by the record view, not inside it (`record-view.ts`).
 */
export function renderEditForm(
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
): string {
  const recordId = record.id;
  if (typeof recordId !== "string" || recordId.trim() === "") {
    throw new Error("Cannot render an edit form without a nonblank record id.");
  }

  const fields = activeSpecFields(capability.schema.fields)
    .map((field) => renderEditField(capability.id, field, capability.form, record[field.name]))
    .join("");
  const errorId = capabilityEditErrorId(capability.id);
  const escapedRecordId = escapeHtml(recordId);
  const label = escapeHtml(capability.label);

  return (
    `<form class="capability-edit-form" data-record-edit-form aria-label="Edit ${label}"` +
    ` hx-post="/capability/${capability.id}/update" hx-swap="none">` +
    `<input type="hidden" name="${ALUNA_RECORD_ID_MARKER}" value="${escapedRecordId}">` +
    `<div id="${errorId}" class="capability-edit-form__error" aria-live="polite"></div>` +
    `<div class="capability-edit-form__fields">${fields}</div>` +
    `<div class="capability-edit-form__actions">` +
    `<button class="btn btn--primary" type="submit">Save</button>` +
    `<button class="btn btn--outline" type="button" data-record-cancel>Cancel</button>` +
    renderDeleteTrigger(capability) +
    `</div>` +
    `</form>`
  );
}

/**
 * The destructive action, kept away from Save and Cancel on the far side of the row
 * (`design/index.html`, "The record form"). It opens the confirmation and nothing else —
 * only the separately submitted confirmation form can invoke the server Action, so a
 * misfired press here can never destroy a record.
 *
 * A capability that cannot delete has no trigger, the way a record being created has no
 * Delete at all: there is nothing to destroy yet.
 */
function renderDeleteTrigger(capability: RenderableCapability): string {
  if (!capability.actions.includes("delete")) return "";
  return (
    `<button class="btn btn--danger capability-edit-form__delete" type="button"` +
    ` data-record-delete>Delete</button>`
  );
}

// ── Create controls ─────────────────────────────────────────────────────────

interface CreateInput {
  /** The `<input type>` the pantry type maps to. */
  readonly inputType: string;
  /** Checkbox-style types render the control before an inline label. */
  readonly inline: boolean;
  /** Extra attributes the control needs (already ` `-prefixed), e.g. `step`. */
  readonly extraAttributes: string;
  /**
   * Whether the control can be left empty — and so whether the HTML `required`
   * attribute is meaningful. Only emptyable controls carry it: a checkbox always
   * yields a definite value (checked/unchecked → true/false), so a *required*
   * boolean is already satisfied and must **not** be forced checked at create.
   */
  readonly canBeEmpty: boolean;
}

/**
 * The total dispatch from a pantry field type to its create control — the single
 * location Module 4 (list types) and Module 6 (`file`) extend. Adding a `FieldType`
 * without a case here fails the type-check (`assertNever`), so a control can never
 * be silently missing.
 */
function createInputFor(type: Exclude<FieldType, ListFieldType | ChoiceFieldType>): CreateInput {
  switch (type) {
    case "string":
      return { inputType: "text", inline: false, extraAttributes: "", canBeEmpty: true };
    case "number":
      // `step="any"` matches REAL storage — without it the control rejects decimals.
      return {
        inputType: "number",
        inline: false,
        extraAttributes: ' step="any"',
        canBeEmpty: true,
      };
    case "boolean":
      return { inputType: "checkbox", inline: true, extraAttributes: "", canBeEmpty: false };
    case "datetime":
      return { inputType: "datetime-local", inline: false, extraAttributes: "", canBeEmpty: true };
    case "date":
      // A calendar day, no time — the native date picker, distinct from datetime-local.
      return { inputType: "date", inline: false, extraAttributes: "", canBeEmpty: true };
    default:
      return assertNever(type);
  }
}

function renderCreateField(capabilityId: string, field: SpecField, form: UiFormIntent): string {
  if (isListFieldType(field.type)) return renderCreateListField(capabilityId, field, form);
  if (isChoiceFieldType(field.type)) {
    return renderChoiceField(`cap-${capabilityId}-${field.name}`, field, form, undefined);
  }

  const control = createInputFor(field.type);
  // `capabilityId` and `field.name` are both `[a-z][a-z0-9_]*` (spec-validated), so
  // this id is a safe HTML token; the label still escapes its humanized text.
  const inputId = `cap-${capabilityId}-${field.name}`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  // Only emptyable controls carry `required`; a boolean checkbox never does (see
  // CreateInput.canBeEmpty) — otherwise a required boolean would be forced checked.
  const required = field.required && control.canBeEmpty ? " required" : "";
  const presenceMarker = `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">`;

  if (control.inline) {
    return (
      `<div class="field field--inline">` +
      presenceMarker +
      `<input class="field__checkbox" id="${inputId}" type="${control.inputType}"` +
      ` name="${nameAttribute}"${required}>` +
      `<label class="field__label field__label--inline" for="${inputId}">${label}</label>` +
      `</div>`
    );
  }

  return (
    `<div class="field">` +
    presenceMarker +
    `<label class="field__label" for="${inputId}">${label}</label>` +
    `<input class="field__control" id="${inputId}" type="${control.inputType}"` +
    ` name="${nameAttribute}"${control.extraAttributes}${required}>` +
    `</div>`
  );
}

function renderEditField(
  capabilityId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  if (isListFieldType(field.type)) return renderEditListField(capabilityId, field, form, value);
  if (isChoiceFieldType(field.type)) {
    return renderChoiceField(`edit-${capabilityId}-${field.name}`, field, form, value);
  }
  if (field.type === "datetime") return renderEditDatetimeField(capabilityId, field, value);

  const control = createInputFor(field.type);
  const inputId = `edit-${capabilityId}-${field.name}`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const required = field.required && control.canBeEmpty ? " required" : "";
  const presenceMarker = `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">`;
  const checked = control.inputType === "checkbox" && value === true ? " checked" : "";
  const valueAttribute =
    control.inputType === "checkbox"
      ? ""
      : ` value="${escapeHtml(editScalarValue(field.type, value))}"`;

  if (control.inline) {
    return (
      `<div class="field field--inline">` +
      presenceMarker +
      `<input class="field__checkbox" id="${inputId}" type="${control.inputType}"` +
      ` name="${nameAttribute}"${checked}>` +
      `<label class="field__label field__label--inline" for="${inputId}">${label}</label>` +
      `</div>`
    );
  }

  return (
    `<div class="field">` +
    presenceMarker +
    `<label class="field__label" for="${inputId}">${label}</label>` +
    `<input class="field__control" id="${inputId}" type="${control.inputType}"` +
    ` name="${nameAttribute}"${control.extraAttributes}${valueAttribute}${required}>` +
    `</div>`
  );
}

/**
 * A datetime-local control cannot carry an offset or trailing Z, while canonical
 * datetime storage intentionally can. Keep the exact committed value in the named
 * hidden control and let the mutation glue update it only when the visible local
 * control actually changes. Saving an unrelated field is therefore lossless.
 */
function renderEditDatetimeField(capabilityId: string, field: SpecField, value: unknown): string {
  const inputId = `edit-${capabilityId}-${field.name}`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const exactValue = value === null || value === undefined ? "" : String(value);
  const localValue = datetimeLocalValue(exactValue);
  const required = field.required ? " required" : "";

  return (
    `<div class="field">` +
    `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">` +
    `<input type="hidden" name="${nameAttribute}" value="${escapeHtml(exactValue)}"` +
    ` data-edit-datetime-value>` +
    `<label class="field__label" for="${inputId}">${label}</label>` +
    `<input class="field__control" id="${inputId}" type="datetime-local" step="any"` +
    ` value="${escapeHtml(localValue)}" data-edit-datetime-input="${nameAttribute}"${required}>` +
    `</div>`
  );
}

function datetimeLocalValue(value: string): string {
  return /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)/.exec(value)?.[1] ?? value;
}

function editScalarValue(
  type: Exclude<FieldType, ListFieldType | ChoiceFieldType>,
  value: unknown,
): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? raw;
  return raw;
}

function renderCreateListField(capabilityId: string, field: SpecField, form: UiFormIntent): string {
  const mode = listInputModeForField(form, field.name);
  switch (mode) {
    case "comma_separated":
      return renderCommaSeparatedListField(capabilityId, field);
    case "repeatable":
      return renderRepeatableListField(capabilityId, field);
    default:
      return assertNever(mode);
  }
}

function renderEditListField(
  capabilityId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  const mode = listInputModeForField(form, field.name);
  switch (mode) {
    case "comma_separated":
      return renderEditCommaSeparatedListField(capabilityId, field, value);
    case "repeatable":
      return renderEditRepeatableListField(capabilityId, field, value);
    default:
      return assertNever(mode);
  }
}

function renderEditCommaSeparatedListField(
  capabilityId: string,
  field: SpecField,
  value: unknown,
): string {
  const inputId = `edit-${capabilityId}-${field.name}`;
  const guidanceId = `${inputId}-guidance`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const required = field.required ? " required" : "";
  const presenceMarker = `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">`;
  const values = Array.isArray(value) ? value.map(String) : [];

  return (
    `<div class="field field--list field--list-comma-separated" data-list-input-mode="comma_separated">` +
    presenceMarker +
    `<label class="field__label" for="${inputId}">${label}</label>` +
    `<input class="field__control" id="${inputId}" type="text" name="${nameAttribute}"` +
    ` aria-describedby="${guidanceId}" value="${escapeHtml(values.join(", "))}"${required}>` +
    `<p class="field__guidance" id="${guidanceId}">Separate values with commas.</p>` +
    `</div>`
  );
}

function renderEditRepeatableListField(
  capabilityId: string,
  field: SpecField,
  value: unknown,
): string {
  const inputId = `edit-${capabilityId}-${field.name}`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const presenceMarker = `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">`;
  const values = Array.isArray(value) && value.length > 0 ? value.map(String) : [""];
  const rows = values
    .map(
      (element, index) =>
        `<div class="field-list__row" data-list-field-row>` +
        `<input class="field__control" id="${inputId}-${index + 1}" type="text"` +
        ` name="${nameAttribute}" value="${escapeHtml(element)}"` +
        ` aria-label="${label} ${index + 1}">` +
        `<button class="field-list__remove" type="button" data-list-field-remove` +
        ` aria-label="Remove ${label} value ${index + 1}">Remove</button>` +
        `</div>`,
    )
    .join("");

  return (
    `<div class="field field--list field--list-repeatable" data-list-input-mode="repeatable"` +
    ` data-list-field data-list-field-label="${label}" data-list-input-id="${inputId}">` +
    presenceMarker +
    `<label class="field__label" for="${inputId}-1">${label}</label>` +
    `<div class="field-list__values" data-list-field-values>${rows}</div>` +
    `<button class="btn btn--secondary field-list__add" type="button" data-list-field-add>` +
    `Add another</button>` +
    `</div>`
  );
}

function renderCommaSeparatedListField(capabilityId: string, field: SpecField): string {
  const inputId = `cap-${capabilityId}-${field.name}`;
  const guidanceId = `${inputId}-guidance`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const required = field.required ? " required" : "";
  const presenceMarker = `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">`;

  return (
    `<div class="field field--list field--list-comma-separated" data-list-input-mode="comma_separated">` +
    presenceMarker +
    `<label class="field__label" for="${inputId}">${label}</label>` +
    `<input class="field__control" id="${inputId}" type="text" name="${nameAttribute}"` +
    ` aria-describedby="${guidanceId}"${required}>` +
    `<p class="field__guidance" id="${guidanceId}">Separate values with commas.</p>` +
    `</div>`
  );
}

function renderRepeatableListField(capabilityId: string, field: SpecField): string {
  const inputId = `cap-${capabilityId}-${field.name}`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const presenceMarker = `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">`;

  return (
    `<div class="field field--list field--list-repeatable" data-list-input-mode="repeatable"` +
    ` data-list-field data-list-field-label="${label}"` +
    ` data-list-input-id="${inputId}">` +
    presenceMarker +
    `<label class="field__label" for="${inputId}-1">${label}</label>` +
    `<div class="field-list__values" data-list-field-values>` +
    `<div class="field-list__row" data-list-field-row>` +
    `<input class="field__control" id="${inputId}-1" type="text" name="${nameAttribute}"` +
    ` aria-label="${label} 1">` +
    `<button class="field-list__remove" type="button" data-list-field-remove` +
    ` aria-label="Remove ${label} value">Remove</button>` +
    `</div></div>` +
    `<button class="btn btn--secondary field-list__add" type="button" data-list-field-add>` +
    `Add another</button>` +
    `</div>`
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Compile-time exhaustiveness guard: reached only if a `FieldType` case is unhandled. */
function assertNever(value: never): never {
  throw new Error(`Unhandled field type: ${String(value)}`);
}
