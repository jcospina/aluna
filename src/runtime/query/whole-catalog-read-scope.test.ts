// One question, one whole-catalog read scope.
//
// The claims here are ownership claims, so most of these read the read gate's own snapshot
// rather than the rows a statement returned: the complete set was acquired against one
// captured catalog or nothing was, the reader count is back at zero on every exit, and a
// deletion admitted mid-question drains rather than hanging on a token nobody released.
// The store sweep is the deterministic form of PLAN decision 2's *nothing is created*.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { readActiveRegistryCatalog } from "../../registry/index.ts";
import {
  ReadGateClosingError,
  ReadGateReleasedError,
  ReadGateUnavailableError,
} from "../concurrency/read-gates.ts";
import { createQueryWorker, type QueryWorker, QueryWorkerClosedError } from "./query-worker.ts";
import {
  addCapability,
  createScratchPlatforms,
  fakeWorkers,
  gatesFor,
  NOTES,
  readerCounts,
  TASKS,
} from "./read-scope.test-support.ts";
import {
  addedPaths,
  sweepPlatformArtifacts,
  sweepPlatformStores,
} from "./store-sweep.test-support.ts";
import { withWholeCatalogReadScope } from "./whole-catalog-read-scope.ts";

let artifactsAtStart: readonly string[] = [];
const platforms = createScratchPlatforms();
const { catalogued, migrated } = platforms;

/**
 * A cache — the state decision 2 most wants excluded — is keyed to a stable path, so a per-test
 * before/after can already hold a file an earlier test wrote. This baseline predates them all.
 */
beforeAll(() => {
  artifactsAtStart = sweepPlatformArtifacts();
});

afterAll(() => {
  expect(sweepPlatformArtifacts().filter((entry) => !artifactsAtStart.includes(entry))).toEqual([]);
});

afterEach(platforms.disposeAll);

describe("what a whole-catalog read scope owns", () => {
  test("owns every incarnation in one captured catalog for the length of the question", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { createWorker } = fakeWorkers();

    const owned = await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        expect(readerCounts(readGates)).toEqual([1, 1]);
        await scope.read("SELECT 1 AS ok");
        return scope.incarnations;
      },
    );

    expect(owned).toEqual([NOTES, TASKS]);
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("acquires nothing at all when one incarnation in the snapshot cannot be owned", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();
    await readGates.closeAndDrain(TASKS);

    await expect(
      withWholeCatalogReadScope({ readGates, database: database.readonly, createWorker }, () => {
        throw new Error("the body must not run without the complete set");
      }),
    ).rejects.toBeInstanceOf(ReadGateUnavailableError);

    // Half-owning the catalog is the race the gate exists to make impossible, so the
    // still-active incarnation must not have picked up a reader on the way to the refusal.
    expect(readerCounts(readGates)).toEqual([0, 0]);
    expect(log.created).toBe(0);
  });

  test("a question asked against an empty desk owns nothing and still runs", async () => {
    const { database } = migrated();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();

    const owned = await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      (scope) => scope.incarnations,
    );

    // Nothing to own is not the same as failing to own what there is: an empty catalog is
    // a question 6.6 answers, not a refusal the gate hands down.
    expect(owned).toEqual([]);
    expect(log.created).toBe(0);
    expect(readGates.snapshot()).toEqual([]);
  });

  test("exposes the incarnations the gate granted, not the rows it asked with", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { createWorker } = fakeWorkers();

    const owned = await withWholeCatalogReadScope(
      {
        readGates,
        database: database.readonly,
        createWorker,
        readActiveCatalog: (source) => {
          const real = readActiveRegistryCatalog(source);
          return { ...real, capabilities: [...real.capabilities].reverse() };
        },
      },
      (scope) => scope.incarnations,
    );

    // A reversed snapshot comes back in the gate's canonical order, which is what proves
    // these are the granted set rather than the array the scope asked with.
    expect(owned).toEqual([NOTES, TASKS]);
    expect(Object.isFrozen(owned)).toBe(true);
  });

  test("captures the snapshot once, before any query work", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { createWorker } = fakeWorkers();

    const seen = await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        addCapability(database.readwrite, "recipes", "33333333-3333-4333-8333-333333333333");
        await scope.read("SELECT 1 AS ok");
        return {
          ids: scope.catalog.capabilities.map((row) => row.id),
          owned: scope.incarnations.map((incarnation) => incarnation.capabilityId),
        };
      },
    );

    expect(seen.ids).toEqual(["notes", "tasks"]);
    expect(seen.owned).toEqual(["notes", "tasks"]);
    expect(readActiveRegistryCatalog(database.readonly).capabilities).toHaveLength(3);
  });
});

describe("how a whole-catalog read scope ends", () => {
  test("releases in finally when the question throws", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();

    await expect(
      withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker },
        async (scope) => {
          await scope.read("SELECT 1 AS ok");
          throw new Error("the question failed");
        },
      ),
    ).rejects.toThrow("the question failed");

    expect(readerCounts(readGates)).toEqual([0, 0]);
    expect(log.closed).toBe(1);
  });

  test("releases in finally when a closing gate cancels the question out from under it", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();
    let draining: Promise<unknown> | undefined;

    await expect(
      withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker },
        async (scope) => {
          await scope.read("SELECT 1 AS ok");
          draining = readGates.closeAndDrain(NOTES);
          await scope.read("SELECT 2 AS ok");
        },
      ),
    ).rejects.toBeInstanceOf(ReadGateClosingError);

    expect(readerCounts(readGates)).toEqual([0, 0]);
    expect(log.closed).toBe(1);
    await expect(draining).resolves.toMatchObject({ incarnation: NOTES });
  });

  test("a deletion admitted mid-question drains once the scope releases", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();
    let draining: Promise<unknown> | undefined;

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        await scope.read("SELECT 1 AS ok");
        draining = readGates.closeAndDrain(NOTES);
        expect(scope.signal.aborted).toBe(true);
        await expect(scope.read("SELECT 2 AS ok")).rejects.toBeInstanceOf(ReadGateClosingError);
      },
    );

    await expect(draining).resolves.toMatchObject({ incarnation: NOTES });
    expect(readerCounts(readGates)).toEqual([0, 0]);
    expect(log.closed).toBe(1);
  });

  test("rows whose ownership ended while they were read are not handed back", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    let deliver: (() => void) | undefined;
    const createWorker = (): QueryWorker => ({
      read: () =>
        new Promise((resolve) => {
          deliver = () => resolve([{ n: 1 }]);
        }),
      close: () => undefined,
    });

    await expect(
      withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker },
        async (scope) => {
          const pending = scope.read("SELECT 1 AS n");
          await readGates.closeAndDrain(TASKS, { timeoutMs: 0 }).catch(() => undefined);
          deliver?.();
          return await pending;
        },
      ),
    ).rejects.toBeInstanceOf(ReadGateClosingError);

    expect(readerCounts(readGates)).toEqual([0, 0]);
  });
});

describe("what a whole-catalog read scope takes back", () => {
  test("the scope's worker is terminated when the question is over", async () => {
    const { database, path } = catalogued();
    const readGates = gatesFor(database);
    let started: QueryWorker | undefined;

    await withWholeCatalogReadScope(
      {
        readGates,
        database: database.readonly,
        createWorker: () => {
          started = createQueryWorker(path);
          return started;
        },
      },
      async (scope) => {
        await scope.read("SELECT 1 AS ok");
      },
    );

    // Asked of the worker itself rather than through the scope, which would refuse on
    // released ownership before the thread ever came into it.
    await expect(started?.read("SELECT 1 AS ok")).rejects.toBeInstanceOf(QueryWorkerClosedError);
  });

  test("a read attempted after the question is over is refused as released ownership", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();
    let escaped: { read: (sql: string) => Promise<unknown> } | undefined;

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      (scope) => {
        escaped = scope;
      },
    );

    await expect(escaped?.read("SELECT 1 AS ok")).rejects.toBeInstanceOf(ReadGateReleasedError);
    expect(log.created).toBe(0);
  });

  test("a worker that will not close does not replace the failure the question reported", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const createWorker = (): QueryWorker => ({
      read: () => Promise.resolve([]),
      close: () => {
        throw new Error("terminate blew up");
      },
    });

    await expect(
      withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker },
        async (scope) => {
          await scope.read("SELECT 1 AS ok");
          throw new Error("the question failed");
        },
      ),
    ).rejects.toThrow("the question failed");

    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("a read the question walked away from does not become an unhandled rejection", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    let reject: ((reason: Error) => void) | undefined;
    const createWorker = (): QueryWorker => ({
      read: () =>
        new Promise((_resolve, settle) => {
          reject = settle;
        }),
      close: () => reject?.(new QueryWorkerClosedError("The query worker is closed.")),
    });
    const unhandled: unknown[] = [];
    const collect = (reason: unknown) => unhandled.push(reason);

    process.on("unhandledRejection", collect);
    try {
      await withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker },
        (scope) => {
          void scope.read("SELECT 1 AS ok");
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off("unhandledRejection", collect);
    }

    // Closing the worker rejects the abandoned read. Without a subscriber of the scope's own that
    // lands as a process-level event, which is a caller's bug taking the server down with it.
    expect(unhandled.filter((reason) => reason instanceof QueryWorkerClosedError)).toEqual([]);
  });

  test("a read landing between the worker closing and the tokens releasing starts no worker", async () => {
    const outcomes: string[] = [];

    for (const hops of [0, 1, 2, 3, 4]) {
      const { database } = catalogued();
      const readGates = gatesFor(database);
      const { log, createWorker } = fakeWorkers();
      let detached: Promise<unknown> | undefined;

      await withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker },
        (scope) => {
          let landing = Promise.resolve();
          for (let hop = 0; hop < hops; hop += 1) landing = landing.then(() => undefined);
          detached = landing.then(() => scope.read("SELECT 1 AS ok"));
        },
      );
      outcomes.push(
        await (detached?.then(
          () => "ran",
          (error: Error) => error.constructor.name,
        ) ?? "never started"),
      );

      // A read arriving after the worker closes but before ownership ends used to start a thread
      // nobody would close, running SQL for a scope the gate had already counted as drained.
      expect([hops, log.created]).toEqual([hops, log.closed]);
      expect(readerCounts(readGates)).toEqual([0, 0]);
    }

    // The sweep has to straddle the boundary to be worth running at all.
    expect(outcomes).toContain("ran");
    expect(outcomes.filter((outcome) => outcome !== "ran").length).toBeGreaterThan(0);
  });
});

describe("what a whole-catalog read scope hands the worker, and what it leaves behind", () => {
  test("a scope creates no registry, version, artifact, cache or read-dependency state", async () => {
    const { database, path } = catalogued();
    const readGates = gatesFor(database);
    const before = sweepPlatformStores(database.readonly, join(path, ".."));

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker: () => createQueryWorker(path) },
      async (scope) => {
        await scope.read("SELECT count(*) AS total FROM capability_registry");
        await expect(
          scope.read("INSERT INTO capability_registry (id) VALUES ('x')"),
        ).rejects.toThrow(/attempt to write a readonly database/);
        await scope.read("SELECT id FROM capability_registry ORDER BY id");
      },
    );
    const after = sweepPlatformStores(database.readonly, join(path, ".."));

    expect(after.stores).toEqual(before.stores);
    expect(addedPaths(before, after)).toEqual([]);

    // The sweep has to see the thing it claims is absent: `read_dependencies` is a column on
    // `capability_registry`, so a persisted dependency lands in a row and moves no count.
    database.readwrite.run(`UPDATE capability_registry SET read_dependencies = ? WHERE id = ?`, [
      JSON.stringify({ list: [{ capability_id: "tasks", incarnation_id: TASKS.incarnationId }] }),
      "notes",
    ]);
    expect(sweepPlatformStores(database.readonly, join(path, "..")).stores).not.toEqual(
      before.stores,
    );
  });

  test("the worker is handed statements and never a token, an incarnation or the catalog", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      async (scope) => {
        await scope.read("SELECT count(*) AS total FROM capability_registry WHERE id = ?", [
          "notes",
        ]);
      },
    );

    expect(log.factoryArguments).toEqual([[]]);
    expect(log.calls).toEqual([
      {
        sql: "SELECT count(*) AS total FROM capability_registry WHERE id = ?",
        parameters: ["notes"],
      },
    ]);
    const crossed = JSON.stringify(log.calls);
    expect(crossed).not.toContain(NOTES.incarnationId);
    expect(crossed).not.toContain(TASKS.incarnationId);
  });

  test("a question that runs no statement starts no worker", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();

    await withWholeCatalogReadScope(
      { readGates, database: database.readonly, createWorker },
      () => undefined,
    );

    expect(log).toEqual({ created: 0, closed: 0, calls: [], factoryArguments: [] });
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });

  test("the same question asked twice acquires and releases twice, reusing nothing", async () => {
    const { database } = catalogued();
    const readGates = gatesFor(database);
    const { log, createWorker } = fakeWorkers();
    const question = "SELECT count(*) AS total FROM capability_registry";

    const ask = () =>
      withWholeCatalogReadScope(
        { readGates, database: database.readonly, createWorker },
        async (scope) => {
          await scope.read(question);
          return { catalog: scope.catalog, signal: scope.signal };
        },
      );
    const first = await ask();
    const second = await ask();

    expect(second.catalog).not.toBe(first.catalog);
    expect(second.signal).not.toBe(first.signal);
    expect(second.catalog.fingerprint).toBe(first.catalog.fingerprint);
    expect({ created: log.created, closed: log.closed, calls: log.calls }).toEqual({
      created: 2,
      closed: 2,
      calls: [
        { sql: question, parameters: [] },
        { sql: question, parameters: [] },
      ],
    });
    expect(readerCounts(readGates)).toEqual([0, 0]);
  });
});
