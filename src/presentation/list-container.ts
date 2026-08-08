// The platform list scaffolding and accessible item wrapper: the structural chrome a
// capability's records land in. Platform-owned and presentational only — no capability
// rule, no canonical state.
//
// The wrapper is platform chrome, not generated markup, so the runtime allow-list
// enforcer never runs on it — its `role`/`tabindex`/`data-item` are platform-authored
// and trusted. The enforcer runs on the *inner* markup an item renderer emits, applied
// by the presentation adapter before it reaches this wrapper. renderItemWrapper frames
// already-safe markup; it does not re-parse or sanitize.
//
// The container is data-free: live records arrive through the `read` action into the
// region `#<id>-records`, never baked into the chrome.

import { escapeHtml } from "../web/html.ts";
import {
  CREATE_CANCELLED_EVENT,
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
} from "./field-renderer.ts";

/**
 * The closed set of collection layouts. `table`/`masonry` are deliberately out of
 * scope: a true table dissolves the per-record creative surface. Kept as a `const`
 * tuple so a test can sweep every member and prove the map below is exhaustive.
 */
export const COLLECTION_LAYOUTS = ["feed", "grid"] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

/** The layout used when `ui_intent.collection.layout` is unset. */
export const DEFAULT_COLLECTION_LAYOUT: CollectionLayout = "feed";

/**
 * The stable class the item wrapper carries — the detail modal's click-to-open hook and
 * the item chrome's style anchor. Exported so those modules key on one constant rather
 * than a copied string.
 */
export const ITEM_TRIGGER_CLASS = "capability-item";

/**
 * The attribute the admitted client projection rides in on the wrapper. The
 * presentation adapter supplies only the record target, active fields and
 * `created_at`; server-only state never reaches this generic serializer.
 */
export const ITEM_PAYLOAD_ATTR = "data-item";

/**
 * The attribute pointing at the record's inert detail `<template>`, which the modal
 * clones on open. The click controller (public/item-detail.js) reads it as the open
 * event's `sourceId`, so the modal shows the full record through the centralized field
 * renderer even when the item truncates — no client-side field formatting, no
 * read-single route.
 */
export const ITEM_DETAIL_TEMPLATE_ATTR = "data-detail-template";

/**
 * The modal title the trigger opens with — the capability label. Read by the click
 * controller and set via `textContent`, so it can never inject markup.
 */
export const ITEM_DETAIL_TITLE_ATTR = "data-detail-title";

/**
 * What the wrapper needs to open one record's detail. This is the platform-owned open
 * target the click controller reads; the model never authors modal wiring.
 */
export interface ItemDetailRef {
  /** The `<template>` id to clone on open. The caller owns making it unique and
   *  DOM-safe (in practice `detail-<capabilityId>-<recordId>`). */
  readonly templateId: string;
  /** The modal title — the capability label. */
  readonly title: string;
}

/** Stable DOM id for the item paired with one inert modal template. */
export function itemElementIdForTemplate(templateId: string): string {
  return `${templateId}-item`;
}

/**
 * Map a closed {@link CollectionLayout} to its platform layout class through a total
 * switch. Reaching `default` means a layout member has no case, which fails the
 * type-check, so an unrepresented layout can never render.
 */
export function collectionLayoutClass(layout: CollectionLayout): string {
  switch (layout) {
    case "feed":
      return "capability-records--feed";
    case "grid":
      return "capability-records--grid";
    default:
      return assertNever(layout);
  }
}

/** Options for {@link renderCollection}. */
export interface CollectionOptions {
  /** The capability whose list this is — supplies the id (region + form target) and label. */
  readonly capability: RenderableCapability;
  /** Which closed layout to arrange records in. Defaults to {@link DEFAULT_COLLECTION_LAYOUT}. */
  readonly layout?: CollectionLayout;
  /**
   * Pre-rendered wrapped items to seed the records region with. Empty (the default)
   * leaves the region childless, so the empty state shows via CSS `:empty`. Mutually
   * exclusive with {@link loadThroughRead}.
   */
  readonly items?: string;
  /**
   * Wire the records region to lazy-load through the capability's `read` action instead
   * of seeding {@link items}. This is what keeps the platform View data-free: the chrome
   * renders deterministically from the spec and htmx fetches the records afterward.
   */
  readonly loadThroughRead?: boolean;
}

/** Debounce used by the platform-owned collection search controller. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * The local, ephemeral search controls paired with one records region. Matching is the
 * generated `search` Handler's responsibility; this chrome owns only request timing and
 * the loading/clear/no-match presentation states.
 */
function renderSearchChrome(capability: RenderableCapability, regionId: string): string {
  // Defensive: never advertise a route the View does not declare. Every registry-backed
  // capability now carries the complete five-Action inventory, so this always renders in
  // production; the guard keeps hand-built preview Views (which may omit an Action) honest.
  if (!capability.actions.includes("search")) return "";
  const label = escapeHtml(capability.label);
  const inputId = `${capability.id}-search`;

  return (
    `<form class="capability-search" role="search" data-capability-search` +
    ` data-search-state="idle" data-records-region-id="${regionId}"` +
    ` data-read-url="/capability/${capability.id}/read"` +
    ` data-search-url="/capability/${capability.id}/search"` +
    ` data-search-debounce-ms="${SEARCH_DEBOUNCE_MS}">` +
    `<div class="capability-search__control">` +
    `<svg class="capability-search__icon" viewBox="0 0 24 24" fill="none"` +
    ` stroke="currentColor" stroke-width="2" stroke-linecap="round"` +
    ` stroke-linejoin="round" aria-hidden="true">` +
    `<circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>` +
    `<input class="capability-search__input" id="${inputId}" type="search" name="q"` +
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
 * Render a capability's list scaffolding: the "New X" disclosure, the records region in
 * the chosen layout, and the empty state. Deterministic from the capability — never
 * generated.
 *
 * The records region carries `id="<id>-records"` ({@link capabilityRecordsRegionId}), so
 * the create form's `hx-target` and the empty-state CSS agree with it by construction.
 * The disclosure closes itself when a create succeeds for *this* capability, or when its
 * form dispatches {@link CREATE_CANCELLED_EVENT}.
 */
export function renderCollection(options: CollectionOptions): string {
  const { capability } = options;
  const layout = options.layout ?? DEFAULT_COLLECTION_LAYOUT;
  const regionId = capabilityRecordsRegionId(capability.id);
  const layoutClass = collectionLayoutClass(layout);
  const label = escapeHtml(capability.label);
  const items = options.items ?? "";
  // `capability.id` is spec-validated `[a-z][a-z0-9_]*`, so it is a safe attribute value.
  const recordsLoad = options.loadThroughRead
    ? ` hx-get="/capability/${capability.id}/read" hx-trigger="load" hx-swap="innerHTML"`
    : "";
  const recordsContent = options.loadThroughRead ? "" : items;

  // Local presentation state only. `capability.id` is spec-validated `[a-z][a-z0-9_]*`,
  // so it cannot break out of the single-quoted Alpine expression. The event name is
  // all-lowercase because HTML folds attribute names, so the `@….window` listener still
  // matches the dispatched event.
  const closeOnCreated = `if ($event.detail?.capabilityId === '${capability.id}') createOpen = false`;
  const closeOnCancelled = `createOpen = false; $nextTick(() => $refs.createTrigger.focus())`;

  return (
    `<section class="capability-collection" aria-label="${label}"` +
    (capability.actions.includes("search") ? ` data-search-state="idle"` : "") +
    ` x-data="{ createOpen: false }" @${RECORD_CREATED_EVENT}.window="${closeOnCreated}"` +
    ` @${CREATE_CANCELLED_EVENT}="${closeOnCancelled}">` +
    `<header class="capability-collection__header">` +
    renderSearchChrome(capability, regionId) +
    `<button type="button" class="btn btn--primary capability-collection__new"` +
    ` x-ref="createTrigger"` +
    ` @click="createOpen = !createOpen" :aria-expanded="createOpen ? 'true' : 'false'">` +
    `New ${label}</button>` +
    `</header>` +
    renderSearchFeedback(capability) +
    `<div class="capability-collection__create" x-show="createOpen" x-cloak>${renderCreateForm(capability)}</div>` +
    // No whitespace inside the region: it must stay truly `:empty` so the empty-state
    // CSS fires, and so the first prepended record clears it.
    `<div id="${regionId}" class="capability-records ${layoutClass}"${recordsLoad}>${recordsContent}</div>` +
    `<p class="capability-empty">Nothing here yet — add your first ${label} above.</p>` +
    `</section>`
  );
}

/**
 * Wrap one record's already-safe inner markup in the standardized accessible trigger: a
 * `role="button"` control with `aria-haspopup="dialog"` carrying the caller-supplied
 * client projection as an escaped `data-item` payload. The presentation adapter owns
 * that projection and excludes server-only canonical state before calling this.
 *
 * Given an {@link ItemDetailRef} it also carries the two hooks the click controller reads
 * to open the shared read-only detail modal prefilled with this record. `detail` is
 * optional so the frame alone can render without click-to-open; the real read path always
 * passes it.
 *
 * `innerHtml` is trusted — the presentation adapter has already run it through the
 * runtime enforcer. This function frames it; it does not sanitize.
 */
export function renderItemWrapper(
  innerHtml: string,
  record: Readonly<Record<string, unknown>>,
  detail?: ItemDetailRef,
): string {
  const payload = escapeHtml(serializeItemPayload(record));
  const itemId = detail ? ` id="${escapeHtml(itemElementIdForTemplate(detail.templateId))}"` : "";
  const detailHooks = detail
    ? ` ${ITEM_DETAIL_TEMPLATE_ATTR}="${escapeHtml(detail.templateId)}"` +
      ` ${ITEM_DETAIL_TITLE_ATTR}="${escapeHtml(detail.title)}"`
    : "";
  return (
    `<article${itemId} class="${ITEM_TRIGGER_CLASS}" role="button" tabindex="0"` +
    ` aria-haspopup="dialog" ${ITEM_PAYLOAD_ATTR}="${payload}"${detailHooks}>${innerHtml}</article>`
  );
}

/**
 * Serialize a client-safe record projection for the `data-item` payload. The caller
 * HTML-escapes the JSON result for the attribute.
 *
 * A record value that is raw bytes (`Uint8Array`/`ArrayBuffer`, including Bun's `Buffer`
 * subclass) is neutralized to `null` rather than serialized: `file` fields carry a
 * reference, never bytes. It neutralizes instead of throwing so a stray value can never
 * crash a live render.
 */
export function serializeItemPayload(record: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(record, (_key, value) =>
    value instanceof Uint8Array || value instanceof ArrayBuffer ? null : value,
  );
}

/** Compile-time exhaustiveness guard: reached only if a `CollectionLayout` case is unhandled. */
function assertNever(value: never): never {
  throw new Error(`Unhandled collection layout: ${String(value)}`);
}
