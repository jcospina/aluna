// The platform list scaffolding and item wrapper: the structural chrome a capability's records
// land in. Platform-owned and presentational only — no capability rule, no canonical state.
//
// A record is a `<button>`. Opening one is the only thing you can do with it, and a button is
// what the keyboard already reaches, so the wrapper carries no `role`, no `tabindex` and no key
// handling of its own (`design/design-system.md`).
//
// The wrapper is platform chrome rather than generated markup, so the runtime allow-list
// enforcer never runs on it and its `data-item` payload is platform-authored. The enforcer runs
// on the inner markup an item renderer emits, applied by the presentation adapter before it
// reaches this wrapper: `renderItemWrapper` frames already-safe markup and never re-parses it.
// The container is data-free — live records arrive through the `read` action.

import { capabilityActionUrl } from "#shell/routes.js";
import {
  CREATE_CANCELLED_EVENT,
  FIRST_FIELD_SELECTOR,
  RECORD_CREATED_EVENT,
  DEFAULT_SEARCH_DEBOUNCE_MS as SEARCH_DEBOUNCE_MS,
} from "#shell/shell-dom.js";
import { assertNever } from "../../platform/errors.ts";
import { MAX_SEARCH_QUERY_LENGTH } from "../../runtime/data/index.ts";
import { escapeHtml } from "../../server/http/html.ts";
import {
  capabilityRecordsRegionId,
  type RenderableCapability,
  renderCreateForm,
} from "../fields/field-renderer.ts";
import { capabilityCountLabelId, renderCollectionCountLabel } from "./collection-count.ts";
import { inkSeedAttr } from "./ink-seed.ts";
import { itemElementIdForTemplate, renderRecordFormBar } from "./record-view.ts";

export { itemElementIdForTemplate } from "./record-view.ts";

/**
 * The closed set of collection layouts. `table`/`masonry` are out of scope: a true table
 * dissolves the per-record creative surface. A `const` tuple so a test can sweep every member.
 */
export const COLLECTION_LAYOUTS = ["feed", "grid"] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

/** The layout used when `ui_intent.collection.layout` is unset. */
export const DEFAULT_COLLECTION_LAYOUT: CollectionLayout = "feed";

/**
 * The stable class the item wrapper carries — the record swap's click-to-open hook and the item
 * chrome's style anchor. Exported so those modules key on one constant, not a copied string.
 */
export const ITEM_TRIGGER_CLASS = "capability-item";

/**
 * The attribute the admitted client projection rides in on the wrapper. The adapter supplies the
 * record target, active fields and `created_at`; server-only state never reaches the serializer.
 */
export const ITEM_PAYLOAD_ATTR = "data-item";

/**
 * The attribute pointing at the record's inert view `<template>`, which the swap clones on open.
 * The record's form comes from the field renderer: no client formatting, no read-single route.
 */
export const ITEM_RECORD_VIEW_ATTR = "data-record-view-template";

/**
 * What the wrapper needs to open one record. This is the platform-owned open target the
 * click controller reads; the model never authors the swap.
 */
export interface ItemRecordViewRef {
  /** The `<template>` id to clone on open. The caller owns making it unique and
   *  DOM-safe (in practice `record-<capabilityId>-<recordId>`). */
  readonly templateId: string;
}

/**
 * Map a closed {@link CollectionLayout} to its platform layout class through a total switch.
 * Reaching `default` fails the type-check, so an unrepresented layout can never render.
 */
export function collectionLayoutClass(layout: CollectionLayout): string {
  switch (layout) {
    case "feed":
      return "capability-records--feed";
    case "grid":
      return "capability-records--grid";
    default:
      return assertNever(layout, "collection layout");
  }
}

/** Options for {@link renderCollection}. */
export interface CollectionOptions {
  /** The capability whose list this is — supplies the id (region + form target) and label. */
  readonly capability: RenderableCapability;
  /** Which closed layout to arrange records in. Defaults to {@link DEFAULT_COLLECTION_LAYOUT}. */
  readonly layout?: CollectionLayout;
  /**
   * Pre-rendered wrapped items to seed the records region with. Empty leaves the region childless,
   * so the empty state shows via CSS `:empty`. Exclusive with {@link loadThroughRead}.
   */
  readonly items?: string;
  /**
   * Wire the records region to lazy-load through the capability's `read` action instead of seeding
   * {@link items}. The chrome renders from the spec and htmx fetches the records afterward.
   */
  readonly loadThroughRead?: boolean;
}

// The attribute the server writes is the real seam; this is the value it writes, taken from the
// controller that falls back to it when the attribute is absent.
export { DEFAULT_SEARCH_DEBOUNCE_MS as SEARCH_DEBOUNCE_MS } from "#shell/shell-dom.js";

/**
 * The local, ephemeral search controls paired with one records region. Matching belongs to the
 * generated `search` Handler; this chrome owns request timing and the presentation states.
 */
function renderSearchChrome(capability: RenderableCapability, regionId: string): string {
  // Never advertise a route the View does not declare. Every registry-backed capability carries
  // the full five-Action inventory; the guard keeps hand-built preview Views honest.
  if (!capability.actions.includes("search")) return "";
  const label = escapeHtml(capability.label);
  const inputId = `${capability.id}-search`;

  return (
    `<form class="capability-search" role="search" data-capability-search` +
    ` data-search-state="idle" data-records-region-id="${regionId}"` +
    ` data-read-url="${capabilityActionUrl(capability.id, "read")}"` +
    ` data-search-url="${capabilityActionUrl(capability.id, "search")}"` +
    ` data-search-debounce-ms="${SEARCH_DEBOUNCE_MS}">` +
    `<div class="capability-search__control">` +
    `<svg class="capability-search__icon" viewBox="0 0 24 24" fill="none"` +
    ` stroke="currentColor" stroke-width="2" stroke-linecap="round"` +
    ` stroke-linejoin="round" aria-hidden="true">` +
    `<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>` +
    `<input class="capability-search__input" id="${inputId}" type="search" name="q"` +
    // The browser stops the typing at the length the wire admits, so an over-long search is
    // refused where the person can see why. The server's bound stops a paste blocking the loop.
    ` maxlength="${MAX_SEARCH_QUERY_LENGTH}"` +
    ` placeholder="Search ${label}" autocomplete="off" spellcheck="false"` +
    ` aria-label="Search ${label}" aria-controls="${regionId}" data-capability-search-input>` +
    `<button class="capability-search__clear" type="button" data-capability-search-clear` +
    ` hidden>Clear</button>` +
    `</div>` +
    `</form>`
  );
}

function renderSearchFeedback(capability: RenderableCapability): string {
  if (!capability.actions.includes("search")) return "";
  return (
    `<div class="capability-search__feedback" aria-live="polite" aria-atomic="true">` +
    `<span class="capability-search__loading" aria-hidden="true"></span>` +
    `<span class="capability-search__status" data-capability-search-status></span>` +
    `</div>`
  );
}

/**
 * Render a capability's list scaffolding — search, New X, the records region, the empty state —
 * and the create form. Two views of one surface, not a panel over a list (design D2).
 */
export function renderCollection(options: CollectionOptions): string {
  const { capability } = options;
  const layout = options.layout ?? DEFAULT_COLLECTION_LAYOUT;
  const regionId = capabilityRecordsRegionId(capability.id);
  const countLabelId = capabilityCountLabelId(capability.id);
  const layoutClass = collectionLayoutClass(layout);
  const label = escapeHtml(capability.label);
  const items = options.items ?? "";
  // `capability.id` is spec-validated `[a-z][a-z0-9_]*`, so it is a safe attribute value.
  const recordsLoad = options.loadThroughRead
    ? ` hx-get="${capabilityActionUrl(capability.id, "read")}" hx-trigger="load" hx-swap="innerHTML"`
    : "";
  const recordsContent = options.loadThroughRead ? "" : items;

  // Every close lands focus back on the control that opened the form; a view swap that does not
  // leaves a keyboard user at the top of the desk.
  const backToTrigger = `createOpen = false; $nextTick(() => $refs.createTrigger.focus())`;
  // `capability.id` is spec-validated `[a-z][a-z0-9_]*`, so it cannot break out of the
  // single-quoted Alpine expression; the event name is lowercase because HTML folds names.
  const closeOnCreated = `if ($event.detail?.capabilityId === '${capability.id}') { ${backToTrigger} }`;
  const closeOnCancelled = backToTrigger;
  const openCreate = `createOpen = true; $nextTick(() => $refs.createPanel.querySelector('${FIRST_FIELD_SELECTOR}')?.focus())`;

  return (
    `<section class="capability-collection" aria-label="${label}"` +
    (capability.actions.includes("search") ? ` data-search-state="idle"` : "") +
    ` x-data="{ createOpen: false }" @${RECORD_CREATED_EVENT}.window="${closeOnCreated}"` +
    ` @${CREATE_CANCELLED_EVENT}="${closeOnCancelled}">` +
    `<div class="capability-collection__list" x-show="!createOpen">` +
    `<header class="capability-collection__header">` +
    renderSearchChrome(capability, regionId) +
    `<button type="button" class="btn btn--primary capability-collection__new"` +
    ` x-ref="createTrigger"` +
    ` @click="${openCreate}" :aria-expanded="createOpen ? 'true' : 'false'">` +
    `New ${label}</button>` +
    `</header>` +
    // How many records this holds, filled from the same response the records arrive in, so the
    // number is never the chrome's stale copy of a fact the region has moved on from.
    renderCollectionCountLabel(capability) +
    // No whitespace inside the region: it must stay truly `:empty` for the empty-state CSS. The
    // count is its description; the window's own `aria-live` region is what speaks it.
    `<div id="${regionId}" class="capability-records ${layoutClass}"` +
    ` aria-describedby="${countLabelId}"` +
    ` data-content-region="records"${recordsLoad}>${recordsContent}</div>` +
    // The search's status line sits under the records: nothing may come between the count and the
    // first record, and a live region is announced when it changes, not when it is reached.
    renderSearchFeedback(capability) +
    `<p class="capability-empty">Nothing here yet — add your first ${escapeHtml(capability.noun)} above.</p>` +
    `</div>` +
    `<div class="capability-collection__create" x-ref="createPanel" x-show="createOpen" x-cloak>` +
    renderRecordFormBar(capability.label, ` @click="${backToTrigger}"`) +
    renderCreateForm(capability) +
    `</div>` +
    `</section>`
  );
}

/**
 * Wrap one record's already-safe inner markup in the standardized trigger, with the client
 * projection as an escaped `data-item` payload. The caller has enforced `innerHtml`; this frames.
 */
export function renderItemWrapper(
  innerHtml: string,
  record: Readonly<Record<string, unknown>>,
  recordView?: ItemRecordViewRef,
): string {
  const payload = escapeHtml(serializeItemPayload(record));
  // `data-ink-seed` derives the record's drawn hand from its id, and the boundary is drawn on
  // this wrapper, so generated markup never learns the ink system exists.
  const attributes = `class="${ITEM_TRIGGER_CLASS}" ${ITEM_PAYLOAD_ATTR}="${payload}"${inkSeedAttr(record.id)}`;
  // Nothing to open is not a button: opening one is the only thing a record does, so a frame
  // with no record surface behind it is a card rather than a control that does nothing.
  if (!recordView) return `<article ${attributes}>${innerHtml}</article>`;
  const itemId = escapeHtml(itemElementIdForTemplate(recordView.templateId));
  return (
    `<button type="button" id="${itemId}" ${attributes}` +
    ` ${ITEM_RECORD_VIEW_ATTR}="${escapeHtml(recordView.templateId)}">${innerHtml}</button>`
  );
}

/**
 * How many records a fragment rendered: the platform counting its own wrappers, since it cannot
 * re-derive a search's filter (PLAN decision 32). Parsed, since record text can name the class.
 */
export function countRenderedItems(html: string): number {
  let items = 0;
  new HTMLRewriter()
    // Both marks, not just the class: `renderItemWrapper` always writes the two together,
    // and a Handler's own `<div class="capability-item stack">` is then not a record.
    .on(`.${ITEM_TRIGGER_CLASS}[${ITEM_PAYLOAD_ATTR}]`, {
      element() {
        items += 1;
      },
    })
    .transform(html);
  return items;
}

/**
 * Serialize a client-safe record projection for the `data-item` payload; the caller escapes the
 * JSON. Raw bytes are neutralized to `null` rather than thrown, so a stray value cannot crash.
 */
export function serializeItemPayload(record: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(record, (_key, value) =>
    value instanceof Uint8Array || value instanceof ArrayBuffer ? null : value,
  );
}
