// A statement long enough to still be running when something tries to cancel it.
//
// Decisions 7 and 10 are about a query that cannot be asked to stop, so proving either takes a real
// one. A recursive CTE has no I/O to yield on and no row to check a signal between, so `bun:sqlite`
// stays inside a single synchronous call for its whole duration; it counts rather than collects, so
// it pins a CPU without growing memory and touches no capability table.
//
// The count runs roughly 2.9s on an M-series Mac. No test needs that number to be right, only to
// stay far above the window it races — the tightest is the one-second liveness window in
// `query-worker.test.ts`, and `whole-catalog-read-scope.cancel.test.ts` projects the cost from a
// tenth of it and fails if the fixture has grown too short. Raising the count costs real CPU: a
// terminated worker burns its statement to the end. Not run as a test by bun.

import type { WholeCatalogReadScope } from "./whole-catalog-read-scope.ts";

export const RUNAWAY_QUERY_ROWS = 30_000_000;

/** The same statement at any size, so a guard can price it without paying for all of it. */
export function countingQuerySql(rows: number): string {
  return (
    `WITH RECURSIVE runaway(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM runaway WHERE n < ${rows}) ` +
    "SELECT sum(n) AS total FROM runaway"
  );
}

export const RUNAWAY_QUERY_SQL = countingQuerySql(RUNAWAY_QUERY_ROWS);

/** Long enough for the thread to have taken the statement up, short enough to be free. */
const IN_FLIGHT_MS = 25;

/**
 * Start the runaway read and hand it back once the thread is inside it — an assumption the worker
 * has no seam to assert. Wrapped in an object, or awaiting it would unwrap both promises.
 */
export async function startRunawayQuery(
  scope: Pick<WholeCatalogReadScope, "read">,
): Promise<{ readonly runaway: Promise<readonly unknown[]> }> {
  // The worker opens on its first statement, so without this warm-up the runaway would still be
  // waiting on the open when the cancel arrived.
  await scope.read("SELECT 1 AS ok");
  const runaway = scope.read(RUNAWAY_QUERY_SQL);
  await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_MS));
  return { runaway };
}
