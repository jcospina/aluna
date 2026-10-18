// The capability-scoped presentation adapter: the one seam that turns a single record into safe,
// wrapped item HTML, and the object the router adds to every Handler's toolbox as `present`.
// Handlers call it and never import the item renderer, the enforcer or the wrapper, so create,
// read and search cannot drift apart in what they emit.
//
// The composition per record, in one place: the item renderer produces inner markup; the runtime
// enforcer runs on it, on every record, so a hostile field value can never become executable
// markup; it is kept inside its card, with no end tag of what it never opened and nothing left
// open;
// and `renderItemWrapper` frames the result as a card a press opens at its record address, whose
// route draws the full record's form even when the card truncates.
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
import { type ItemOpens, renderItemWrapper } from "./collection/list-container.ts";
import { hasRecordView, renderRecordView } from "./record-view/record-view.ts";

/**
 * A record as it reaches presentation: the spec fields plus the platform-populated `id` and
 * `created_at`, seen structurally. A card opens the record its `id` names.
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

/** What {@link createPresentationAdapter} closes over: the capability (for the label, active
 *  schema-field order, and the record address a card opens) and its item renderer. */
export interface PresentationAdapterOptions {
  readonly capability: RenderableCapability;
  readonly renderItem: ItemRenderer;
  /** What each record's linked fields picked, which its card's mark reads; the Gate's has none. */
  readonly links?: RecordLinks;
  /** Each linked field's target record noun, which its card's broken-link mark asks for. */
  readonly linkNouns?: ReadonlyMap<string, string>;
  /** Cards listed on another record, which leave the card's id to its own collection. */
  readonly listed?: boolean;
}

/**
 * Build the capability-scoped presentation adapter. Bind once per capability and hand the returned
 * `present` to Handlers through the toolbox. It reads nothing but what `links` reads.
 */
export function createPresentationAdapter(
  options: PresentationAdapterOptions,
): PresentationAdapter {
  const { capability, renderItem } = options;
  // Picks are read for a field whose relation holds: a card is marked without one.
  const links = (capability.linkedFields?.length ?? 0) > 0 ? options.links : undefined;
  return (record) => {
    const materialized = materializeCapabilityActionRecord(record);
    const picks = links?.(String(materialized.id));
    const stored = storedCapabilityActionRecord(record);
    const mark = picks && linkMark(stored, picks, capability.linkedFields, options.linkNouns);
    return present(capability, renderItem, materialized, mark, options.listed);
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
 * One record's view at its record address (ADR-0010), which a card press, a link and a pasted
 * address all open: the record as stored, with the sections of records linking here.
 */
export function renderPresentedRecordView(
  capability: RenderableCapability,
  record: CapabilityActionRecord,
  links?: RecordLinks,
  linking = "",
): string {
  const materialized = materializeCapabilityActionRecord(record);
  const files = storedFiles(capability, storedCapabilityActionRecord(record));
  const picks = links?.(String(materialized.id));
  return renderRecordView(capability, { ...materialized, ...files }, picks, linking);
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
 * capability that cannot be updated has no record surface, so its card opens nothing.
 */
function present(
  capability: RenderableCapability,
  renderItem: ItemRenderer,
  record: PresentableRecord,
  mark?: string,
  listed?: boolean,
): string {
  const opens: ItemOpens | undefined = hasRecordView(capability)
    ? { capabilityId: capability.id, listed }
    : undefined;
  const safeInnerHtml = containedMarkup(
    enforceItemMarkup(renderItem(projectItemRecord(capability, record))),
  );
  return renderItemWrapper(safeInnerHtml, projectClientRecord(capability, record), opens, mark);
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
