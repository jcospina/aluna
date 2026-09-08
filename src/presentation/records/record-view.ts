// The in-window record view: the surface a record opens into, and the only one it has.
// Platform-owned and presentational only — no capability rule, no canonical state.
//
// Opening a record is an ordinary view swap. The record view takes the collection's place inside
// the window, under a back control that swaps the collection in again, so nothing opens over
// anything else and Aluna has no modal (design D2). What opens is the form, in edit mode: there
// is no read view of a record, so no field is ever printed rather than filled.
//
// Markup is here; mechanics are in `public/record-view.js`. Riding an inert `<template>`
// materialized beside each item rather than a route of its own is what opens the full record
// even when the item truncates. Deletion lives in that form's action row and nowhere else, so
// destroying a record starts by opening it (PLAN decision 22).

import { ALUNA_RECORD_ID_MARKER } from "../../runtime/router/wire/wire-protocol.ts";
import { escapeHtml } from "../../server/http/html.ts";
import {
  capabilityDeleteConfirmationId,
  capabilityDeleteErrorId,
  type RenderableCapability,
  renderEditForm,
} from "../fields/field-renderer.ts";

/** The marker the record view carries — what the mechanics swap out on the way back. */
export const RECORD_VIEW_ATTR = "data-record-view";

/** The back control's marker: navigation out of the record, above the form. */
export const RECORD_BACK_ATTR = "data-record-back";

/**
 * The bar's control, whichever way in was taken. Request feedback disables it while a mutation is
 * in flight, so leaving cannot abort a save the server may already have committed.
 */
export const RECORD_FORM_BACK_ATTR = "data-record-form-back";

/** Stable DOM id for the item paired with one inert record-view template. */
export function itemElementIdForTemplate(templateId: string): string {
  return `${templateId}-item`;
}

/**
 * The arrow beside the back control's label. Sized and stroked like the design's, and
 * `aria-hidden` because the control's label already says where back goes.
 */
const BACK_ARROW =
  `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"` +
  ` stroke-width="3" aria-hidden="true">` +
  `<path d="M14 6l-6 6 6 6" stroke-linecap="round" stroke-linejoin="round" /></svg>`;

/**
 * The bar the form arrives under, whichever way in was taken. The control names the capability it
 * goes back to, so its accessible name and its visible text agree (the label-in-name rule).
 */
export function renderRecordFormBar(label: string, controlAttributes: string): string {
  const safeLabel = escapeHtml(label);
  return (
    `<div class="capability-record-view__bar">` +
    `<button type="button" class="capability-record-view__back" ${RECORD_FORM_BACK_ATTR}` +
    `${controlAttributes} aria-label="Back to ${safeLabel}">` +
    `<span class="capability-record-view__arrow">${BACK_ARROW}</span>` +
    `<span>${safeLabel}</span>` +
    `</button>` +
    `</div>`
  );
}

/**
 * Render one record's view: the back control, then the record's form in edit mode, with the
 * deletion confirmation beside it. A capability that cannot update renders nothing at all.
 */
export function renderRecordView(
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
  templateId: string,
): string {
  if (!capability.actions.includes("update")) return "";
  const itemTargetId = escapeHtml(itemElementIdForTemplate(templateId));
  return (
    `<div class="capability-record-view" ${RECORD_VIEW_ATTR}` +
    ` data-item-target-id="${itemTargetId}">` +
    renderRecordFormBar(capability.label, ` ${RECORD_BACK_ATTR}`) +
    renderEditForm(capability, record) +
    renderDeleteConfirmation(capability, record) +
    `</div>`
  );
}

/**
 * The confirmation that replaces the form's action row in place, so nothing moves and the record
 * stays readable. The form's sibling, not its child: a form cannot nest inside another form.
 */
function renderDeleteConfirmation(
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
): string {
  if (!capability.actions.includes("delete")) return "";
  const recordId = record.id;
  if (typeof recordId !== "string" || recordId.trim() === "") {
    throw new Error("Cannot render a deletion confirmation without a nonblank record id.");
  }
  const confirmationId = capabilityDeleteConfirmationId(capability.id);
  const errorId = capabilityDeleteErrorId(capability.id);
  return (
    `<form class="capability-record-delete" data-record-delete-form hidden` +
    ` aria-describedby="${confirmationId}"` +
    ` hx-post="/capability/${capability.id}/delete" hx-swap="none">` +
    `<input type="hidden" name="${ALUNA_RECORD_ID_MARKER}"` +
    ` value="${escapeHtml(recordId)}">` +
    `<div class="capability-record-delete__copy">` +
    `<p id="${confirmationId}">Delete this record? You won’t be able to bring it back.</p>` +
    `<div id="${errorId}" class="capability-record-delete__error" aria-live="polite"></div>` +
    `</div>` +
    `<div class="capability-record-delete__actions">` +
    `<button class="btn btn--outline" type="button" data-record-cancel-delete` +
    ` aria-describedby="${confirmationId}">Cancel</button>` +
    `<button class="btn btn--danger" type="submit"` +
    ` aria-describedby="${confirmationId}">Delete record</button>` +
    `</div>` +
    `</form>`
  );
}

/**
 * Render a `<template>` carrying one record's view for the swap to clone. Its content is inert
 * until cloned, so the swap moves a DOM clone — no `innerHTML`, no server round-trip.
 */
export function renderRecordViewTemplate(
  templateId: string,
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
): string {
  const view = renderRecordView(capability, record, templateId);
  if (view === "") return "";
  return `<template id="${escapeHtml(templateId)}">${view}</template>`;
}
