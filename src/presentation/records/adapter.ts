// The capability-scoped presentation adapter: the one seam that turns a single record into safe,
// wrapped item HTML, and the object the router adds to every Handler's toolbox as `present`.
// Handlers call it and never import the item renderer, the enforcer or the wrapper, so create,
// read and search cannot drift apart in what they emit.
//
// The composition per record, in one place: the item renderer produces inner markup; the runtime
// enforcer runs on it, on every record, so a hostile field value can never become executable
// markup; `renderItemWrapper` frames the result; and `renderRecordViewTemplate` emits the inert
// `<template>` the swap clones, so the full record's form shows even when the card truncates.
//
// Synchronous: the enforcer parses with Bun's native HTMLRewriter and the rest is string
// composition. The router resolves the item renderer once, which is why it loads it eagerly.

import {
  type CapabilityActionRecord,
  materializeCapabilityActionRecord,
} from "../../runtime/data/index.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";
import { enforceItemMarkup } from "../safety/enforcer.ts";
import { type ItemRecordViewRef, renderItemWrapper } from "./list-container.ts";
import { renderRecordViewTemplate } from "./record-view.ts";

/**
 * A record as it reaches presentation: the spec fields plus the platform-populated `id` and
 * `created_at`, seen structurally. The adapter keys each record's view `<template>` off its `id`.
 */
export type PresentableRecord = Readonly<Record<string, unknown>>;

/**
 * The item renderer's shape: one record → the capability-specific inner markup, the single
 * generated creative surface. The adapter runs the enforcer over whatever it returns.
 */
export type ItemRenderer = (record: PresentableRecord) => string;

/**
 * The capability-scoped presentation adapter a Handler calls: record → safe wrapped item HTML.
 * Injected as `present`; the Handler maps its records through it and returns the joined result.
 */
export type PresentationAdapter = (record: CapabilityActionRecord) => string;
export type PlatformPresentationAdapter = (record: PresentableRecord) => string;

/** What {@link createPresentationAdapter} closes over: the capability (for the label,
 *  active schema-field order, and the id namespacing the record templates) and its item renderer. */
export interface PresentationAdapterOptions {
  readonly capability: RenderableCapability;
  readonly renderItem: ItemRenderer;
}

/**
 * The prefix on each record's view `<template>` id. `record-<capabilityId>-<recordId>`, so two
 * capabilities' records never collide and the click controller opens the right one.
 */
export const RECORD_TEMPLATE_ID_PREFIX = "record";

/**
 * Build the capability-scoped presentation adapter. Bind once per capability and hand the returned
 * `present` to Handlers through the toolbox. Pure: it captures the capability and adds no I/O.
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
 * Compose one record into safe wrapped item HTML, in the fixed order the platform owns. A
 * capability that cannot be updated has no record surface, so it gets neither template nor hook.
 */
function present(
  capability: RenderableCapability,
  renderItem: ItemRenderer,
  record: PresentableRecord,
): string {
  const templateId = recordTemplateId(capability.id, record);
  const recordTemplate = renderRecordViewTemplate(templateId, capability, record);
  const recordView: ItemRecordViewRef | undefined =
    recordTemplate === "" ? undefined : { templateId };

  const safeInnerHtml = enforceItemMarkup(renderItem(projectItemRecord(capability, record)));
  const item = renderItemWrapper(
    safeInnerHtml,
    projectClientRecord(capability, record),
    recordView,
  );

  return item + recordTemplate;
}

/**
 * Narrow canonical/runtime state before it enters HTML. `extra` and inactive values stay
 * server-only even if a malformed upstream row includes them.
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
 * The id linking one record's item wrapper to its view `<template>`. Coerced with `String` rather
 * than asserted, so a stray record shape can never throw mid-render; escaping keeps it inert.
 */
function recordTemplateId(capabilityId: string, record: PresentableRecord): string {
  return `${RECORD_TEMPLATE_ID_PREFIX}-${capabilityId}-${String(record.id)}`;
}
