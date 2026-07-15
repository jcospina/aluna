// The capability-scoped presentation adapter — Module 3, epic 3.4/01 (ADR-0005 §2 &
// §3, PLAN decisions 2 & 3; amends ADR-0004's injected-toolbox contract). The one seam
// that turns **one record** into safe, wrapped item HTML, and the object the router adds
// to every Handler's injected toolbox as `present`. Handlers **call** it; they never
// import the item renderer, the enforcer, or the wrapper, and they never carry their own
// row markup (ADR-0004 unchanged — Handlers still import nothing). Because create, read,
// and later search all render through this one adapter, their item markup cannot drift.
//
// The composition, per record, in one place (ADR-0005 §3 — "the model owns composition
// only; not serialization, escaping, accessibility, safe insertion, or modal wiring"):
//
//   record
//     → renderItem(record)                 the capability's item renderer: inner markup
//                                           (the generated creative surface, 3.4/02; a
//                                           hand-written renderer stands in until then)
//     → enforceItemMarkup(...)             the runtime allow-list enforcer (3.1/02), run
//                                           on EVERY rendered record so a hostile field
//                                           value can never become executable markup even
//                                           after the build-time design-lint gate (3.6)
//     → renderItemWrapper(..., detailRef)  the accessible trigger (3.2/02): escaped
//                                           `data-item` payload + click-to-open hooks
//     +  renderDetailContentTemplate(...)  the inert detail <template> the shared modal
//                                           clones on open (3.2/04 + 3.3/02) — so the full
//                                           record shows even when the card truncates, with
//                                           no read-single route (ADR-0005 §3)
//
// Deterministic and dependency-free: the enforcer parses with Bun's native HTMLRewriter,
// everything else is string composition. So `present` is synchronous (record → string) —
// the item renderer is resolved once, by the router, before a Handler is ever handed the
// toolbox, which is why the router loads it eagerly (src/router/router.ts).

import { renderDetailContentTemplate } from "./detail-modal.ts";
import { enforceItemMarkup } from "./enforcer.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { type ItemDetailRef, renderItemWrapper } from "./list-container.ts";

/**
 * A record as it reaches presentation: the capability data tool's row shape — the spec
 * fields plus the platform-populated `id`/`created_at` — seen structurally as a plain
 * keyed object (the same shape {@link renderItemWrapper} and
 * {@link renderDetailContentTemplate} already speak). The adapter keys each record's
 * detail `<template>` off its `id` (see {@link detailTemplateId}).
 */
export type PresentableRecord = Readonly<Record<string, unknown>>;

/**
 * The **item renderer**'s shape: one record → the capability-specific inner markup for it,
 * as an HTML string (CONTEXT.md "Item renderer"). This is the single generated creative
 * surface (3.4/02); the adapter receives it as its composition input, so 3.4/01 is
 * verifiable now with a hand-written renderer before any generation exists. The renderer
 * owns composition only — the adapter runs the enforcer over whatever it returns, so a
 * renderer that emits unsafe markup cannot produce executable output through the adapter.
 */
export type ItemRenderer = (record: PresentableRecord) => string;

/**
 * The capability-scoped presentation adapter a Handler calls: record → safe wrapped item
 * HTML (the accessible item plus its inert detail `<template>`). Injected into the Handler
 * toolbox as `present`; the Handler maps its records through it and returns the joined
 * result, never touching the renderer/enforcer/wrapper itself.
 */
export type PresentationAdapter = (record: PresentableRecord) => string;

/** What {@link createPresentationAdapter} closes over: the capability (for the label,
 *  `detail.shows`, and the id namespacing the detail templates) and its item renderer. */
export interface PresentationAdapterOptions {
  readonly capability: RenderableCapability;
  readonly renderItem: ItemRenderer;
}

/**
 * The prefix on each record's detail `<template>` id. The full id is
 * `detail-<capabilityId>-<recordId>` ({@link detailTemplateId}) — namespaced by the
 * capability so two capabilities' records never collide, and keyed by the record so the
 * click controller (public/item-detail.js) opens the matching detail.
 */
export const DETAIL_TEMPLATE_ID_PREFIX = "detail";

/**
 * Build the capability-scoped presentation adapter. Bind it once per capability (the
 * router does this per request from the registry row + the loaded item renderer) and hand
 * the returned `present` to Handlers through the injected toolbox. Pure: it captures the
 * capability and renderer and adds no I/O, so it is safe to call on every rendered record.
 */
export function createPresentationAdapter(
  options: PresentationAdapterOptions,
): PresentationAdapter {
  const { capability, renderItem } = options;
  return (record) => present(capability, renderItem, record);
}

/**
 * Compose one record into safe wrapped item HTML — the whole adapter, in the fixed order
 * the platform owns. The enforcer runs on the item renderer's output *before* it reaches
 * the wrapper, so the wrapper only ever frames already-safe inner markup (its own
 * `role`/`data-item` chrome is platform-authored and trusted, never re-parsed). The item
 * and its detail `<template>` are emitted together so a created or read record carries its
 * own detail with it — the modal clones the template on open, no read-single route.
 */
function present(
  capability: RenderableCapability,
  renderItem: ItemRenderer,
  record: PresentableRecord,
): string {
  const templateId = detailTemplateId(capability.id, record);
  const detail: ItemDetailRef = { templateId, title: capability.label };

  const safeInnerHtml = enforceItemMarkup(renderItem(projectItemRecord(capability, record)));
  const item = renderItemWrapper(safeInnerHtml, record, detail);
  const detailTemplate = renderDetailContentTemplate(templateId, capability, record);

  return item + detailTemplate;
}

function projectItemRecord(
  capability: RenderableCapability,
  record: PresentableRecord,
): PresentableRecord {
  const shows =
    capability.item?.shows ??
    capability.schema.fields
      .filter((field) => field.lifecycle === "active")
      .map((field) => field.name);
  return Object.fromEntries(shows.map((name) => [name, record[name]]));
}

/**
 * The id linking one record's item wrapper to its detail `<template>` — `detail-<cap>-<id>`.
 * Records reach the adapter from the capability data tool, which always populates a unique
 * string `id` (a UUID), so this is both unique per record and stable. `capabilityId` is
 * spec-validated `[a-z][a-z0-9_]*` and a data-tool id is UUID-shaped, so the result is a
 * DOM-safe id `getElementById` resolves; both the wrapper's `data-detail-template` and the
 * `<template id>` escape it identically, so they always agree. Coerced with `String` rather
 * than asserted so a stray record shape can never throw mid-render (the enforcer's
 * neutralize-never-throw posture) — escaping keeps a malformed id inert either way.
 */
function detailTemplateId(capabilityId: string, record: PresentableRecord): string {
  return `${DETAIL_TEMPLATE_ID_PREFIX}-${capabilityId}-${String(record.id)}`;
}
