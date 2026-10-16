// The capability-scoped presentation adapter: the one seam that turns a single record into safe,
// wrapped item HTML, and the object the router adds to every Handler's toolbox as `present`.
// Handlers call it and never import the item renderer, the enforcer or the wrapper, so create,
// read and search cannot drift apart in what they emit.
//
// The composition per record, in one place: the item renderer produces inner markup; the runtime
// enforcer runs on it, on every record, so a hostile field value can never become executable
// markup; it is kept inside its card, with no end tag of what it never opened and nothing left
// open;
// `renderItemWrapper` frames the result; and `renderRecordViewTemplate` emits the inert
// `<template>` the swap clones, so the full record's form shows even when the card truncates.
//
// Synchronous: the enforcer parses with Bun's native HTMLRewriter and the rest is string
// composition. The router resolves the item renderer once, which is why it loads it eagerly. The
// one read is the router's link lookup, since a Handler hands over a record's text, not its picks.

import { holdsName } from "#shell/core/same-text.js";
import { isFileFieldType } from "../../registry/index.ts";
import {
  type CapabilityActionRecord,
  materializeCapabilityActionRecord,
  storedCapabilityActionRecord,
} from "../../runtime/data/index.ts";
import { pickTargetMark } from "../controls/link/link-copy.ts";
import type { RenderableCapability } from "../fields/field-renderer.ts";
import { enforceItemMarkup } from "../safety/enforcer/enforcer.ts";
import { containedMarkup } from "../safety/markup/contained-markup.ts";
import { type ItemRecordViewRef, renderItemWrapper } from "./collection/list-container.ts";
import { renderRecordView, renderRecordViewTemplate } from "./record-view/record-view.ts";

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

/** The record each linked field of one record picked, by field. */
export type RecordLinks = (recordId: string) => ReadonlyMap<string, string>;

/** What {@link createPresentationAdapter} closes over: the capability (for the label,
 *  active schema-field order, and the id namespacing the record templates) and its item renderer. */
export interface PresentationAdapterOptions {
  readonly capability: RenderableCapability;
  readonly renderItem: ItemRenderer;
  /** What each record's Edit form says its linked fields picked; the Gate's adapter has none. */
  readonly links?: RecordLinks;
  /** Each linked field's target record noun, which its card's broken-link mark asks for. */
  readonly linkNouns?: ReadonlyMap<string, string>;
}

/**
 * The prefix on each record's view `<template>` id. `record-<capabilityId>-<recordId>`, so two
 * capabilities' records never collide and the click controller opens the right one.
 */
export const RECORD_TEMPLATE_ID_PREFIX = "record";

/**
 * Build the capability-scoped presentation adapter. Bind once per capability and hand the returned
 * `present` to Handlers through the toolbox. It reads nothing but what `links` reads.
 */
export function createPresentationAdapter(
  options: PresentationAdapterOptions,
): PresentationAdapter {
  const { capability, renderItem } = options;
  // Picks are read for a field whose relation holds: its Edit form starts on them, and its card
  // is marked without one.
  const links = (capability.linkedFields?.length ?? 0) > 0 ? options.links : undefined;
  return (record) => {
    const materialized = materializeCapabilityActionRecord(record);
    const picks = links?.(String(materialized.id));
    const stored = storedCapabilityActionRecord(record);
    const files = storedFiles(capability, stored);
    const mark = picks && linkMark(stored, picks, capability.linkedFields, options.linkNouns);
    return present(capability, renderItem, materialized, files, picks, mark);
  };
}

/**
 * The broken-link mark's name, when a field the form draws as a dropdown holds a name as stored,
 * whatever the Handler presents, and no pick: a field holding none asks for nothing, as the
 * matching scan counts it, and one whose pick stands is linked.
 */
function linkMark(
  stored: PresentableRecord,
  picks: ReadonlyMap<string, string>,
  linkedFields: readonly string[] = [],
  nouns: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  const asked = linkedFields.filter((field) => {
    const text = stored[field];
    return holdsName(text) && !picks.has(field);
  });
  if (asked.length === 0) return undefined;
  return pickTargetMark(asked.map((field) => nouns.get(field) ?? "record"));
}

/**
 * What the record's file fields hold as stored. Generated code cannot change a file, so the edit
 * form draws these whatever the Handler presented, and says it was drawn holding them.
 */
function storedFiles(
  capability: RenderableCapability,
  stored: PresentableRecord,
): PresentableRecord {
  const files = capability.schema.fields.filter((field) => isFileFieldType(field.type));
  return Object.fromEntries(files.map((field) => [field.name, stored[field.name]]));
}

/**
 * One record's view as its card's `<template>` holds it, for the record address (ADR-0010): the
 * same record, stored files and template id, so a link and a press open one markup. The address
 * draws the record as stored, which is what a press draws for a Handler presenting what it read.
 */
export function renderPresentedRecordView(
  capability: RenderableCapability,
  record: CapabilityActionRecord,
  links?: RecordLinks,
): string {
  const materialized = materializeCapabilityActionRecord(record);
  const files = storedFiles(capability, storedCapabilityActionRecord(record));
  const templateId = recordTemplateId(capability.id, materialized);
  const picks = links?.(String(materialized.id));
  return renderRecordView(capability, { ...materialized, ...files }, templateId, picks);
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
  files: PresentableRecord = {},
  picks?: ReadonlyMap<string, string>,
  mark?: string,
): string {
  const templateId = recordTemplateId(capability.id, record);
  const drawn = { ...record, ...files };
  const recordTemplate = renderRecordViewTemplate(templateId, capability, drawn, picks);
  const recordView: ItemRecordViewRef | undefined =
    recordTemplate === "" ? undefined : { templateId };

  const safeInnerHtml = containedMarkup(
    enforceItemMarkup(renderItem(projectItemRecord(capability, record))),
  );
  const item = renderItemWrapper(
    safeInnerHtml,
    projectClientRecord(capability, record),
    recordView,
    mark,
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
