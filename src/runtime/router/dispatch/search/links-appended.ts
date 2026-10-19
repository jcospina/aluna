// What a search appends after its Handler's answer: the searched capability's records the walk
// through links found and the answer does not show, nearest first and newest first within a
// distance, drawn through the same `present()` the Handler was given. A blank search shows every
// record, so it walks nowhere. Links are soft: what fails is left out and the answer stands. The
// walk has what is left of the Handler time limit, counted from the Handler's start; run out, it
// appends the distances it finished. The searched capability closing refuses the read, as it
// does while its Handler runs.

import type { Database } from "bun:sqlite";
import { errorDetail } from "../../../../platform/errors.ts";
import { sqlIdentifier } from "../../../../platform/persistence/sql-identifier.ts";
import type { PresentationAdapter } from "../../../../presentation/index.ts";
import { type CapabilityRow, capabilitySpecFromRow } from "../../../../registry/index.ts";
import type { ReadGateCoordinator } from "../../../concurrency/read-gates.ts";
import {
  type CapabilityActionRecord,
  type CapabilityQueryPort,
  createCapabilityQueryPort,
  deriveCapabilityTableDdl,
  searchTerms,
} from "../../../data/index.ts";
import { assertReadOwnership } from "../../wire/failure-responses.ts";
import { handlerDeadline } from "../generated-code.ts";
import { type DrawnRecords, noteDrawnRecords } from "./drawn-records.ts";
import { type LinkWalk, type WalkPace, walkLinks } from "./link-walk.ts";

/** Where a search's walk takes other capabilities' read tokens, and what bounds it. */
export interface WalkGates {
  readonly readGates: ReadGateCoordinator;
  readonly handlerTimeoutMs: number;
  /** The request's: a reader gone away needs nothing more. */
  readonly abandonOn?: AbortSignal;
}

/** The search a Handler is about to answer: its desk, its own read token, and what it asked. */
export interface SearchStart {
  readonly database: Database;
  readonly catalog: readonly CapabilityRow[];
  readonly searched: CapabilityRow;
  readonly signal: AbortSignal;
  readonly query: unknown;
  /** When the route began running the Handler, which its time limit counts from. */
  readonly startedAt: number;
}

/** The `present()` to hand the Handler, and what follows its cleaned answer. */
export interface SearchFollowingLinks {
  readonly present: PresentationAdapter;
  readonly follow: (cleaned: string) => Promise<string>;
}

/** How long the walk holds the thread before it lets other requests run. */
const BREATH_MS = 20;

/** Set a search up to follow links, before its Handler runs: nothing, for a blank search. */
export function searchFollowingLinks(
  gates: WalkGates,
  start: SearchStart,
  present: PresentationAdapter,
): SearchFollowingLinks | undefined {
  const terms = typeof start.query === "string" ? searchTerms(start.query) : [];
  if (terms.length === 0) return undefined;
  const deadline = handlerDeadline(gates.handlerTimeoutMs, start.startedAt);
  const pace = paceOf(deadline, [start.signal, gates.abandonOn]);
  const drawn = noteDrawnRecords(present);
  const { startedAt: _, ...desk } = start;
  const walk: LinkWalk = { ...desk, readGates: gates.readGates };
  return {
    present: drawn.present,
    async follow(cleaned) {
      let cards = "";
      try {
        const appended = await linkMatchesAfter({ walk, terms, pace, drawn, present }, cleaned);
        cards = appended.cards;
        if (appended.cut && gates.abandonOn?.aborted !== true) {
          console.error(`The search of ${start.searched.id} ran out of time following its links.`);
        }
      } catch (error) {
        if (!walk.signal.aborted) {
          console.error(
            `Search of ${start.searched.id} could not follow links:`,
            errorDetail(error),
          );
        }
      }
      assertReadOwnership(walk.signal);
      return cards;
    },
  };
}

/** A pace the time limit ends at `deadline`, and that any of `ends` aborting ends too. */
function paceOf(deadline: number, ends: readonly (AbortSignal | undefined)[]): WalkPace {
  let since = performance.now();
  return {
    over: () => performance.now() > deadline || ends.some((end) => end?.aborted === true),
    async breathe() {
      if (performance.now() - since < BREATH_MS) return;
      await new Promise((resolve) => setImmediate(resolve));
      since = performance.now();
    },
  };
}

interface Answered {
  readonly walk: LinkWalk;
  readonly terms: readonly string[];
  readonly pace: WalkPace;
  readonly drawn: DrawnRecords;
  readonly present: PresentationAdapter;
}

/** The cards for every record found through links that the cleaned answer does not show. */
async function linkMatchesAfter(
  { walk, terms, pace, drawn, present }: Answered,
  cleaned: string,
): Promise<{ readonly cards: string; readonly cut: boolean }> {
  const found = await walkLinks(walk, terms, pace);
  if (found.byLinks.every((ids) => ids.length === 0)) return { cards: "", cut: !found.complete };
  const shown = drawn.shownIn(cleaned);
  if (shown === undefined) {
    throw new Error("Its Handler's answer holds more than its cards, so none can follow them.");
  }
  const target = capabilitySpecFromRow(walk.searched);
  const port = createCapabilityQueryPort(walk.database, { target, signal: walk.signal });
  const table = sqlIdentifier(deriveCapabilityTableDdl(target).tableName);
  const cards: string[] = [];
  for (const ids of found.byLinks) {
    for (const record of newestFirst(
      port,
      table,
      ids.filter((id) => !shown.has(id)),
    )) {
      if (pace.over()) return { cards: cards.join(""), cut: true };
      await pace.breathe();
      cards.push(present(record));
    }
  }
  return { cards: cards.join(""), cut: !found.complete };
}

/** The records `ids` names, newest first, as the searched capability's own port reads them. */
function newestFirst(
  port: CapabilityQueryPort,
  table: string,
  ids: readonly string[],
): CapabilityActionRecord[] {
  if (ids.length === 0) return [];
  return port
    .records({
      sql:
        `SELECT "id" AS "target_id" FROM ${table} WHERE "id" IN (SELECT value FROM json_each(?))` +
        ` ORDER BY "created_at" DESC, "id" DESC`,
      parameters: [JSON.stringify(ids)],
    })
    .map(({ record }) => record);
}
