// The in-window record view: the surface a record opens into, and the only one it has.
// Platform-owned and presentational only — no capability rule, no canonical state.
//
// Opening a record is an ordinary view swap. The record view takes the collection's place
// inside the window, under a back control that swaps the collection in again, so nothing
// opens over anything else and Aluna has no modal (design D2, `design/design-system.md`
// "The window and the collection").
//
// What opens is the form, in edit mode. There is no read view of a record, so no field is
// ever printed rather than filled and an absent value is an empty input.
//
// The bar is shared with the create view, because the form is one surface with two ways
// in: "the form is shown here on its own so the field treatment can be read at rest. In a
// window it always arrives under a back control, reached either from a record or from New
// record" (`design/index.html`, Capability patterns).
//
// Two halves, the way this repo splits every presentation module:
//
//   • MARKUP (this file) — the back control, the record's form and the confirmation that
//     replaces the form's action row, materialized beside each item as an inert
//     `<template>` at list-render time. Pure string functions.
//   • MECHANICS (public/record-view.js) — the swap itself: clone the template, release the
//     collection's scope, put the record view in its place, and take it back out again.
//
// The form rides that inert template rather than a route of its own, so the full record
// opens even when the item truncates and there is still no read-single route.
//
// Deletion lives in that form's action row and nowhere else: pressing Delete replaces the
// row in place with the confirmation the deleted modal used to carry, so destroying a
// record starts by opening it and the collection carries no per-row delete (PLAN decision
// 22). The trigger is part of the row the field renderer draws; the confirmation is
// rendered here, beside the form, and its mechanics ride `public/record-mutations.js`
// with the other record mutations.

import { ALUNA_RECORD_ID_MARKER } from "../runtime/router/wire/wire-protocol.ts";
import { escapeHtml } from "../web/html.ts";
import {
  capabilityDeleteConfirmationId,
  capabilityDeleteErrorId,
  type RenderableCapability,
  renderEditForm,
} from "./field-renderer.ts";

/** The marker the record view carries — what the mechanics swap out on the way back. */
export const RECORD_VIEW_ATTR = "data-record-view";

/** The back control's marker: navigation out of the record, above the form. */
export const RECORD_BACK_ATTR = "data-record-back";

/**
 * The bar's control, whichever way in was taken. Request feedback disables it while a
 * mutation is in flight, so leaving cannot abort a save the server may already have
 * committed — the one thing the deleted modal's busy gate was right about.
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
 * The bar the form arrives under, whichever way in was taken. The control names the
 * capability it goes back to, so its accessible name says where back goes while its
 * visible text stays the label the design draws — and the two agree, which is what the
 * label-in-name rule asks for.
 *
 * `controlAttributes` is how the two entries differ and the only way they differ: a record
 * carries the swap's marker, the create view carries the disclosure's own handler.
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
 * Render one record's view: the back control, then the record's form in edit mode.
 *
 * `Cancel` inside the form is the same exit from the other end; both exist because the
 * window is the whole surface and there is nothing behind it to click. The form arrives
 * with the deletion confirmation beside it, hidden until its action row asks for it.
 *
 * A capability that cannot be updated has no record surface at all — there is no read
 * view to fall back on — so this renders nothing rather than an inert form, and the item
 * wrapper renders a plain card rather than a button that would do nothing.
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
 * The confirmation that replaces the form's action row in place — the copy, the live
 * region a refused delete is retargeted to, and Cancel beside Delete record. Hiding the
 * row above it is what puts this in the row's place, so nothing moves and the record stays
 * readable above the question: the shape the deleted modal had, in the container it now
 * lives in.
 *
 * It is the form's sibling rather than a child because a form cannot nest inside another
 * form and this one posts a delete of its own. That is also why it is composed here rather
 * than by the form's own renderer.
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
 * Render a `<template>` carrying one record's view for the swap to clone. A `<template>`'s
 * content is inert (not rendered, not scripted) until cloned, so this is the safe way to
 * materialize each record's form alongside its item at list-render time — the swap moves a
 * DOM clone, never `innerHTML` from a string and never a server round-trip. `id` is what
 * the item wrapper points at; the caller owns making it unique and DOM-safe (in practice
 * derived from the spec-validated capability id).
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
