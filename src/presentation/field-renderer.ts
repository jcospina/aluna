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
  isLongTextField,
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
import {
  controlShell,
  type FieldChrome,
  fieldChrome,
  growAttributes,
  lengthAttributes,
  REQUIRED_FIELD_SENTENCE,
} from "./field-chrome.ts";

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

/**
 * The platform's own required sentence, written once per form for the client that says it.
 *
 * Every other sentence a form shows arrives from the server in the response it answers.
 * This one is said before there is a request at all — a required field is refused in the
 * browser, so the browser has to be holding the words — and putting them on the form is
 * what keeps the platform the only author of them (`public/field-errors.js`).
 */
function requiredMessageAttribute(): string {
  return ` data-required-message="${escapeHtml(REQUIRED_FIELD_SENTENCE)}"`;
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
    requiredMessageAttribute() +
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
    ` hx-post="/capability/${capability.id}/update" hx-swap="none"` +
    `${requiredMessageAttribute()}>` +
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
      // `step="any"` for the same reason `number` carries it, and the same reason the edit
      // mirror below hard-codes it: without it the control rounds to the minute and refuses
      // the seconds canonical datetime storage keeps.
      return {
        inputType: "datetime-local",
        inline: false,
        extraAttributes: ' step="any"',
        canBeEmpty: true,
      };
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
  // `capabilityId` and `field.name` are both `[a-z][a-z0-9_]*` (spec-validated), so
  // this id is a safe HTML token; the label still escapes its humanized text.
  return renderScalarField(
    `cap-${capabilityId}-${field.name}`,
    field,
    field.type,
    form,
    undefined,
    false,
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
  if (field.type === "datetime") return renderEditDatetimeField(capabilityId, field, form, value);
  return renderScalarField(
    `edit-${capabilityId}-${field.name}`,
    field,
    field.type,
    form,
    value,
    true,
  );
}

/**
 * One scalar field, in either mode. Create and edit differ only in the id prefix and in
 * whether the control opens holding something, so they share this one path rather than two
 * that have to be kept in step.
 */
function renderScalarField(
  inputId: string,
  field: SpecField,
  type: Exclude<FieldType, ListFieldType | ChoiceFieldType>,
  form: UiFormIntent,
  value: unknown,
  editing: boolean,
): string {
  const control = createInputFor(type);
  const chrome = fieldChrome(inputId, field, form, {
    emptyable: control.canBeEmpty,
    value: editing ? value : undefined,
  });
  const parts: ScalarParts = {
    label: escapeHtml(field.label),
    nameAttribute: escapeHtml(field.name),
    // Only emptyable controls carry `required`; a boolean checkbox never does (see
    // CreateInput.canBeEmpty) — otherwise a required boolean would be forced checked.
    required: field.required && control.canBeEmpty ? " required" : "",
    chrome,
    value: editing ? editScalarValue(type, value) : "",
  };

  if (control.inline) return renderInlineField(inputId, parts, editing && value === true);
  if (isLongTextField(form, field.name)) return renderLongTextControl(inputId, field, parts);
  return renderTextControl(inputId, field, control, parts, editing);
}

interface ScalarParts {
  readonly label: string;
  readonly nameAttribute: string;
  readonly required: string;
  readonly chrome: FieldChrome;
  /** The value the control opens holding, already flattened to its control spelling. */
  readonly value: string;
}

function presenceMarkerFor(nameAttribute: string): string {
  return `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">`;
}

/**
 * The boolean's checkbox, which sits before its label rather than under it. It takes no
 * shell: the shell is the well a value is typed into, and a checkbox is a mark, not a well.
 */
function renderInlineField(inputId: string, parts: ScalarParts, checked: boolean): string {
  const { label, nameAttribute, chrome } = parts;
  // `parts.required` and `chrome.labelSuffix` are both deliberately unread. A checkbox
  // always yields a definite value, so a *required* boolean is already satisfied and must
  // never be forced checked — and for the same reason "optional" says nothing true about
  // one, which is why `fieldChrome` was asked `emptyable: false` and would have returned an
  // empty suffix anyway. Stated here rather than left to depend on that.
  return (
    `<div class="field field--inline">` +
    presenceMarkerFor(nameAttribute) +
    `<input class="field__checkbox" id="${inputId}" type="checkbox"` +
    ` name="${nameAttribute}"${chrome.describedBy}${checked ? " checked" : ""}>` +
    `<label class="field__label field__label--inline caps" for="${inputId}">${label}</label>` +
    chrome.trailing +
    `</div>`
  );
}

function renderTextControl(
  inputId: string,
  field: SpecField,
  control: CreateInput,
  parts: ScalarParts,
  editing: boolean,
): string {
  const { label, nameAttribute, required, chrome, value } = parts;
  const valueAttribute = editing ? ` value="${escapeHtml(value)}"` : "";
  return (
    `<div class="field">` +
    presenceMarkerFor(nameAttribute) +
    `<label class="field__label caps" for="${inputId}">${label}${chrome.labelSuffix}</label>` +
    controlShell(
      `<input class="field__input" id="${inputId}" type="${control.inputType}"` +
        ` name="${nameAttribute}"${control.extraAttributes}${valueAttribute}` +
        `${lengthAttributes(inputId, field)}${chrome.describedBy}${required}>`,
    ) +
    chrome.trailing +
    `</div>`
  );
}

/**
 * The multi-line control, for a string field the form named in `long_text`.
 *
 * A field holding three sentences used to get the same single-line input a title does, and
 * the text scrolled sideways past a caret you could not follow. The type cannot decide
 * this — a title and three paragraphs are both a `string` — so the form declares it.
 *
 * There is no resize grip. A textarea's own grip is drawn by the operating system and
 * would be the only mark on the surface that is not ours; the field grows to fit what is
 * typed and then scrolls instead (`public/long-text-field.js`).
 */
function renderLongTextControl(inputId: string, field: SpecField, parts: ScalarParts): string {
  const { label, nameAttribute, required, chrome, value } = parts;
  return (
    `<div class="field field--long-text">` +
    presenceMarkerFor(nameAttribute) +
    `<label class="field__label caps" for="${inputId}">${label}${chrome.labelSuffix}</label>` +
    controlShell(
      `<textarea class="field__textarea" id="${inputId}" name="${nameAttribute}"` +
        `${growAttributes()}${lengthAttributes(inputId, field)}${chrome.describedBy}` +
        // The leading newline is the renderer's, not the value's. HTML drops a single
        // U+000A immediately after a `<textarea>` start tag, so a stored value that begins
        // with one would arrive a character short — the counter would disagree with the
        // sentence the server had just written beside it, and saving any other field would
        // resubmit the shortened text and quietly rewrite the record. One extra newline is
        // what the parser eats.
        `${required}>\n${escapeHtml(value)}</textarea>`,
      true,
    ) +
    chrome.trailing +
    `</div>`
  );
}

/**
 * A datetime-local control cannot carry an offset or trailing Z, while canonical
 * datetime storage intentionally can. Keep the exact committed value in the named
 * hidden control and let the mutation glue update it only when the visible local
 * control actually changes. Saving an unrelated field is therefore lossless.
 */
function renderEditDatetimeField(
  capabilityId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  const inputId = `edit-${capabilityId}-${field.name}`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const exactValue = value === null || value === undefined ? "" : String(value);
  const localValue = datetimeLocalValue(exactValue);
  const required = field.required ? " required" : "";
  const chrome = fieldChrome(inputId, field, form, { emptyable: true, value: exactValue });

  return (
    `<div class="field">` +
    `<input type="hidden" name="${ALUNA_PRESENT_MARKER}" value="${nameAttribute}">` +
    `<input type="hidden" name="${nameAttribute}" value="${escapeHtml(exactValue)}"` +
    ` data-edit-datetime-value>` +
    `<label class="field__label caps" for="${inputId}">${label}${chrome.labelSuffix}</label>` +
    controlShell(
      `<input class="field__input" id="${inputId}" type="datetime-local" step="any"` +
        ` value="${escapeHtml(localValue)}" data-edit-datetime-input="${nameAttribute}"` +
        `${chrome.describedBy}${required}>`,
    ) +
    chrome.trailing +
    `</div>`
  );
}

function datetimeLocalValue(value: string): string {
  return /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)/.exec(value)?.[1] ?? value;
}

function editScalarValue(type: FieldType, value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw = String(value);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? raw;
  return raw;
}

function renderCreateListField(capabilityId: string, field: SpecField, form: UiFormIntent): string {
  return renderListField(`cap-${capabilityId}-${field.name}`, field, form, undefined);
}

function renderEditListField(
  capabilityId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  return renderListField(`edit-${capabilityId}-${field.name}`, field, form, value);
}

function renderListField(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  const mode = listInputModeForField(form, field.name);
  switch (mode) {
    case "comma_separated":
      return renderCommaSeparatedListField(inputId, field, form, value);
    case "repeatable":
      return renderRepeatableListField(inputId, field, form, value);
    default:
      return assertNever(mode);
  }
}

/**
 * The platform's own hint about how to type a comma-separated list. It keeps an id of its
 * own rather than the guidance slot's, because a field may carry both: the declared line
 * says what the values mean and this one says how to separate them.
 */
function listHintId(inputId: string): string {
  return `${inputId}-list-hint`;
}

/**
 * The instruction a grip is described by. One per field rather than one per row: it is the
 * same sentence on every row, and repeating it would be read out again for each one.
 */
function reorderHelpId(inputId: string): string {
  return `${inputId}-reorder-help`;
}

/**
 * What a grip says it does, said once and pointed at by every row.
 *
 * The keys are named because a grab is a mode, and a mode nobody was told about is a row
 * they cannot put down. The pointer half needs no sentence — the grip's cursor is the
 * instruction, and it is the half that is already familiar.
 */
const REORDER_HELP = "Press space to pick this row up, then the arrow keys to move it.";

/**
 * Where the order is spoken as it changes.
 *
 * In the form from the start rather than written when a drag begins: a live region added and
 * filled in the same turn is a region a screen reader has not started watching, and the
 * sentence is lost. `assertive`, because it is answering a key the person just pressed and a
 * polite queue would report the move after they had made the next one.
 */
function reorderLiveRegion(): string {
  return (
    `<div class="field-list__live" role="status" aria-live="assertive" aria-atomic="true"` +
    ` data-list-field-live></div>`
  );
}

function renderCommaSeparatedListField(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  const hintId = listHintId(inputId);
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const required = field.required ? " required" : "";
  const presenceMarker = presenceMarkerFor(nameAttribute);
  const values = Array.isArray(value) ? value.map(String) : [];
  const valueAttribute = value === undefined ? "" : ` value="${escapeHtml(values.join(", "))}"`;
  const chrome = fieldChrome(inputId, field, form, {
    emptyable: true,
    extraDescribedIds: [hintId],
  });

  return (
    `<div class="field field--list field--list-comma-separated" data-list-input-mode="comma_separated">` +
    presenceMarker +
    `<label class="field__label caps" for="${inputId}">${label}${chrome.labelSuffix}</label>` +
    controlShell(
      `<input class="field__input" id="${inputId}" type="text" name="${nameAttribute}"` +
        `${valueAttribute}${chrome.describedBy}${required}>`,
    ) +
    `<p class="field__guidance" id="${hintId}">Separate values with commas.</p>` +
    chrome.trailing +
    `</div>`
  );
}

function renderRepeatableListField(
  inputId: string,
  field: SpecField,
  form: UiFormIntent,
  value: unknown,
): string {
  const hintId = listHintId(inputId);
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  const presenceMarker = presenceMarkerFor(nameAttribute);
  const values = Array.isArray(value) && value.length > 0 ? value.map(String) : [""];
  const chrome = fieldChrome(inputId, field, form, {
    emptyable: true,
    extraDescribedIds: [hintId],
  });
  const rows = values
    .map((element, index) =>
      repeatableRow(
        inputId,
        nameAttribute,
        label,
        element,
        index,
        chrome.describedBy,
        values.length,
      ),
    )
    .join("");

  return (
    `<div class="field field--list field--list-repeatable" data-list-input-mode="repeatable"` +
    ` data-list-field data-list-field-label="${label}" data-list-input-id="${inputId}"` +
    // A required list wants one nonblank row, not a filled one in every row, so no single
    // control carries the native constraint — the same shape the drawn picker is in, and
    // it takes the same answer: the field says the word and the submit handler enforces it
    // (`public/field-errors.js`).
    `${field.required ? " data-list-required" : ""}>` +
    presenceMarker +
    `<label class="field__label caps" for="${inputId}-1">${label}${chrome.labelSuffix}</label>` +
    `<div class="field-list__values" data-list-field-values>${rows}</div>` +
    `<button class="btn btn--secondary field-list__add" type="button" data-list-field-add>` +
    `Add another</button>` +
    `<p class="field__guidance" id="${hintId}">One value to a row. A comma here is data.</p>` +
    `<p class="field__guidance" id="${reorderHelpId(inputId)}">${REORDER_HELP}</p>` +
    reorderLiveRegion() +
    chrome.trailing +
    `</div>`
  );
}

/**
 * The two marks a row carries: the grip you take hold of, and the cross that takes the row
 * away. A word apiece would be two labels wide on a row that has space for none, so the
 * affordance is drawn and the accessible name says which row it belongs to — which is the
 * half that has to be spoken rather than seen.
 *
 * The grip is the six dots every sortable list is dragged by. It is the one mark here that
 * is a convention rather than a decision: a person who has moved a row anywhere else already
 * knows what it is for, and that recognition is the whole reason to draw it.
 */
const GRIP_DOTS = [
  [9, 6],
  [15, 6],
  [9, 12],
  [15, 12],
  [9, 18],
  [15, 18],
] as const;

function gripGlyph(): string {
  const dots = GRIP_DOTS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6"></circle>`).join("");
  return (
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"` +
    ` aria-hidden="true">${dots}</svg>`
  );
}

function crossGlyph(): string {
  return (
    `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"` +
    ` stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="M6 6l12 12M18 6L6 18"></path></svg>`
  );
}

/**
 * The grip a row is moved by, with a pointer or with the keyboard.
 *
 * Disabled in a list of one, because there is nowhere to move the only row there is. It is a
 * `<button>` rather than a `<div draggable>`: that is what puts it in the tab order, what
 * gives it a focus ring, and what makes space and the arrow keys reach it at all.
 */
function rowGrip(label: string, position: number, total: number, helpId: string): string {
  return (
    `<button class="field-list__grip" type="button" data-list-field-grip` +
    ` aria-label="Reorder ${label} ${position} of ${total}"` +
    ` aria-describedby="${helpId}"${total < 2 ? " disabled" : ""}>` +
    `${gripGlyph()}</button>`
  );
}

/**
 * One row of a repeatable list.
 *
 * The field's description rides every row rather than the field, because a repeatable list
 * has no single control to hang it on — what a screen reader reaches is a row's input, and a
 * hint referenced by nothing is the visual-only text this module exists not to emit. It
 * survives an added row for free: `addListRow` clones a row wholesale, and `syncListRows`
 * restates only the names that are positional.
 *
 * Order is the value here — every row posts under the same name and the wire keeps the order
 * they arrive in — so a row can be moved, and moving it may not require a drag. It is
 * dragged by the grip, and the same grip picks it up for the keyboard.
 */
function repeatableRow(
  inputId: string,
  nameAttribute: string,
  label: string,
  element: string,
  index: number,
  describedBy: string,
  total: number,
): string {
  const position = index + 1;
  return (
    `<div class="field-list__row" data-list-field-row>` +
    rowGrip(label, position, total, reorderHelpId(inputId)) +
    controlShell(
      `<input class="field__input" id="${inputId}-${position}" type="text"` +
        ` name="${nameAttribute}" value="${escapeHtml(element)}"` +
        ` aria-label="${label} ${position}"${describedBy}>`,
    ) +
    `<button class="btn btn--outline btn--sm field-list__action" type="button"` +
    ` data-list-field-remove aria-label="Remove ${label} value ${position}">` +
    `${crossGlyph()}</button>` +
    `</div>`
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Compile-time exhaustiveness guard: reached only if a `FieldType` case is unhandled. */
function assertNever(value: never): never {
  throw new Error(`Unhandled field type: ${String(value)}`);
}
