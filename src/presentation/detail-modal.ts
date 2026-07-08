// The shared read-only detail modal — Module 3, epic 3.2/04 (ADR-0005 §1, §3 & §6,
// PLAN decisions 1, 3 & 7). The single platform modal every capability opens to show
// one record in full — platform-owned, presentational only: no capability rule, no
// canonical state (ADR-0005 §1). `modal: true` is never model-authored state; the
// shared modal is a fixed platform invariant (ADR-0005 §6).
//
// Two halves, split the way this repo splits every presentation module:
//
//   • MARKUP (this file) — renderDetailModal: the one shared <dialog> instance, and
//     renderDetailContent: the read-only detail body for one record, rendered through
//     the centralized field renderer (3.2/01). Pure string functions, deterministically
//     tested.
//   • MECHANICS (public/detail-modal.js) — open / close / prefill / focus-trap +
//     restore. Delegated to the native <dialog>: showModal() traps focus and restores
//     it to the trigger on close, Escape closes, and ::backdrop dims the page — the
//     browser owns the hard parts, so the controller only prefills and opens (ARCH §6.1:
//     "the shell … may open, prefill, and focus the shared modal", never infer intent).
//
// Prefill rides the escaped `data-item` payload the item wrapper already carries
// (3.2/02), so the full record shows even when the item visually truncates and **no
// read-single route is added** (ADR-0005 §3). The detail body is materialized by the
// centralized renderer at list-render time and cloned into this one modal on open;
// there is no client-side re-implementation of field formatting and no server round-trip.
//
// Field selection/order renders in **spec order** here; it defers to
// `ui_intent.detail.shows` once 3.3/01 lands, and the click-to-open wiring that reads a
// clicked item's payload into this modal is 3.3/02. Both hook the seams below
// (renderDetailContent for the body, OPEN_DETAIL_EVENT for the open call) without
// changing this module.

import { escapeHtml } from "../web/html.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { renderDetailFields } from "./field-renderer.ts";

/**
 * The id of the one shared modal instance. A single element the whole app reuses — the
 * modal is a platform invariant (ADR-0005 §6), not one-per-capability. The controller
 * (public/detail-modal.js) and the click wiring (3.3/02) find it by this id; exported so
 * every consumer keys on one constant rather than a copied string.
 */
export const DETAIL_MODAL_ID = "aluna-detail-modal";

/** The modal title element's id — the `<dialog aria-labelledby>` target, so the accessible
 *  name is the visible heading. The controller sets its text on open. */
export const DETAIL_MODAL_TITLE_ID = "aluna-detail-modal-title";

/** The modal body region's id — where the controller injects the detail content on open. */
export const DETAIL_MODAL_BODY_ID = "aluna-detail-modal-body";

/**
 * The DOM event that opens the modal — the seam between the mechanics (here) and
 * whatever triggers an open. The demo's dev trigger dispatches it; 3.3/02's item
 * click-to-open dispatches the same event after reading a clicked item's `data-item`.
 * `detail` carries `{ title, sourceId }`: the title text (set via `textContent`, so it
 * cannot inject markup) and the id of a `<template>` whose already-safe, server-rendered
 * content is cloned into the body. Exported so dispatchers and tests share one name.
 */
export const OPEN_DETAIL_EVENT = "aluna:open-detail";

/**
 * Render the one shared detail `<dialog>` instance (empty — content is prefilled on
 * open). A native modal dialog so the browser supplies the focus trap, focus restore to
 * the trigger, Escape-to-close, and the `::backdrop`; the close control is a native
 * `<form method="dialog">` submit so it closes (and restores focus) even if the
 * controller script never loads. `aria-labelledby` points at the heading, so the dialog
 * announces the capability it is showing.
 *
 * The dialog itself carries no padding: the padded `__panel` is the visible card, so a
 * click on the dialog element is a click on the `::backdrop` (outside the card) — the
 * controller uses that to dismiss. Structural, deterministic, never generated.
 */
export function renderDetailModal(): string {
  return (
    `<dialog id="${DETAIL_MODAL_ID}" class="detail-modal" aria-labelledby="${DETAIL_MODAL_TITLE_ID}">` +
    `<div class="detail-modal__panel">` +
    `<header class="detail-modal__header">` +
    `<h2 class="detail-modal__title" id="${DETAIL_MODAL_TITLE_ID}"></h2>` +
    // Native close: submitting a `method="dialog"` form closes the dialog and restores
    // focus with no JS — the guaranteed close path alongside Escape (also native).
    `<form method="dialog" class="detail-modal__dismiss">` +
    `<button type="submit" class="btn btn--ghost detail-modal__close" aria-label="Close">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"` +
    ` stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<path d="M18 6 6 18" /><path d="m6 6 12 12" />` +
    `</svg>` +
    `</button>` +
    `</form>` +
    `</header>` +
    `<div class="detail-modal__body" id="${DETAIL_MODAL_BODY_ID}"></div>` +
    `</div>` +
    `</dialog>`
  );
}

/**
 * Render the read-only detail body for one record — the modal's prefill content, produced
 * by the **centralized field renderer** (3.2/01) so the create form and the detail modal
 * can never drift and every record value is escaped exactly once, in one place.
 *
 * This is the modal module's body seam: today it renders every spec field in spec order;
 * 3.3/01 narrows/orders it by `ui_intent.detail.shows`, and M4 adds the edit affordance —
 * both extend here, not at the call sites. `record` is untrusted live data the renderer
 * escapes; this function caches nothing between renders (ADR-0004 data-free View).
 */
export function renderDetailContent(
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
): string {
  return renderDetailFields(capability, record);
}

/**
 * Render a `<template>` carrying one record's detail content for the modal to clone on
 * open. A `<template>`'s content is inert (not rendered, not scripted) until cloned, so
 * this is the safe way to materialize each record's detail alongside its item at
 * list-render time — the modal shows it with a DOM clone, never `innerHTML` from a string
 * and never a server round-trip (no read-single route, ADR-0005 §3). `id` is the
 * `sourceId` a dispatcher passes in {@link OPEN_DETAIL_EVENT}; the caller owns making it
 * unique and DOM-safe (in practice derived from the spec-validated capability id).
 */
export function renderDetailContentTemplate(
  templateId: string,
  capability: RenderableCapability,
  record: Readonly<Record<string, unknown>>,
): string {
  return `<template id="${escapeHtml(templateId)}">${renderDetailContent(capability, record)}</template>`;
}
