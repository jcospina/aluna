// The platform list scaffolding and item wrapper: the structural chrome a capability's
// records land in. Platform-owned and presentational only — no capability rule, no
// canonical state.
//
// A record is a `<button>`. Opening one is the only thing you can do with it, and a
// button is what the keyboard already reaches, so the wrapper carries no `role`, no
// `tabindex` and no key handling of its own (`design/design-system.md`, "The window and
// the collection").
//
// The wrapper is platform chrome, not generated markup, so the runtime allow-list
// enforcer never runs on it — its `data-item` payload is platform-authored and trusted.
// The enforcer runs on the *inner* markup an item renderer emits, applied by the
// presentation adapter before it reaches this wrapper. renderItemWrapper frames
// already-safe markup; it does not re-parse or sanitize.
//
// The container is data-free: live records arrive through the `read` action into the
// region `#<id>-records`, never baked into the chrome.

import { MAX_SEARCH_QUERY_LENGTH } from "../../runtime/data/index.ts";
import { escapeHtml } from "../../server/http/html.ts";
import {
  CREATE_CANCELLED_EVENT,
  capabilityRecordsRegionId,
  RECORD_CREATED_EVENT,
  type RenderableCapability,
  renderCreateForm,
} from "../fields/field-renderer.ts";
import { capabilityCountLabelId, renderCollectionCountLabel } from "./collection-count.ts";
import { inkSeedAttr } from "./ink-seed.ts";
import { itemElementIdForTemplate, renderRecordFormBar } from "./record-view.ts";

/**
 * The closed set of collection layouts. `table`/`masonry` are deliberately out of
 * scope: a true table dissolves the per-record creative surface. Kept as a `const`
 * tuple so a test can sweep every member and prove the map below is exhaustive.
 */
export { itemElementIdForTemplate } from "./record-view.ts";

export const COLLECTION_LAYOUTS = ["feed", "grid"] as const;
export type CollectionLayout = (typeof COLLECTION_LAYOUTS)[number];

/** The layout used when `ui_intent.collection.layout` is unset. */
export const DEFAULT_COLLECTION_LAYOUT: CollectionLayout = "feed";

/**
 * The stable class the item wrapper carries — the record swap's click-to-open hook and
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
 * The attribute pointing at the record's inert view `<template>`, which the swap clones
 * on open. The click controller (public/record-view.js) reads it, so the record's form
 * comes from the centralized field renderer even when the item truncates — no
 * client-side field formatting, no read-single route.
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
    // The browser stops the typing at the same length the wire protocol admits, so an
    // over-long search is refused where the person can see why rather than as a failed
    // request. The server's bound is the real one — it is what stands between a pasted
    // wall of text and a synchronous FFI scan that stops the event loop.
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
 * Render a capability's list scaffolding: the collection — search, the "New X" control,
 * the records region in the chosen layout and the empty state — and the create form.
 * Deterministic from the capability — never generated.
 *
 * **Two views of one surface, not a panel over a list (design D2).** Pressing "New X"
 * does not open a card above the records: it swaps the collection out and gives the
 * whole window to the form, which is the same thing opening a record does.
 * A list you can no longer see is a list the form is not competing with, and the form
 * gets the height it needs for its fields to be readable rather than a strip at the top.
 *
 * The records region carries `id="<id>-records"` ({@link capabilityRecordsRegionId}), so
 * the create form's `hx-target` and the empty-state CSS agree with it by construction. It
 * is also a content region: the read, search and refresh requests that write it are
 * released the moment its content is replaced or the region goes away.
 *
 * The form arrives under the same back control a record's does, because it is the same
 * surface reached the other way ("in a window it always arrives under a back control,
 * reached either from a record or from New record" — `design/index.html`). Cancel inside
 * the form is that exit from the other end, and both close the view the same way: a
 * create succeeds for *this* capability, or Cancel dispatches
 * {@link CREATE_CANCELLED_EVENT}. Every close gives focus back to the control that opened
 * the form, because a view swap that drops focus leaves a keyboard user at the top of the
 * desk.
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
    ? ` hx-get="/capability/${capability.id}/read" hx-trigger="load" hx-swap="innerHTML"`
    : "";
  const recordsContent = options.loadThroughRead ? "" : items;

  // Local presentation state only. `capability.id` is spec-validated `[a-z][a-z0-9_]*`,
  // so it cannot break out of the single-quoted Alpine expression. The event name is
  // all-lowercase because HTML folds attribute names, so the `@….window` listener still
  // matches the dispatched event.
  // Every way the form view closes lands focus back on the control that opened it. A
  // view swap that does not is a keyboard user dropped at the top of the desk, and the
  // successful create is the path that used to do exactly that.
  const backToTrigger = `createOpen = false; $nextTick(() => $refs.createTrigger.focus())`;
  const closeOnCreated = `if ($event.detail?.capabilityId === '${capability.id}') { ${backToTrigger} }`;
  const closeOnCancelled = backToTrigger;
  // The form takes the window, so the first field is where the user now is. Without
  // this the swap leaves focus on a control that is no longer on screen.
  //
  // `:not([type=hidden])` is the whole of why this works: every field is preceded by
  // its own hidden `__aluna_present` marker, so the first `input` in the form is one
  // that cannot be focused at all, and focusing it silently does nothing.
  //
  // The last two are the drawn choice controls, which are not form elements: a picker's
  // closed control is a `button` and a segmented row is a set of them. A capability whose
  // fields are all of that kind matched nothing here and opened onto no focus at all.
  // Kept in step with `FIRST_FIELD_SELECTOR` in `public/record-view.js`, which is the same
  // question asked of a record view.
  const firstField =
    "input:not([type=hidden]), textarea, select, .listbox__button, .segmented button:not([disabled])";
  const openCreate = `createOpen = true; $nextTick(() => $refs.createPanel.querySelector('${firstField}')?.focus())`;

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
    // How many records this holds, directly under the search rail and directly above the
    // first item. Empty in the chrome and filled from the same response the records arrive
    // in, so the number is never the chrome's own stale copy of a fact the region already
    // moved on from.
    renderCollectionCountLabel(capability) +
    // No whitespace inside the region: it must stay truly `:empty` so the empty-state
    // CSS fires, and so the first prepended record clears it.
    // The count is named as the region's description, which is what gives the label's id a
    // referent. What actually *speaks* it is the window's own content region, which is
    // `aria-live="polite"` (`public/desk-window.js`), so a changed count is announced
    // without a second live region here competing with the search's status line.
    `<div id="${regionId}" class="capability-records ${layoutClass}"` +
    ` aria-describedby="${countLabelId}"` +
    ` data-content-region="records"${recordsLoad}>${recordsContent}</div>` +
    // The search's status line sits under the records, not over them: nothing may come
    // between the count and the first record, and this line is not always silent — it
    // carries the spinner, and it is where a search that matched nothing says so. A live
    // region is announced when it changes rather than when it is reached, so reading last
    // costs a screen reader nothing.
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
 * Wrap one record's already-safe inner markup in the standardized trigger: a real
 * `<button>` carrying the caller-supplied client projection as an escaped `data-item`
 * payload. The presentation adapter owns that projection and excludes server-only
 * canonical state before calling this.
 *
 * Given an {@link ItemRecordViewRef} it also carries the hook the click controller reads
 * to swap this record's form into the window. `recordView` is optional so the frame alone
 * can render without click-to-open, and a capability that cannot be updated has no record
 * surface to open; the real read path always passes it.
 *
 * `innerHtml` is trusted — the presentation adapter has already run it through the
 * runtime enforcer. This function frames it; it does not sanitize.
 *
 * The wrapper also carries the record's drawn hand as `data-ink-seed`, derived from the
 * record's own id. That is the whole of the platform's ink work on a record: the
 * boundary itself is drawn on this wrapper, which the platform owns, so the spec, the
 * generator prompt and the registry are asked for nothing and generated markup never
 * learns the ink system exists.
 */
export function renderItemWrapper(
  innerHtml: string,
  record: Readonly<Record<string, unknown>>,
  recordView?: ItemRecordViewRef,
): string {
  const payload = escapeHtml(serializeItemPayload(record));
  const attributes = `class="${ITEM_TRIGGER_CLASS}" ${ITEM_PAYLOAD_ATTR}="${payload}"${inkSeedAttr(record.id)}`;
  // Nothing to open is not a button. Opening one is the only thing a record does, so a
  // frame with no record surface behind it is a card rather than a control that would
  // take focus and then do nothing.
  if (!recordView) return `<article ${attributes}>${innerHtml}</article>`;
  const itemId = escapeHtml(itemElementIdForTemplate(recordView.templateId));
  return (
    `<button type="button" id="${itemId}" ${attributes}` +
    ` ${ITEM_RECORD_VIEW_ATTR}="${escapeHtml(recordView.templateId)}">${innerHtml}</button>`
  );
}

/**
 * How many records a fragment actually rendered.
 *
 * This is the platform counting its own wrappers, which is the only honest way to say how
 * many a search matched: a capability's `search` Handler owns its filter, and the platform
 * cannot re-derive that number without re-running generated SQL it does not own (PLAN
 * decision 32). So the answer is not recomputed — it is read off the answer, and it equals
 * what the collection puts on screen by construction.
 *
 * Parsed rather than scanned: a record whose own text contains the class name would be
 * counted by any pass over the raw string, and record text is a string a person typed.
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
