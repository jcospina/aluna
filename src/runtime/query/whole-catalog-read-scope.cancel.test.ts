// How one question ends before it has an answer.
//
// The cancel entry point and the trigger that has a raiser today (PLAN decision 10, and the
// residual risk decision 13 records): a closing read gate. Its sibling file covers what a
// scope owns and how it releases; what is proved here is that a *running* statement stops
// being waited on, which is the whole of what turns the deletion drain's deadline into a
// mechanism. The deletion end of that claim is in
// `src/lifecycle/deletion/destruction/two-phase-destruction.test.ts`.

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ReadGateClosingError } from "../concurrency/read-gates.ts";
import { createQueryWorker, type QueryWorker, QueryWorkerStatementError } from "./query-worker.ts";
import {
  createScratchPlatforms,
  fakeWorkers,
  gatesFor,
  NOTES,
  readerCounts,
} from "./read-scope.test-support.ts";
import {
  countingQuerySql,
  RUNAWAY_QUERY_ROWS,
  startRunawayQuery,
} from "./runaway-query.test-support.ts";
import {
  WholeCatalogReadCancelledError,
  withWholeCatalogReadScope,
} from "./whole-catalog-read-scope.ts";

const platforms = createScratchPlatforms();
const { catalogued } = platforms;

afterEach(platforms.disposeAll);

/**
 * Far below the runaway statement, far above the chain of microtasks a release takes: removing the
 * cancel wiring fails three of these tests, so the margin is the point rather than an accident.
 */
const DRAIN_MS = 200;
/** How long a test waits before calling a promise stuck rather than slow. */
const SETTLE_MS = 500;

describe("how a question is cancelled", () => {
  test("cancelling ends the read in flight, and every later read carries the cancellation", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers([], { hold: true });
    let outcome = "";

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        const reading = scope.read("SELECT 1 AS ok");
        scope.cancel();

        // Raced rather than awaited: a cancel that stopped killing would leave the read
        // outstanding for ever, and a regression that hangs the suite is one nobody reads.
        outcome = await Promise.race([
          reading.then(
            () => "answered",
            (error: Error) => error.constructor.name,
          ),
          new Promise<string>((resolve) => setTimeout(() => resolve("still waiting"), SETTLE_MS)),
        ]);
        expect(log.closed).toBe(1);
        await expect(scope.read("SELECT 2 AS ok")).rejects.toBeInstanceOf(
          WholeCatalogReadCancelledError,
        );
        // Idempotent: 6.5/04 raises two triggers against this one entry point, and a
        // dismissed answer arriving after a new question must not reopen anything.
        scope.cancel();
        expect(log.closed).toBe(1);
      },
    );

    expect(outcome).toBe("WholeCatalogReadCancelledError");
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("a cancel is visible on the signal, not only to the next read", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { createWorker } = fakeWorkers();
    const reason = new Error("the user asked something else");

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      (scope) => {
        expect(scope.signal.aborted).toBe(false);
        scope.cancel(reason);

        // 6.3's loop spends most of its time between statements, where 6.5/04's triggers land: a
        // body learning of a cancel only by trying another read finishes a turn it cannot own.
        expect(scope.signal.aborted).toBe(true);
        expect(scope.signal.reason).toBe(reason);
      },
    );

    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("a worker that refuses to close once is closed again when the scope ends", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const attempts: string[] = [];
    const createWorker = (): QueryWorker => ({
      read: () => Promise.resolve([]),
      close: () => {
        attempts.push("close");
        if (attempts.length === 1) throw new Error("terminate blew up");
      },
    });

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        await scope.read("SELECT 1 AS ok");
        scope.cancel();
      },
    );

    // A close that threw left its thread running, so the `finally` has to try again rather
    // than trust a flag set before the call it was meant to record.
    expect(attempts).toEqual(["close", "close"]);
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("a statement SQLite refused keeps its own message beside a cancel", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    let refuse: ((reason: Error) => void) | undefined;
    const createWorker = (): QueryWorker => ({
      read: () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
      close: () => undefined,
    });

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        const reading = scope.read("SELECT bad");
        scope.cancel();
        refuse?.(new QueryWorkerStatementError('near "bad": syntax error'));

        // The question is over either way, and what ended it is not what was wrong with the
        // statement. 6.3's loop is the reader that has to tell those apart.
        await expect(reading).rejects.toBeInstanceOf(QueryWorkerStatementError);
      },
    );

    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("a cancel before the first statement starts no worker at all", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        scope.cancel(new Error("the user asked something else"));
        await expect(scope.read("SELECT 1 AS ok")).rejects.toThrow("the user asked something else");
      },
    );

    // The hole `over` closes on the other end: a read after a cancel would otherwise start
    // a thread whose only closer has already run.
    expect(log.created).toBe(0);
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });
});

describe("what a cancel does to a statement already running", () => {
  test("a cancel kills a synchronously-running query rather than waiting for it to finish", async () => {
    const { database, path } = catalogued();
    const readGates = gatesFor(database);

    const waited = await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker: () => createQueryWorker(path) },
      async (scope) => {
        const { runaway } = await startRunawayQuery(scope);
        const cancelledAt = Date.now();
        scope.cancel();
        await expect(runaway).rejects.toBeInstanceOf(WholeCatalogReadCancelledError);
        return Date.now() - cancelledAt;
      },
    );

    // The statement has well over a second left to run and no way to hear about any of this: what
    // the kill reclaims is the waiting rather than the thread's remaining cycles.
    expect(waited).toBeLessThan(DRAIN_MS);
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("closing a gate mid-query cancels the question and the drain finishes inside its deadline", async () => {
    const { database, path } = catalogued();
    const readGates = gatesFor(database);
    let draining: Promise<unknown> | undefined;

    await expect(
      withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker: () => createQueryWorker(path) },
        async (scope) => {
          const { runaway } = await startRunawayQuery(scope);
          draining = readGates.closeAndDrain(NOTES, { timeoutMs: DRAIN_MS });
          return await runaway;
        },
      ),
    ).rejects.toBeInstanceOf(ReadGateClosingError);

    // Without the kill the token is held until the statement ends, seconds past this
    // deadline, and the drain reports a timeout for a deletion that would have succeeded.
    await expect(draining).resolves.toMatchObject({ incarnation: NOTES });
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });
});

// The other half of decision 10: what the cancel path is not allowed to quietly become, and
// whether the fixture these deadlines race is still long enough to tell.
describe("what the cancel path may not become", () => {
  test("a slow question is waited for rather than cut off", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const SLOW_MS = 250;
    const createWorker = (): QueryWorker => ({
      read: () => new Promise((resolve) => setTimeout(() => resolve([{ n: 1 }]), SLOW_MS)),
      close: () => undefined,
    });
    const startedAt = Date.now();

    const rows = await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      (scope) => scope.read("SELECT 1 AS n"),
    );

    expect(rows).toEqual([{ n: 1 }]);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(SLOW_MS);
  });

  test("the runaway fixture still outlasts every deadline that races it", () => {
    const { database } = catalogued();
    const sample = RUNAWAY_QUERY_ROWS / 10;
    const startedAt = Date.now();
    database.readonly.query(countingQuerySql(sample)).all();
    const projected = (Date.now() - startedAt) * 10;

    // Every deadline here discriminates only while the statement it races still has work left, so
    // a much faster machine would pass with the wiring gone: a tenth of the work prices the whole.
    expect({ projected: projected > 4 * DRAIN_MS, liveness: projected > 2_000 }).toEqual({
      projected: true,
      liveness: true,
    });
  });

  test("nothing on the question's path arms a wall-clock deadline", () => {
    // A cancel entry point is one timer away from the deadline decision 9 refused. The thread's
    // `PRAGMA busy_timeout` is not one: it bounds waiting for another process's lock.
    for (const module of [
      "whole-catalog-read-scope.ts",
      "query-worker.ts",
      "query-worker-thread.ts",
    ]) {
      const source = readFileSync(join(import.meta.dir, module), "utf8");
      expect([module, /\b(?:setTimeout|setInterval|AbortSignal\.timeout)\b/.test(source)]).toEqual([
        module,
        false,
      ]);
    }
  });
});
