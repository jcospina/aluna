// The in-window record view: the surface a record opens into, and the only one it has.
// Platform-owned and presentational only — no capability rule, no canonical state.
//
// Opening a record is an ordinary view swap. The record view takes the collection's place inside
// the window, under a back control that swaps the collection in again, so nothing opens over
// anything else and Aluna has no modal (design D2). What opens is the form, in edit mode: there
// is no read view of a record, so no field is ever printed rather than filled.
//
// Markup is here; mechanics are in `public/records/record-view.js`. Riding an inert `<template>`
// materialized beside each item rather than a route of its own is what opens the full record
// even when the item truncates. Deletion lives in that form's action row and nowhere else, so
// destroying a record starts by opening it (PLAN decision 22).

import { capabilityActionUrl } from "#shell/core/routes.js";
import { RECORD_TITLE_ATTRIBUTE } from "#shell/core/shell-dom.js";
import { ALUNA_RECORD_ID_MARKER } from "../../../runtime/router/wire/wire-protocol.ts";
import { escapeHtml } from "../../../server/http/html.ts";
import { busyLabelAttribute, DELETING_RECORD_LABEL } from "../../controls/busy-label.ts";
import {
  capabilityDeleteConfirmationId,
  capabilityDeleteErrorId,
  type RenderableCapability,
  renderEditForm,
} from "../../fields/field-renderer.ts";

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

/** The most of a title a way back names: a long first line can't push the bar off the window. */
const TITLE_MAX_CHARACTERS = 40;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `text` cut to the title's length by what a reader sees as characters, so no emoji is split. */
function clipped(text: string): string {
  const characters = [...GRAPHEMES.segment(text)].map(({ segment }) => segment);
  if (characters.length <= TITLE_MAX_CHARACTERS) return text;
  return `${characters
    .slice(0, TITLE_MAX_CHARACTERS - 1)
    .join("")
    .trimEnd()}…`;
}

/**
 * What the record's render view calls the record on its way back: the first line of its first
 * filled text field as it was saved, or its noun when it has none. Never the capability's name,
 * which the form's own way back to the collection already carries.
 */
export function recordTitle(
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
): string {
  for (const field of capability.schema.fields) {
    if (field.lifecycle !== "active" || field.type !== "string") continue;
    const value = record[field.name];
    const line = typeof value === "string" ? (value.trim().split(/\r?\n/)[0] ?? "").trim() : "";
    if (line !== "") return clipped(line);
  }
  const [first = "", ...rest] = capability.noun;
  return `${first.toUpperCase()}${rest.join("")}`;
}

/** The record title a surface carries, escaped for the attribute it rides. */
export function recordTitleAttribute(title: string): string {
  return ` ${RECORD_TITLE_ATTRIBUTE}="${escapeHtml(title)}"`;
}

/** Whether a capability has a record view at all: one that cannot update has none. */
export function hasRecordView(capability: Pick<RenderableCapability, "actions">): boolean {
  return capability.actions.includes("update");
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
  if (!hasRecordView(capability)) return "";
  const itemTargetId = escapeHtml(itemElementIdForTemplate(templateId));
  return (
    `<div class="capability-record-view" ${RECORD_VIEW_ATTR}` +
    ` data-item-target-id="${itemTargetId}"` +
    `${recordTitleAttribute(recordTitle(capability, record))}>` +
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
    ` hx-post="${capabilityActionUrl(capability.id, "delete")}" hx-swap="none">` +
    `<input type="hidden" name="${ALUNA_RECORD_ID_MARKER}"` +
    ` value="${escapeHtml(recordId)}">` +
    `<div class="capability-record-delete__copy">` +
    `<p id="${confirmationId}">Delete this record? You won’t be able to bring it back.</p>` +
    `<div id="${errorId}" class="capability-record-delete__error" aria-live="polite"></div>` +
    `</div>` +
    `<div class="capability-record-delete__actions">` +
    `<button class="btn btn--outline" type="button" data-record-cancel-delete` +
    ` aria-describedby="${confirmationId}">Cancel</button>` +
    `<button class="btn btn--danger" type="submit"${busyLabelAttribute(DELETING_RECORD_LABEL)}` +
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
