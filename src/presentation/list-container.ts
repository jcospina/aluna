// The platform list scaffolding + accessible item wrapper — Module 3, epic 3.2/02
// (ADR-0005 §1 & §3, PLAN decisions 1, 3 & 5). The structural chrome a capability's
// records land in — platform-owned, presentational only: no capability rule, no
// canonical state (ADR-0005 §1).
//
//   • CONTAINER — renderCollection: the list scaffolding in one of the closed
//     `feed | grid` collection layouts (mapped to a token-consuming platform class),
//     the "New X" disclosure that opens the create form (3.2/01), and the empty state.
//   • ITEM WRAPPER — renderItemWrapper: the standardized accessible trigger each
//     rendered record is wrapped in, carrying the caller's admitted client
//     projection as an escaped `data-item` payload (`file` fields as references,
//     never bytes — ADR-0005 §3)
//     and the click-to-open affordance the shared detail modal (3.2/04) reads once
//     its click wiring lands (3.3/02).
//
// **The wrapper is platform chrome, not generated markup**, so the runtime allow-list
// enforcer (enforcer.ts) never runs on *it* — its `role`/`tabindex`/`data-item` are
// platform-authored and trusted. The enforcer runs on the *inner* markup an item
// renderer emits, applied by the presentation adapter (3.4/01) *before* it reaches this
// wrapper. renderItemWrapper takes that already-safe inner markup and frames it; it does
// not re-parse or sanitize (that is the adapter's seam, kept in one place).
//
// The container is data-free (ADR-0004 as amended by ADR-0005): live records arrive
// through the `read` action into the region `#<id>-records`, never baked into the
// chrome. renderCollection accepts pre-rendered `items` for a server-rendered / demo
// pass; the serving re-point (3.2/03) loads that region from `read` instead.
//
// Collection layout is a closed enum *here*; 3.3/01 wires it to
// `ui_intent.collection.layout`. Until then the layout defaults to `feed` (PLAN
// decision 5). An unknown layout is unrepresentable — the map is a total switch that
// fails the type-check (`assertNever`), symmetric with the field renderer's pantry
// exhaustiveness and with an unknown field type failing the build closed.

import { escapeHtml } from "../web/html.ts";
import {
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
} from "./field-renderer.ts";

/**
 * The closed set of collection layouts the list container arranges records in
 * (ADR-0005 §6). `table`/`masonry` are deliberately out of scope (deferred): a true
 * table dissolves the per-record creative surface and overlaps M5's `data_query`
 * auto-table. Kept as a `const` tuple so a test can sweep every member and prove the
 * map below is exhaustive.
 */
export const COLLECTION_LAYOUTS = ["feed", "grid"] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

/** The layout used until 3.3/01 authors `ui_intent.collection.layout` (PLAN decision 5). */
export const DEFAULT_COLLECTION_LAYOUT: CollectionLayout = "feed";

/**
 * The stable class the item wrapper carries — the click-to-open hook the detail
 * modal's wiring (3.3/02) selects on, and the item chrome's style anchor
 * (collection.css). Exported so those modules key on one constant, not a copied string.
 */
export const ITEM_TRIGGER_CLASS = "capability-item";

/**
 * The attribute the admitted client projection rides in on the wrapper — the
 * escaped `data-item` payload future edit chrome can prefill from (ADR-0005 §3).
 * The presentation adapter supplies only the record target, active fields, and
 * `created_at`; server-only state never reaches this generic serializer.
 */
export const ITEM_PAYLOAD_ATTR = "data-item";

/**
 * The attribute pointing at the record's inert detail `<template>` (the modal clones its
 * content on open — {@link import("./detail-modal.ts").renderDetailContentTemplate}). The
 * click controller (public/item-detail.js) reads it as the open event's `sourceId`, so the
 * modal shows the full record via the centralized field renderer even when the item
 * visually truncates — no client-side field formatting, no read-single route (ADR-0005 §3).
 */
export const ITEM_DETAIL_TEMPLATE_ATTR = "data-detail-template";

/**
 * The attribute carrying the modal title the trigger opens with — the capability label, so
 * the dialog announces the capability it is showing (ARCH §6.1; the shared modal's
 * `aria-labelledby` heading). Read by the click controller as the open event's `title`
 * (set via `textContent`, so it can never inject markup).
 */
export const ITEM_DETAIL_TITLE_ATTR = "data-detail-title";

/**
 * What the wrapper needs to open one record's detail: the id of its inert detail
 * `<template>` (cloned into the shared modal) and the title the modal shows. The item
 * renderer's inner markup composes the record's own fields; this is the platform-owned
 * open target the click controller (public/item-detail.js) reads — the model never
 * authors modal wiring (ADR-0005 §3).
 */
export interface ItemDetailRef {
  /** The `<template>` id to clone on open — the open event's `sourceId`. The caller owns
   *  making it unique + DOM-safe (in practice `detail-<capabilityId>-<recordId>`). */
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
 * switch. Reaching `default` means a layout member has no case — `assertNever` fails
 * the type-check, so an unrepresented layout can never render (fail-closed, ADR-0005 §6).
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
   * Pre-rendered wrapped items to seed the records region with (a server-rendered or
   * demo pass). Empty (the default) leaves the region childless, so the empty state
   * shows via CSS `:empty`. Ignored when {@link loadThroughRead} is set — the two are
   * mutually exclusive: seed the region, or wire it to load through `read`, never both.
   */
  readonly items?: string;
  /**
   * The serving mode (3.2/03): wire the records region to lazy-load its records
   * through the capability's `read` action (`hx-get="/capability/<id>/read"` on
   * `load`) instead of seeding {@link items}. This is what keeps the platform View
   * data-free (ADR-0004): the chrome renders deterministically from the spec and htmx
   * fetches the live records afterward, so no user record is ever baked into the
   * chrome. Off by default (the server-rendered / demo pass seeds `items`).
   */
  readonly loadThroughRead?: boolean;
}

/** Debounce used by the platform-owned collection search controller. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Render the local, ephemeral search controls paired with one records region.
 * Matching remains the generated `search` Handler's responsibility; this chrome only
 * owns request timing and the loading/clear/no-match presentation states.
 */
function renderSearchChrome(capability: RenderableCapability, regionId: string): string {
  // Prompt-built capabilities remain the approved two-Action shape until 4.4. Do not
  // advertise a route the committed row does not declare; every complete five-Action
  // capability gets the chrome, and 4.4 makes that the only admitted shape.
  if (capability.searchEnabled !== true) return "";
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
  if (capability.searchEnabled !== true) return "";
  return (
    `<div class="capability-search__feedback" aria-live="polite" aria-atomic="true">` +
    `<span class="capability-search__loading" aria-hidden="true"></span>` +
    `<span class="capability-search__status" data-capability-search-status></span>` +
    `</div>`
  );
}

/**
 * Render a capability's list scaffolding: the "New X" disclosure that opens the
 * platform create form (3.2/01), the records region in the chosen closed layout, and
 * the empty state. Deterministic from the capability — never generated.
 *
 * The records region carries `id="<id>-records"` ({@link capabilityRecordsRegionId}),
 * so the create form's `hx-target` and the empty-state CSS both agree with it by
 * construction. The disclosure closes itself when a create succeeds for *this*
 * capability (the bubbling {@link RECORD_CREATED_EVENT} carries `capabilityId`).
 */
export function renderCollection(options: CollectionOptions): string {
  const { capability } = options;
  const layout = options.layout ?? DEFAULT_COLLECTION_LAYOUT;
  const regionId = capabilityRecordsRegionId(capability.id);
  const layoutClass = collectionLayoutClass(layout);
  const label = escapeHtml(capability.label);
  const items = options.items ?? "";
  // The records region either lazy-loads live records through the capability's `read`
  // action (the serving path, 3.2/03) or is seeded with pre-rendered `items` (a
  // server-rendered / demo pass) — never both. Loading through `read` keeps the chrome
  // data-free (ADR-0004): htmx fetches the records after this deterministic scaffolding
  // renders, so no user record is baked in here. `capability.id` is spec-validated
  // `[a-z][a-z0-9_]*`, so it is a safe attribute value (exactly as in the create form).
  const recordsLoad = options.loadThroughRead
    ? ` hx-get="/capability/${capability.id}/read" hx-trigger="load" hx-swap="innerHTML"`
    : "";
  const recordsContent = options.loadThroughRead ? "" : items;

  // Local presentation state only (the shell "may open/prefill/focus… never infers
  // intent or mutates canonical state", ARCH §6.1). The create disclosure is an Alpine
  // toggle; it closes when THIS capability reports a created record. `capability.id` is
  // spec-validated `[a-z][a-z0-9_]*`, so it cannot break out of the single-quoted
  // Alpine expression. The event name is all-lowercase (colon + hyphens survive HTML
  // attribute-name folding), so the `@…​.window` listener matches the dispatched event.
  const closeOnCreated = `if ($event.detail?.capabilityId === '${capability.id}') createOpen = false`;

  return (
    `<section class="capability-collection" aria-label="${label}"` +
    (capability.searchEnabled === true ? ` data-search-state="idle"` : "") +
    ` x-data="{ createOpen: false }" @${RECORD_CREATED_EVENT}.window="${closeOnCreated}">` +
    `<header class="capability-collection__header">` +
    renderSearchChrome(capability, regionId) +
    `<button type="button" class="btn btn--primary capability-collection__new"` +
    ` @click="createOpen = !createOpen" :aria-expanded="createOpen ? 'true' : 'false'">` +
    `New ${label}</button>` +
    `</header>` +
    renderSearchFeedback(capability) +
    `<div class="capability-collection__create" x-show="createOpen" x-cloak>${renderCreateForm(capability)}</div>` +
    // No whitespace inside the region: an empty region must stay truly `:empty` so the
    // empty-state CSS fires (and so the first loaded/prepended record clears it). In the
    // serving mode the region starts empty and htmx fills it from `read`.
    `<div id="${regionId}" class="capability-records ${layoutClass}"${recordsLoad}>${recordsContent}</div>` +
    `<p class="capability-empty">Nothing here yet — add your first ${label} above.</p>` +
    `</section>`
  );
}

/**
 * Wrap one record's already-safe inner markup in the standardized accessible trigger.
 * The wrapper is a `role="button"` control with `aria-haspopup="dialog"` that carries the
 * caller-supplied client projection as an escaped `data-item` payload (ADR-0005
 * §3). The presentation adapter owns that projection and excludes server-only
 * canonical state before calling this framing function.
 *
 * Given a {@link ItemDetailRef} it also carries the two hooks the click controller
 * (public/item-detail.js) reads to open the shared read-only detail modal (3.2/04)
 * prefilled with this record — the click-to-open wiring (3.3/02):
 *
 *   • `data-detail-template` — the id of this record's inert detail `<template>`, which
 *     the modal clones on open (the full record via the centralized field renderer, even
 *     when the item truncates — no client-side field formatting).
 *   • `data-detail-title` — the modal title (the capability label).
 *
 * `detail` is optional so the frame alone (client payload + accessible chrome) can render
 * without click-to-open — the shape the 3.2/02 stand-in demo exercises before the modal
 * wiring. The real read path (3.4 adapter) always passes it. The model authors none of
 * this wiring (ADR-0005 §3).
 *
 * `innerHtml` is trusted: the presentation adapter (3.4/01) has already run it through
 * the runtime enforcer. This function only frames it — it does not sanitize.
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
 * Serialize a client-safe record projection for the `data-item` payload. JSON is the interchange shape the
 * modal parses back with `JSON.parse(element.dataset.item)`; the caller HTML-escapes
 * the result for the attribute. A record value that is raw bytes
 * (`Uint8Array`/`ArrayBuffer`, incl. Bun's `Buffer` subclass) is neutralized to `null`
 * rather than serialized — `file` fields carry a reference, never bytes (ADR-0005 §3,
 * ARCH §7). It only ever fires defensively today (no `file` type until M6), and it
 * neutralizes instead of throwing so a stray value can never crash a live render.
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
