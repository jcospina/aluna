// The walk a search takes through links. It reaches every capability that relations holding either
// way round join to the searched one, each under its own read token, taken apart from the request's
// and given back the moment its capability closes: one whose token cannot be taken is left out, and
// so is what only it joins. Each is searched once, by the rule a search Handler is given. A path of
// relations from the searched capability enters each capability once, so a loop such as Books →
// Authors → Books ends; along each path, shortest first, the far end's matches, not counting a
// field's copy of a name picked from a capability already on the path, are followed back through
// the link table a hop at a time, each hop's records read through their own query port.

import type { Database } from "bun:sqlite";
import { errorDetail } from "../../../../platform/errors.ts";
import {
  type EdgeLink,
  type LinkEdge,
  readLinksFrom,
  readLinksTo,
  readPickingRecords,
} from "../../../../platform/links/link-table.ts";
import { sqlIdentifier } from "../../../../platform/persistence/sql-identifier.ts";
import {
  activeSpecFields,
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
  holdingRelations,
  isListFieldType,
  isSearchableTextType,
  type Relation,
  relationsPointingAt,
} from "../../../../registry/index.ts";
import {
  capabilityIncarnation,
  type ReadGateCoordinator,
  type ReadTokenSet,
} from "../../../concurrency/read-gates.ts";
import {
  type CapabilityQueryPort,
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
} from "../../../data/index.ts";

/** Where a search's walk starts: the searched capability, on the desk its request read. */
export interface LinkWalk {
  readonly database: Database;
  readonly readGates: ReadGateCoordinator;
  readonly catalog: readonly CapabilityRow[];
  readonly searched: CapabilityRow;
  /** The searched capability's own read token's, which the request holds. */
  readonly signal: AbortSignal;
}

/** How long a walk may go on, and when it lets other requests run. */
export interface WalkPace {
  /** Whether the walk must stop now: its time is up, or its reader or its capability has gone. */
  readonly over: () => boolean;
  /** Let other requests run, once the walk has held the thread a while. */
  readonly breathe: () => Promise<void>;
}

/** The searched capability's records found, one list per number of links, nearest first. */
export interface WalkFound {
  readonly byLinks: readonly (readonly string[])[];
  /** Whether every distance was walked; one cut short by its pace lists the complete ones. */
  readonly complete: boolean;
}

/** A capability the walk reached, read through its own port under its own token. */
interface Reached {
  readonly row: CapabilityRow;
  readonly spec: CapabilitySpec;
  readonly table: string;
  readonly port: CapabilityQueryPort;
  readonly signal: AbortSignal;
}

/** One relation on a path, crossed from its end nearer the searched capability. */
interface Step {
  readonly edge: LinkEdge;
  readonly nearer: Reached;
  readonly farther: Reached;
}

export async function walkLinks(
  walk: LinkWalk,
  terms: readonly string[],
  pace: WalkPace,
): Promise<WalkFound> {
  const tokens: ReadTokenSet[] = [];
  try {
    const reached = reach(walk, tokens);
    const steps = stepsAmong(reached, walk.catalog);
    const reads = readsOf(walk.database, walk.catalog, terms);
    const fewest = new Map<string, number>();
    for (let length = 1; ; length++) {
      const walked = await walkLength({ walk, steps, reads, pace, fewest }, length);
      if (walked === "stopped") return { byLinks: byDistance(fewest), complete: false };
      if (walked === "none") return { byLinks: byDistance(fewest), complete: true };
    }
  } finally {
    for (const taken of tokens) walk.readGates.release(taken);
  }
}

/** Every path of `length` steps, each record noted at the first length it is found at. */
async function walkLength(
  at: {
    walk: LinkWalk;
    steps: readonly Step[];
    reads: Reads;
    pace: WalkPace;
    fewest: Map<string, number>;
  },
  length: number,
): Promise<"walked" | "none" | "stopped"> {
  let walked = false;
  for (const path of paths(at.walk.searched.id, at.steps, length)) {
    if (at.pace.over()) return "stopped";
    await at.pace.breathe();
    walked = true;
    for (const record of back(path, at.reads)) {
      if (!at.fewest.has(record)) at.fewest.set(record, length);
    }
  }
  return walked ? "walked" : "none";
}

/** The records found, one list per number of links, nearest first. */
function byDistance(fewest: ReadonlyMap<string, number>): string[][] {
  const byLinks = new Map<number, string[]>();
  for (const [record, links] of fewest) byLinks.set(links, [...(byLinks.get(links) ?? []), record]);
  const farthest = Math.max(0, ...byLinks.keys());
  return Array.from({ length: farthest }, (_, at) => byLinks.get(at + 1) ?? []);
}

/** The capabilities the walk reaches, each under its own read token, the searched one first. */
function reach(walk: LinkWalk, tokens: ReadTokenSet[]): ReadonlyMap<string, Reached> {
  const { searched, catalog } = walk;
  const reached = new Map([[searched.id, reachedAs(walk.database, searched, walk.signal)]]);
  const visited = new Set([searched.id]);
  for (let frontier = [searched]; frontier.length > 0; ) {
    const next = new Map<string, CapabilityRow>();
    for (const row of frontier.flatMap((each) => neighbours(each, catalog))) {
      if (!visited.has(row.id)) next.set(row.id, row);
    }
    for (const id of next.keys()) visited.add(id);
    frontier = [...next.values()].filter((row) => {
      const taken = takeToken(walk, row);
      if (taken === undefined) return false;
      tokens.push(taken);
      reached.set(row.id, reachedAs(walk.database, row, taken.signal));
      return true;
    });
  }
  return reached;
}

/** A reached capability's read token, given back as soon as its capability starts closing. */
function takeToken(walk: LinkWalk, row: CapabilityRow): ReadTokenSet | undefined {
  const taken = walk.readGates.tryAcquire({
    catalog: walk.catalog.map(capabilityIncarnation),
    incarnations: [capabilityIncarnation(row)],
  });
  taken?.signal.addEventListener(
    "abort",
    () => queueMicrotask(() => walk.readGates.release(taken)),
    {
      once: true,
    },
  );
  return taken;
}

/** The capabilities a relation that holds joins to `row`, either way round. */
function neighbours(row: CapabilityRow, catalog: readonly CapabilityRow[]): CapabilityRow[] {
  const out = holdingRelations(row, catalog).flatMap(({ to }) =>
    catalog.filter((each) => each.id === to.capability),
  );
  return [...out, ...relationsPointingAt(row, catalog).map(({ source }) => source)];
}

function reachedAs(database: Database, row: CapabilityRow, signal: AbortSignal): Reached {
  const spec = capabilitySpecFromRow(row);
  const table = sqlIdentifier(deriveCapabilityTableDdl(spec).tableName);
  const port = createCapabilityQueryPort(database, { target: spec, signal });
  return { row, spec, table, port, signal };
}

/** Every relation that holds between two capabilities reached, crossed either way round. */
function stepsAmong(
  reached: ReadonlyMap<string, Reached>,
  catalog: readonly CapabilityRow[],
): Step[] {
  return [...reached.values()].flatMap((source) =>
    holdingRelations(source.row, catalog).flatMap((relation) => {
      const target = reached.get(relation.to.capability);
      if (target === undefined) return [];
      const edge = {
        source: { capability: source.row.id, field: relation.field },
        target: { capability: target.row.id, incarnation: relation.to.incarnation },
      };
      return [
        { edge, nearer: source, farther: target },
        { edge, nearer: target, farther: source },
      ];
    }),
  );
}

/** Every path of `length` steps out of the searched capability entering no capability twice. */
function* paths(
  searched: string,
  steps: readonly Step[],
  length: number,
): Generator<readonly Step[]> {
  const visited = new Set([searched]);
  function* from(at: string, path: readonly Step[]): Generator<readonly Step[]> {
    if (path.length === length) {
      yield path;
      return;
    }
    for (const step of steps) {
      const farther = step.farther.row.id;
      if (step.nearer.row.id !== at || visited.has(farther)) continue;
      visited.add(farther);
      yield* from(farther, [...path, step]);
      visited.delete(farther);
    }
  }
  yield* from(searched, []);
}

/** The searched capability's records linked to the matches at the path's far end. */
function back(path: readonly Step[], reads: Reads): readonly string[] {
  const far = path.at(-1)?.farther;
  if (far === undefined) return [];
  const onPath = new Set(path.map((step) => step.nearer.row.id));
  let records = reads.matches(far, onPath);
  for (const step of path.toReversed()) records = reads.held(step.nearer, reads.hop(step, records));
  return records;
}

/** What the walk reads, each thing once. */
interface Reads {
  /** A capability's matches, a field's copy of a name picked from a capability on the path aside. */
  readonly matches: (capability: Reached, onPath: ReadonlySet<string>) => readonly string[];
  /** The records one step nearer linked to `records` along the step's relation. */
  readonly hop: (step: Step, records: readonly string[]) => readonly string[];
  /** Which of `ids` a capability still holds; the searched capability's own read ends a path. */
  readonly held: (capability: Reached, ids: readonly string[]) => readonly string[];
}

function readsOf(database: Database, catalog: readonly CapabilityRow[], terms: readonly string[]) {
  const failed = new Set<Reached>();
  const safely = <T>(capability: Reached, read: () => T, none: T) =>
    failed.has(capability) ? none : leftOutOnFailure(capability, read, none, failed);
  const termsIn = memo((capability: Reached) =>
    safely(capability, () => termsHeld(capability, terms), new Map<string, FieldTerms>()),
  );
  const pickedThrough = memo(
    (step: { readonly edge: LinkEdge }) => new Set(readPickingRecords(database, step.edge)),
  );
  const hops = new Map<Step, Map<string, string[]>>();
  const known = new Map<Reached, Map<string, boolean>>();
  const reads: Reads = {
    matches(capability, onPath) {
      const copies = holdingRelations(capability.row, catalog)
        .filter(({ to }) => onPath.has(to.capability))
        .map((relation) => ({
          field: relation.field,
          picked: pickedThrough(edgeOf(capability, relation)),
        }));
      return matchingAll(termsIn(capability), terms.length, copies);
    },
    hop(step, records) {
      const memo = hops.get(step) ?? new Map<string, string[]>();
      hops.set(step, memo);
      const unread = records.filter((record) => !memo.has(record));
      if (unread.length > 0) remember(memo, step, unread, linkRows(database, step, unread));
      return [...new Set(records.flatMap((record) => memo.get(record) ?? []))];
    },
    held(capability, ids) {
      const seen = known.get(capability) ?? new Map<string, boolean>();
      known.set(capability, seen);
      const unread = ids.filter((record) => !seen.has(record));
      const holds =
        unread.length > 0 ? safely(capability, () => existing(capability, unread), []) : [];
      const present = new Set(holds);
      for (const record of unread) seen.set(record, present.has(record));
      return ids.filter((record) => seen.get(record) === true);
    },
  };
  return reads;
}

/** The edge a relation of `source` draws through the link table. */
function edgeOf(source: Reached, { field, to }: Relation): { readonly edge: LinkEdge } {
  return {
    edge: {
      source: { capability: source.row.id, field },
      target: { capability: to.capability, incarnation: to.incarnation },
    },
  };
}

/** `compute`, run once for each key. */
function memo<K, V>(compute: (key: K) => V): (key: K) => V {
  const values = new Map<K, V>();
  return (key) => {
    if (!values.has(key)) values.set(key, compute(key));
    return values.get(key) as V;
  };
}

/** Which of the search's terms each field of a record holds, by field. */
type FieldTerms = ReadonlyMap<string, ReadonlySet<number>>;

/**
 * The records holding every term in some field, a field whose name is a copy picked from a
 * capability on the path not counted: the text there is that capability's, not the record's own.
 */
function matchingAll(
  held: ReadonlyMap<string, FieldTerms>,
  terms: number,
  copies: readonly Copy[],
): string[] {
  return [...held]
    .filter(([record, fields]) => ownTerms(record, fields, copies).size === terms)
    .map(([record]) => record);
}

/** A linked field, and the records whose text in it is a copy of the name they picked. */
interface Copy {
  readonly field: string;
  readonly picked: ReadonlySet<string>;
}

/** The terms a record holds in its own text: in no field whose text is a copy it picked. */
function ownTerms(record: string, fields: FieldTerms, copies: readonly Copy[]): Set<number> {
  const own = new Set<number>();
  for (const [field, held] of fields) {
    const copied = copies.some((copy) => copy.field === field && copy.picked.has(record));
    if (!copied) for (const term of held) own.add(term);
  }
  return own;
}

/** The link rows a step back from `records` reads: from the target end when the nearer picks. */
function linkRows(database: Database, { edge, nearer }: Step, records: readonly string[]) {
  return nearer.row.id === edge.source.capability
    ? readLinksTo(database, edge, records)
    : readLinksFrom(database, edge, records);
}

/** Note, for each record a step back starts from, the records one step nearer it leads to. */
function remember(
  memo: Map<string, string[]>,
  { edge, nearer }: Step,
  unread: readonly string[],
  rows: readonly EdgeLink[],
): void {
  const picks = nearer.row.id === edge.source.capability;
  for (const record of unread) memo.set(record, []);
  for (const { source, target } of rows) {
    memo.get(picks ? target : source)?.push(picks ? source : target);
  }
}

/**
 * A reached capability's part of the walk, or none when reading it fails: links are soft. One
 * closing under the read is expected and says nothing; anything else is logged,
 * once, and the capability is read no more.
 */
function leftOutOnFailure<T>(capability: Reached, read: () => T, none: T, failed: Set<Reached>): T {
  try {
    return read();
  } catch (error) {
    failed.add(capability);
    if (!capability.signal.aborted) {
      console.error(`Search could not follow links into ${capability.row.id}:`, errorDetail(error));
    }
    return none;
  }
}

const FOUND = [{ alias: "found", type: "string" }] as const;

function existing({ port, table }: Reached, ids: readonly string[]): string[] {
  return port
    .records({
      sql: `SELECT "id" AS "target_id", "id" AS "found" FROM ${table} WHERE "id" IN (SELECT value FROM json_each(?))`,
      parameters: [JSON.stringify(ids)],
      result: FOUND,
    })
    .map(({ values }) => String(values.found));
}

/**
 * Which terms each searchable field of each record holds, by the rule a search Handler is given
 * (`unit-prompts.ts`): a string field, or an element of a list field. One read of the capability;
 * a record holding no term anywhere is left out.
 */
function termsHeld(
  { spec, table, port }: Reached,
  terms: readonly string[],
): ReadonlyMap<string, FieldTerms> {
  const fields = activeSpecFields(spec.schema.fields).filter((f) => isSearchableTextType(f.type));
  if (fields.length === 0) return new Map();
  const holding = fields.map(({ name, type }) =>
    isListFieldType(type)
      ? `EXISTS (SELECT 1 FROM json_each("target".${sqlIdentifier(name)}) AS "element" WHERE ${termIn('"element"."value"')})`
      : termIn(`"target".${sqlIdentifier(name)}`),
  );
  const columns = holding.map(
    (holds, at) =>
      `(SELECT json_group_array("search_term"."at") FROM "search_terms" AS "search_term" WHERE ${holds}) AS "field_${at}"`,
  );
  const rows = port.records({
    sql:
      `WITH "search_terms" AS (SELECT CAST("key" AS INTEGER) AS "at", "value" AS "term" FROM json_each(?))` +
      ` SELECT "target"."id" AS "target_id", "target"."id" AS "found", ${columns.join(", ")}` +
      ` FROM ${table} AS "target"` +
      ` WHERE EXISTS (SELECT 1 FROM "search_terms" AS "search_term" WHERE ${holding.join(" OR ")})`,
    parameters: [JSON.stringify(terms)],
    result: [
      ...FOUND,
      ...fields.map((_, at) => ({ alias: `field_${at}`, type: "string" as const })),
    ],
  });
  return new Map(
    rows.map(({ values }) => [
      String(values.found),
      new Map(
        fields.map(({ name }, at) => [
          name,
          new Set(JSON.parse(String(values[`field_${at}`])) as number[]),
        ]),
      ),
    ]),
  );
}

function termIn(value: string): string {
  return `coalesce(instr(platform_search_normalize(${value}), platform_search_normalize("search_term"."term")), 0) > 0`;
}
