// The capability-scoped presentation adapter: the one seam that turns a single record
// into safe, wrapped item HTML, and the object the router adds to every Handler's
// injected toolbox as `present`. Handlers call it; they never import the item renderer,
// the enforcer or the wrapper, and never carry their own row markup. Because create,
// read and search all render through this one adapter, their item markup cannot drift.
//
// The composition, per record, in one place:
//
//   record
//     → renderItem(record)                 the capability's item renderer: inner markup
//     → enforceItemMarkup(...)             the runtime allow-list enforcer, run on EVERY
//                                           record so a hostile field value can never
//                                           become executable markup
//     → renderItemWrapper(..., detailRef)  the accessible trigger: escaped `data-item`
//                                           payload plus click-to-open hooks
//     +  renderDetailContentTemplate(...)  the inert detail <template> the shared modal
//                                           clones on open, so the full record shows even
//                                           when the card truncates
//
// Deterministic and dependency-free: the enforcer parses with Bun's native HTMLRewriter
// and everything else is string composition, so `present` is synchronous. The item
// renderer is resolved once by the router before a Handler is handed the toolbox, which
// is why the router loads it eagerly.

import {
  type CapabilityActionRecord,
  materializeCapabilityActionRecord,
} from "../capability-data/index.ts";
import { renderDetailContentTemplate } from "./detail-modal.ts";
import { enforceItemMarkup } from "./enforcer.ts";
import type { RenderableCapability } from "./field-renderer.ts";
import { type ItemDetailRef, renderItemWrapper } from "./list-container.ts";

/**
 * A record as it reaches presentation: the spec fields plus the platform-populated
 * `id`/`created_at`, seen structurally as a plain keyed object. The adapter keys each
 * record's detail `<template>` off its `id`.
 */
export type PresentableRecord = Readonly<Record<string, unknown>>;

/**
 * The item renderer's shape: one record → the capability-specific inner markup for it.
 * This is the single generated creative surface. The renderer owns composition only —
 * the adapter runs the enforcer over whatever it returns, so a renderer that emits unsafe
 * markup cannot produce executable output through the adapter.
 */
export type ItemRenderer = (record: PresentableRecord) => string;

/**
 * The capability-scoped presentation adapter a Handler calls: record → safe wrapped item
 * HTML. Injected into the Handler toolbox as `present`; the Handler maps its records
 * through it and returns the joined result.
 */
export type PresentationAdapter = (record: CapabilityActionRecord) => string;
export type PlatformPresentationAdapter = (record: PresentableRecord) => string;

/** What {@link createPresentationAdapter} closes over: the capability (for the label,
 *  `detail.shows`, and the id namespacing the detail templates) and its item renderer. */
export interface PresentationAdapterOptions {
  readonly capability: RenderableCapability;
  readonly renderItem: ItemRenderer;
}

/**
 * The prefix on each record's detail `<template>` id. The full id is
 * `detail-<capabilityId>-<recordId>` — namespaced by capability so two capabilities'
 * records never collide, and keyed by record so the click controller opens the right one.
 */
export const DETAIL_TEMPLATE_ID_PREFIX = "detail";

/**
 * Build the capability-scoped presentation adapter. Bind once per capability and hand the
 * returned `present` to Handlers through the injected toolbox. Pure — it captures the
 * capability and renderer and adds no I/O.
 */
export function createPresentationAdapter(
  options: PresentationAdapterOptions,
): PresentationAdapter {
  const { capability, renderItem } = options;
  return (record) => present(capability, renderItem, materializeCapabilityActionRecord(record));
}

/** Platform-only presentation for synthetic previews and deterministic design probes. */
export function createPlatformPresentationAdapter(
  options: PresentationAdapterOptions,
): PlatformPresentationAdapter {
  const { capability, renderItem } = options;
  return (record) => present(capability, renderItem, record);
}

/**
 * Compose one record into safe wrapped item HTML, in the fixed order the platform owns.
 * The enforcer runs on the item renderer's output *before* it reaches the wrapper, so the
 * wrapper only ever frames already-safe markup. The item and its detail `<template>` are
 * emitted together, so a record carries its own detail with it and needs no read-single
 * route.
 */
function present(
  capability: RenderableCapability,
  renderItem: ItemRenderer,
  record: PresentableRecord,
): string {
  const templateId = detailTemplateId(capability.id, record);
  const detail: ItemDetailRef = { templateId, title: capability.label };

  const safeInnerHtml = enforceItemMarkup(renderItem(projectItemRecord(capability, record)));
  const item = renderItemWrapper(safeInnerHtml, projectClientRecord(capability, record), detail);
  const detailTemplate = renderDetailContentTemplate(templateId, capability, record);

  return item + detailTemplate;
}

/**
 * Narrow canonical/runtime state before it enters HTML. The client needs the
 * record target plus active values for detail and the future edit surface; the
 * platform timestamp is the one admitted presentational column. `extra` and
 * inactive values remain server-only even if a malformed upstream row includes
 * them.
 */
function projectClientRecord(
  capability: RenderableCapability,
  record: PresentableRecord,
): PresentableRecord {
  const names = [
    "id",
    "created_at",
    ...capability.schema.fields
      .filter((field) => field.lifecycle === "active")
      .map((field) => field.name),
  ];
  return Object.fromEntries(names.map((name) => [name, record[name]]));
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
 * The id linking one record's item wrapper to its detail `<template>`. `capabilityId` is
 * spec-validated `[a-z][a-z0-9_]*` and a data-tool id is UUID-shaped, so the result is a
 * DOM-safe id. Coerced with `String` rather than asserted so a stray record shape can
 * never throw mid-render; escaping keeps a malformed id inert either way.
 */
function detailTemplateId(capabilityId: string, record: PresentableRecord): string {
  return `${DETAIL_TEMPLATE_ID_PREFIX}-${capabilityId}-${String(record.id)}`;
}
