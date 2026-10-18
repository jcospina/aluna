// The records linking to the record an address names. Each relation pointing in gets a section of
// the linking capability's own cards, drawn by its presentation adapter from rows its own query
// port reads, newest first as its list reads them. Each linking capability's read token is taken
// apart from the record's, so one closed by its own deletion leaves only its section out. A card
// renderer that throws, or returns after the Handler time limit as measured, leaves its section
// out too; one stuck in a loop is out of reach, as it is on a list route.

import { recordAddress } from "#shell/core/routes.js";
import { errorDetail } from "../../../../platform/errors.ts";
import { readLinkingRecords } from "../../../../platform/links/link-table.ts";
import type { PlatformDatabase } from "../../../../platform/persistence/db.ts";
import { sqlIdentifier } from "../../../../platform/persistence/sql-identifier.ts";
import {
  LISTED_AT_FIRST,
  renderableFromRow,
  renderLinkingSection,
} from "../../../../presentation/index.ts";
import {
  type CapabilityRow,
  capabilitySpecFromRow,
  holdingRelations,
  type PointingRelation,
  relationsPointingAt,
} from "../../../../registry/index.ts";
import {
  capabilityIncarnation,
  ReadGateClosingError,
  type ReadGateCoordinator,
} from "../../../concurrency/read-gates.ts";
import { createCapabilityQueryPort, deriveCapabilityTableDdl } from "../../../data/index.ts";
import { assertReadOwnership } from "../../wire/failure-responses.ts";
import {
  CapabilityHandlerTimeoutError,
  CapabilityReadAbandonedError,
  type ItemRendererLoader,
  withHandlerDeadline,
} from "../generated-code.ts";
import { buildPresentationAdapter, type DrawnRelations } from "../handler-invocation.ts";

/** What drawing the records linking here reads through. */
export interface LinkingDeps {
  readonly databases: PlatformDatabase;
  readonly readGates: ReadGateCoordinator;
  readonly loadItemRenderer: ItemRendererLoader;
  readonly handlerTimeoutMs: number;
}

/** The record whose address is drawn, on the desk its route read. */
export interface LinkedRecord {
  readonly row: CapabilityRow;
  readonly catalog: readonly CapabilityRow[];
  readonly recordId: string;
  /** The record's own read token's: once its capability closes, no section is drawn after. */
  readonly signal: AbortSignal;
  /** The request's: a reader gone away is drawn nothing more. */
  readonly abandonOn?: AbortSignal;
}

/** Where a section's cards go on from, after the last one shown: its age, then its id. */
export interface ListedAfter {
  readonly after: string;
  readonly last: string;
}

type Pointing = PointingRelation<CapabilityRow>;

/** The path segment of the fragment "Show all" fetches the rest of a section from. */
const REST_SEGMENT = "listed";

/** The route of the rest of one section, beside the record address's. */
export const LISTED_REST_PATH = `/${REST_SEGMENT}/:source/:field`;

/** Every section of records linking to the record, in the order the relations come. */
export async function drawRecordsLinkingHere(
  deps: LinkingDeps,
  linked: LinkedRecord,
): Promise<string> {
  const sections: string[] = [];
  for (const pointing of bySource(relationsPointingAt(linked.row, linked.catalog))) {
    if (stopped(linked)) break;
    const drawn = await withSourceToken(deps.readGates, linked, pointing, async (signal) => {
      const own: string[] = [];
      for (const each of pointing) own.push(await drawSection(deps, linked, each, signal));
      return own.join("");
    });
    sections.push(drawn ?? "");
  }
  return sections.join("");
}

/**
 * The cards after the last one a section showed, which "Show all" adds to it, or undefined when
 * they cannot be drawn now: no such relation, its capability closing, or its renderer failing.
 */
export async function drawListedRest(
  deps: LinkingDeps,
  linked: LinkedRecord,
  { source, field }: { readonly source: string; readonly field: string },
  start: ListedAfter,
): Promise<string | undefined> {
  const pointing = relationsPointingAt(linked.row, linked.catalog).find(
    (each) => each.source.id === source && each.relation.field === field,
  );
  if (pointing === undefined) return undefined;
  return withSourceToken(deps.readGates, linked, [pointing], async (signal) => {
    const read = () => readSection(deps, linked, pointing, signal, start, -1);
    return (await leftOutOnFailure(linked, pointing, read))?.cards;
  });
}

/** One relation's section with its first cards, or nothing when no record links here through it. */
async function drawSection(
  deps: LinkingDeps,
  linked: LinkedRecord,
  pointing: Pointing,
  signal: AbortSignal,
): Promise<string> {
  if (stopped(linked)) return "";
  const draw = async () => {
    const drawn = await readSection(deps, linked, pointing, signal, undefined, LISTED_AT_FIRST);
    if (drawn.count === 0) return "";
    const more = drawn.count > LISTED_AT_FIRST ? drawn.last : undefined;
    const section = { ...sectionHead(pointing, linked.catalog), ...drawn };
    return renderLinkingSection(
      more ? { ...section, rest: restAddress(linked, pointing, more) } : section,
    );
  };
  return (await leftOutOnFailure(linked, pointing, draw)) ?? "";
}

/** Whether the record's own capability has closed or its reader has gone. */
function stopped(linked: LinkedRecord): boolean {
  return linked.signal.aborted || linked.abandonOn?.aborted === true;
}

/** The relations pointing in, one run per linking capability, in the order they come. */
function bySource(pointing: readonly Pointing[]): Pointing[][] {
  const runs = new Map<string, Pointing[]>();
  for (const each of pointing)
    runs.set(each.source.id, [...(runs.get(each.source.id) ?? []), each]);
  return [...runs.values()];
}

/**
 * Take one linking capability's read token on its own, apart from the record's, for as long as
 * its sections take and no longer. A capability whose token cannot be taken draws nothing.
 */
async function withSourceToken<T>(
  readGates: ReadGateCoordinator,
  linked: LinkedRecord,
  [first]: readonly Pointing[],
  body: (signal: AbortSignal) => Promise<T>,
): Promise<T | undefined> {
  if (first === undefined) return undefined;
  const catalog = linked.catalog.map(capabilityIncarnation);
  const taken = readGates.tryAcquire({
    catalog,
    incarnations: [capabilityIncarnation(first.source)],
  });
  if (taken === undefined) return undefined;
  try {
    return await body(taken.signal);
  } finally {
    readGates.release(taken);
  }
}

/** Where "Show all" fetches the rest of one section, after the last card it showed. */
function restAddress(linked: LinkedRecord, { source, relation }: Pointing, start: ListedAfter) {
  const path = [REST_SEGMENT, source.id, relation.field].map(encodeURIComponent).join("/");
  const query = new URLSearchParams({ after: start.after, last: start.last });
  return `${recordAddress(linked.row.id, linked.recordId)}/${path}?${query}`;
}

/** The time after which a renderer's answer is too late. Unbounded where the limit is. */
function deadlineFrom(timeoutMs: number): number {
  const bounded = Number.isFinite(timeoutMs) && timeoutMs > 0;
  return bounded ? performance.now() + timeoutMs : Number.POSITIVE_INFINITY;
}

/** What is left of a section's time, for the wait on its renderer to load; 0 is no limit. */
function remaining(deadline: number): number {
  return Number.isFinite(deadline) ? Math.max(1, deadline - performance.now()) : 0;
}

/**
 * A section whose drawing failed is left out and the record still opens. A capability closing
 * under the read or a reader gone is expected and says nothing; anything else is worth seeing.
 */
async function leftOutOnFailure<T>(
  linked: LinkedRecord,
  { source }: Pointing,
  draw: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await draw();
  } catch (error) {
    const expected =
      error instanceof ReadGateClosingError || error instanceof CapabilityReadAbandonedError;
    if (!expected) {
      console.error(
        `Capability ${source.id}/item failed on a record of ${linked.row.id}:`,
        errorDetail(error),
      );
    }
    return undefined;
  }
}

/** One page of a section: how many records link here from its start, its cards, the last one. */
interface ReadSection {
  readonly count: number;
  readonly cards: string;
  readonly last: ListedAfter | undefined;
}

/**
 * One page of a relation's records linking here, newest first as the read contract orders a list,
 * from the newest or after the last card shown. The ids come from the link table, which no query
 * port can open; the records come through the linking capability's own port, narrowed as its list
 * is. The page has the Handler time limit, checked between cards: a renderer cannot be interrupted.
 */
async function readSection(
  deps: LinkingDeps,
  linked: LinkedRecord,
  { source, relation }: Pointing,
  signal: AbortSignal,
  start: ListedAfter | undefined,
  limit: number,
): Promise<ReadSection> {
  const deadline = deadlineFrom(deps.handlerTimeoutMs);
  const { readonly } = deps.databases;
  const linking = readLinkingRecords(
    readonly,
    { capability: source.id, field: relation.field },
    { capability: linked.row.id, incarnation: linked.row.incarnation_id, record: linked.recordId },
  );
  if (linking.length === 0) return { count: 0, cards: "", last: undefined };
  const target = capabilitySpecFromRow(source);
  const table = sqlIdentifier(deriveCapabilityTableDdl(target).tableName);
  const after = start ? ` AND ("created_at" < ? OR ("created_at" = ? AND "id" < ?))` : "";
  const rows = createCapabilityQueryPort(readonly, { target, signal }).records({
    sql:
      `SELECT "id" AS "target_id", "id" AS "last", "created_at" AS "after",` +
      ` COUNT(*) OVER () AS "count" FROM ${table}` +
      ` WHERE "id" IN (SELECT value FROM json_each(?))${after}` +
      ` ORDER BY "created_at" DESC, "id" DESC LIMIT ?`,
    parameters: [
      JSON.stringify(linking),
      ...(start ? [start.after, start.after, start.last] : []),
      limit,
    ],
    result: [
      { alias: "count", type: "number" },
      { alias: "after", type: "string" },
      { alias: "last", type: "string" },
    ],
  });
  const drawn = drawnRelations(source, linked.catalog);
  const listed = { listed: true };
  const adapter = buildPresentationAdapter(source, drawn, deps.loadItemRenderer, readonly, listed);
  // The wait ends with the section's time, or as soon as either capability closes or the reader
  // goes, and nothing generated runs for a read that has ended meanwhile.
  const ends = [signal, linked.signal, ...(linked.abandonOn ? [linked.abandonOn] : [])];
  const ended = AbortSignal.any(ends);
  const present = await withHandlerDeadline(adapter, remaining(deadline), source.id, "item", ended);
  assertReadOwnership(signal);
  assertReadOwnership(linked.signal);
  const cards = rows.map(({ record }) => {
    const card = present(record);
    assertReadOwnership(signal);
    if (performance.now() > deadline) {
      throw new CapabilityHandlerTimeoutError(
        `Capability ${source.id}'s cards were drawn after the Handler time limit.`,
      );
    }
    return card;
  });
  // As stored, so the page after compares against the column itself.
  const final = rows.at(-1)?.values;
  const last = final && { after: String(final.after), last: String(final.last) };
  return { count: Number(rows[0]?.values.count ?? 0), cards: cards.join(""), last };
}

/** The relations a linking capability's cards are drawn under, as its own list draws them. */
function drawnRelations(source: CapabilityRow, catalog: readonly CapabilityRow[]): DrawnRelations {
  const relations = holdingRelations(source, catalog);
  const dormant = source.relations.filter((relation) => !relations.includes(relation));
  return { relations, dormant, catalog };
}

/** A section's heading and layout: the linking capability's label and its list's layout. */
function sectionHead({ source, relation }: Pointing, catalog: readonly CapabilityRow[]) {
  const { label } = renderableFromRow(source, catalog);
  const layout = source.ui_intent.collection.layout;
  return { capability: { id: source.id, label }, layout, field: relation.field };
}
