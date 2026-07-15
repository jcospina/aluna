// The centralized create/detail field renderer — Module 3, epic 3.2/01
// (ADR-0005 §1, PLAN decision 1). The single platform module that renders a
// capability's fields deterministically from its spec, in two modes:
//
//   • CREATE — the platform-owned <form> of input controls the "New X" button
//     (3.2/02) opens, with its HTMX wiring and close-on-success behavior baked in.
//   • DETAIL — the read-only label/value display the shared modal (3.2/04) shows,
//     prefilled from a record payload.
//
// Both modes dispatch on the field-type pantry (string | number | boolean |
// datetime | date) through a **total switch**, so an unhandled type cannot ship silently:
// Module 4's list types and Module 6's file types extend exactly one place (the two
// switches below), and until they do the type-checker refuses to build. The
// exhaustiveness keys on registry `FieldType`, the one source of truth for the
// pantry.
//
// Presentation only — no capability rule, no canonical state, and no user data
// cached in the module (ADR-0005 §1; ADR-0004 as amended). Live values arrive at
// render time as function arguments, so the platform View stays data-free. Every
// interpolated field name and record value is escaped on the way into markup; the
// form itself is platform chrome (not generated item markup), so the runtime
// allow-list enforcer never runs on it.

import {
  activeSpecFields,
  CREATED_AT_DESCRIPTOR,
  type FieldType,
  type PresentationFieldDescriptor,
  type SpecField,
} from "../registry/index.ts";
import { escapeHtml } from "../web/html.ts";

/**
 * The slice of a capability the field renderer needs: its engineering `id` (the
 * create form posts to `/capability/<id>/create` and targets its live region),
 * its user-facing `label` (the form's accessible name), and its `schema.fields`.
 * Both {@link import("../registry/index.ts").CapabilitySpec} and `CapabilityRow`
 * satisfy it structurally, so create (spec) and detail (a committed row + record)
 * share one entry point.
 */
export interface RenderableCapability {
  readonly id: string;
  readonly label: string;
  readonly schema: { readonly fields: readonly SpecField[] };
  readonly item?: { readonly shows: readonly string[] };
  /**
   * Which fields the read-only DETAIL surface shows, and in what order —
   * `ui_intent.detail.shows` (ADR-0005 §6). The CREATE form ignores this (it always
   * renders every field, so a record can be fully entered); only the detail body honors
   * it. Absent (a demo/test that omits it, or a pre-reshape row) → the detail falls back
   * to every field in spec order, so it still renders. Spec validation guarantees each
   * name is a real, unique `schema.fields` entry (`src/registry/spec.ts`).
   */
  readonly detail?: { readonly shows: readonly string[] };
}

/**
 * The DOM event a successful create dispatches (bubbling) once the platform form's
 * close-on-success wiring fires. The list container (3.2/02) and the shared modal
 * (3.2/04) listen for it to close and refresh — exported so those modules key on
 * one constant rather than re-typing the string.
 */
export const RECORD_CREATED_EVENT = "aluna:record-created";

/** The placeholder shown for an absent (null / undefined / empty) detail value. */
const EMPTY_VALUE = "—";

/**
 * The id of a capability's live records region — the create form's `hx-target`,
 * rendered by the list container (3.2/02). Derived from the engineering id (itself
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

/**
 * Render the platform-owned create form: one input control per spec field, the
 * HTMX wiring that posts a new record and prepends the returned item into the list
 * region, and the close-on-success behavior (reset the form, dispatch
 * {@link RECORD_CREATED_EVENT}). Deterministic from the spec — never generated.
 */
export function renderCreateForm(capability: RenderableCapability): string {
  const capabilityId = capability.id;
  const regionId = capabilityRecordsRegionId(capabilityId);
  const errorId = capabilityCreateErrorId(capabilityId);
  const fields = activeSpecFields(capability.schema.fields)
    .map((field) => renderCreateField(capabilityId, field))
    .join("");
  // Platform close-on-success: on a successful request only, clear the form for the
  // next entry and emit the bubbling event the container/modal act on. `capabilityId`
  // is `[a-z][a-z0-9_]*`, so it cannot break out of the single-quoted JS string.
  const onAfterRequest =
    `if(event.detail.successful){this.reset();` +
    `this.dispatchEvent(new CustomEvent('${RECORD_CREATED_EVENT}',` +
    `{bubbles:true,detail:{capabilityId:'${capabilityId}'}}))}`;

  return (
    `<form class="capability-create-form" aria-label="Add to ${escapeHtml(capability.label)}"` +
    ` hx-post="/capability/${capabilityId}/create"` +
    ` hx-target="#${regionId}" hx-swap="afterbegin"` +
    ` hx-on::after-request="${onAfterRequest}">` +
    `<div id="${errorId}" class="capability-create-form__error" aria-live="polite"></div>` +
    `<div class="capability-create-form__fields">${fields}</div>` +
    `<div class="capability-create-form__actions">` +
    `<button class="btn btn--primary" type="submit">Add</button>` +
    `</div>` +
    `</form>`
  );
}

/**
 * Render the read-only detail display for one record: a `<dl>` of humanized field
 * labels and formatted values, in the fields/order the capability's
 * `detail.shows` names (3.3/02; falls back to every field in spec order when
 * absent — see {@link detailFieldOrder}). The record is untrusted live data — every
 * value is escaped and an absent one shows the placeholder — so the module holds no
 * state between renders (ADR-0004).
 */
export function renderDetailFields(
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
): string {
  const rows = detailFieldOrder(capability)
    .map((field) => renderDetailField(field, record[field.name]))
    .join("");
  return `<dl class="detail-fields">${rows}</dl>`;
}

/**
 * The fields the detail body renders, in order. When the capability carries
 * `detail.shows` (ADR-0005 §6, the reshaped `ui_intent`), the detail surface shows
 * exactly those fields in that order — the model's per-capability presentation
 * choice. Otherwise it renders every field in spec order, so a demo/test that omits
 * the intent (or a pre-reshape row) still shows the whole record rather than nothing.
 *
 * Spec validation already guarantees every `shows` name is a real, unique field
 * (`src/registry/spec.ts`), so the name miss is only reachable from a hand-built
 * capability; it is skipped, and an all-miss list falls back to spec order rather
 * than rendering an empty `<dl>`.
 */
function detailFieldOrder(
  capability: RenderableCapability,
): readonly PresentationFieldDescriptor[] {
  const shows = capability.detail?.shows;
  const activeFields = activeSpecFields(capability.schema.fields);
  if (!shows || shows.length === 0) return activeFields;

  const fieldsByName = new Map(activeFields.map((field) => [field.name, field]));
  const selected = shows
    .map((name) =>
      name === CREATED_AT_DESCRIPTOR.name ? CREATED_AT_DESCRIPTOR : fieldsByName.get(name),
    )
    .filter((field) => field !== undefined);
  return selected.length > 0 ? selected : activeFields;
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
function createInputFor(type: FieldType): CreateInput {
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

function renderCreateField(capabilityId: string, field: SpecField): string {
  const control = createInputFor(field.type);
  // `capabilityId` and `field.name` are both `[a-z][a-z0-9_]*` (spec-validated), so
  // this id is a safe HTML token; the label still escapes its humanized text.
  const inputId = `cap-${capabilityId}-${field.name}`;
  const label = escapeHtml(field.label);
  const nameAttribute = escapeHtml(field.name);
  // Only emptyable controls carry `required`; a boolean checkbox never does (see
  // CreateInput.canBeEmpty) — otherwise a required boolean would be forced checked.
  const required = field.required && control.canBeEmpty ? " required" : "";

  if (control.inline) {
    return (
      `<div class="field field--inline">` +
      `<input class="field__checkbox" id="${inputId}" type="${control.inputType}"` +
      ` name="${nameAttribute}"${required}>` +
      `<label class="field__label field__label--inline" for="${inputId}">${label}</label>` +
      `</div>`
    );
  }

  return (
    `<div class="field">` +
    `<label class="field__label" for="${inputId}">${label}</label>` +
    `<input class="field__control" id="${inputId}" type="${control.inputType}"` +
    ` name="${nameAttribute}"${control.extraAttributes}${required}>` +
    `</div>`
  );
}

// ── Detail values ───────────────────────────────────────────────────────────

function renderDetailField(field: PresentationFieldDescriptor, value: unknown): string {
  const label = escapeHtml(field.label);
  const emptyModifier = isEmptyValue(value) ? " detail-field__value--empty" : "";
  const rendered = formatDetailValue(field.type, value);

  return (
    `<div class="detail-field">` +
    `<dt class="detail-field__label">${label}</dt>` +
    `<dd class="detail-field__value${emptyModifier}">${rendered}</dd>` +
    `</div>`
  );
}

/**
 * The total dispatch from a pantry field type to its read-only display — the detail
 * half of the one place Module 4/6 extend. Returns HTML-safe markup: string/number
 * are escaped text, boolean reads as Yes/No, date/datetime ride a semantic `<time>`.
 * Absent values short-circuit to the placeholder before the switch.
 */
function formatDetailValue(type: FieldType, value: unknown): string {
  if (isEmptyValue(value)) return EMPTY_VALUE;

  switch (type) {
    case "string":
      return escapeHtml(String(value));
    case "number":
      return escapeHtml(String(value));
    case "boolean":
      // Real records carry a JS boolean (the data tool normalizes 0/1 → false/true);
      // a non-boolean payload falls back to its escaped string rather than lying.
      if (value === true) return "Yes";
      if (value === false) return "No";
      return escapeHtml(String(value));
    case "datetime":
      return formatDatetime(value);
    case "date":
      return formatDate(value);
    default:
      return assertNever(type);
  }
}

/**
 * Render a stored datetime as a semantic `<time>`. The visible text is a
 * deterministic, timezone-free tidy of the ISO value (`2026-06-23T09:30:00.000Z` →
 * `2026-06-23 09:30`) so tests and output never depend on the host locale/zone; a
 * value that is not ISO-shaped shows verbatim. Both the attribute and the text are
 * escaped.
 */
function formatDatetime(value: unknown): string {
  const raw = String(value);
  const isoAttribute = escapeHtml(raw);
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(raw);
  const text = match ? `${match[1]} ${match[2]}` : isoAttribute;
  return `<time datetime="${isoAttribute}">${text}</time>`;
}

/**
 * Render a stored calendar date as a semantic `<time>` — date-only sibling of
 * {@link formatDatetime}. The `YYYY-MM-DD` ISO value shows verbatim (no timezone
 * math); a non-ISO value falls back to its escaped string. Digits/hyphens only, so
 * the visible text needs no escaping; the attribute is escaped regardless.
 */
function formatDate(value: unknown): string {
  const raw = String(value);
  const isoAttribute = escapeHtml(raw);
  const match = /^\d{4}-\d{2}-\d{2}/.exec(raw);
  const text = match?.[0] ?? isoAttribute;
  return `<time datetime="${isoAttribute}">${text}</time>`;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Absent for display purposes: null, undefined, or the empty string. `false`/`0` are values. */
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/** Compile-time exhaustiveness guard: reached only if a `FieldType` case is unhandled. */
function assertNever(value: never): never {
  throw new Error(`Unhandled field type: ${String(value)}`);
}
