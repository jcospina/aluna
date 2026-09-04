// A statement long enough to still be running when something tries to cancel it.
//
// The claims decision 7 and decision 10 make are about a query that cannot be asked to
// stop, so proving either takes a real one: a recursive CTE has no I/O to yield on and no
// row to check a signal between, so `bun:sqlite` is inside a single synchronous call for
// its whole duration. It counts rather than collects, so it pins a CPU without growing
// memory, and it touches no capability table — which is why all three suites that need one
// share this statement rather than calibrating three of their own.
//
// The count runs roughly 2.9s on an M-series Mac. No test needs that number to be right,
// only to stay far above the window it races: the cancellation suites hold it against 200ms
// deadlines, and its tightest consumer is the one-second liveness window in
// `query-worker.test.ts`. Nothing here is left to trust — `whole-catalog-read-scope.cancel.test.ts`
// projects the statement's cost from a tenth of it and fails if the fixture has become too
// short for the deadlines racing it, which is what a much faster machine would otherwise do
// silently. Raising the count costs the run real CPU: a terminated worker keeps burning its
// statement to the end, on a core the rest of the suite has to share. This module is not run
// as a test by bun.

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
 * Start the runaway read and hand it back once the thread is inside it. The warm-up read
 * is what makes that true: the worker opens on its first statement, so without it the
 * runaway would still be waiting on the open when the cancel arrived.
 *
 * Wrapped in an object rather than returned bare, because awaiting a promise that resolves
 * to a promise unwraps both — a caller would sit through the whole statement it is here to
 * interrupt, and every deadline in the test would pass for the wrong reason.
 *
 * That the thread is *inside* the statement rather than still holding the message is an
 * assumption, not an assertion: the worker runs one read at a time, so it can answer
 * nothing while it is busy, and there is no seam through which it could say so. The
 * warm-up read makes it a safe one — the thread is open, idle and one `postMessage` away.
 * Were it ever wrong the tests would prove a weaker claim, never a false one.
 */
export async function startRunawayQuery(
  scope: Pick<WholeCatalogReadScope, "read">,
): Promise<{ readonly runaway: Promise<readonly unknown[]> }> {
  await scope.read("SELECT 1 AS ok");
  const runaway = scope.read(RUNAWAY_QUERY_SQL);
  await new Promise((resolve) => setTimeout(resolve, IN_FLIGHT_MS));
  return { runaway };
}
