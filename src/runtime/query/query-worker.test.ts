// Tests for the query worker and its own read-only connection.
//
// Two of these are the reason the worker is admissible at all, and both turn decision 7's
// measurements into assertions rather than prose (`query-worker-thread.ts` carries the
// why): a write through the worker's connection still fails at the SQLite seam one thread
// away from `db.ts`, and the main thread stays live while the worker runs a query that
// would otherwise freeze the desk. The second describe block holds the part
// `SQLITE_OPEN_READONLY` does not cover on its own — the statements that write a file or
// read a different database without ever writing this one.

import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DB_PATH, openDatabase, type PlatformDatabase } from "../../platform/persistence/db.ts";
import { runMigrations } from "../../platform/persistence/migrations.ts";
import {
  createQueryWorker,
  type QueryWorker,
  QueryWorkerBusyError,
  QueryWorkerClosedError,
  QueryWorkerStatementError,
} from "./query-worker.ts";
import { RUNAWAY_QUERY_SQL } from "./runaway-query.test-support.ts";
import { addedPaths, sweepPlatformStores } from "./store-sweep.test-support.ts";

const HEARTBEAT_INTERVAL_MS = 20;
const LIVENESS_WINDOW_MS = 1_000;
/**
 * A floor, not a measurement. Decision 7 saw 39 ticks against an expected 40, but asserting near
 * that reads a loaded machine's drift as a frozen loop; in-process the same window yields zero.
 */
const MIN_HEARTBEATS = Math.floor(LIVENESS_WINDOW_MS / HEARTBEAT_INTERVAL_MS / 5);

const workers: QueryWorker[] = [];
const connections: PlatformDatabase[] = [];
const directories: string[] = [];

function release(): void {
  for (const worker of workers) worker.close();
  for (const pair of connections) {
    pair.readwrite.close();
    pair.readonly.close();
  }
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  workers.length = 0;
  connections.length = 0;
  directories.length = 0;
}

/** A throwaway database file holding one seeded table, plus its read-write connection. */
function seeded(options: { migrate?: boolean } = {}): { path: string; database: Database } {
  const directory = mkdtempSync(join(tmpdir(), "omni-crud-query-worker-"));
  directories.push(directory);
  const path = join(directory, "test.db");
  const pair = openDatabase(path);
  connections.push(pair);
  if (options.migrate) runMigrations(pair.readwrite);
  pair.readwrite.exec("CREATE TABLE widget (id INTEGER PRIMARY KEY, name TEXT, size INTEGER)");
  pair.readwrite.run("INSERT INTO widget (name, size) VALUES (?, ?)", ["alpha", 5]);
  pair.readwrite.run("INSERT INTO widget (name, size) VALUES (?, ?)", ["beta", 20]);
  pair.readwrite.run("INSERT INTO widget (name, size) VALUES (?, ?)", ["gamma", 30]);
  return { path, database: pair.readwrite };
}

function start(path?: string): QueryWorker {
  const worker = path === undefined ? createQueryWorker() : createQueryWorker(path);
  workers.push(worker);
  return worker;
}

describe("the query worker", () => {
  afterEach(release);

  test("returns rows for a parameterized statement issued from the main thread", async () => {
    const { path } = seeded();

    const rows = await start(path).read(
      "SELECT name, size FROM widget WHERE size > ? ORDER BY name",
      [10],
    );

    expect(rows).toEqual([
      { name: "beta", size: 20 },
      { name: "gamma", size: 30 },
    ]);
  });

  test("opens the one documented database file when given no path", async () => {
    // Importing `db.ts` for DB_PATH is what makes the file openable: its module scope creates the
    // file and the WAL `-shm` index a read-only connection can attach to but never create.
    const [row] = await start().read("SELECT file FROM pragma_database_list WHERE name = 'main'");

    expect(realpathSync(String(row?.file))).toBe(realpathSync(DB_PATH));
  });

  test("a write through the worker's connection fails at the SQLite seam", async () => {
    const { path } = seeded();
    const worker = start(path);

    // DML and DDL both: the boundary is SQLite's, so it holds regardless of the SQL issued.
    // The message matters — a refusal by message shape would pass for a mere typo too.
    await expect(
      worker.read("INSERT INTO widget (name, size) VALUES (?, ?)", ["delta", 40]),
    ).rejects.toThrow(/attempt to write a readonly database/);
    await expect(worker.read("CREATE TABLE smuggled (id INTEGER)")).rejects.toThrow(
      /attempt to write a readonly database/,
    );

    // The refusal is the whole story: the thread stays open and the rows are untouched.
    expect(await worker.read("SELECT count(*) AS total FROM widget")).toEqual([{ total: 3 }]);
  });

  test("the main thread keeps running while the worker runs a pathological query", async () => {
    const { path } = seeded();
    const worker = start(path);
    // Prove the thread is alive and connected first, so a jammed query cannot be confused
    // with a worker that never opened.
    expect(await worker.read("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);

    let settled = false;
    const runaway = worker.read(RUNAWAY_QUERY_SQL).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    let heartbeats = 0;
    const heartbeat = setInterval(() => {
      heartbeats += 1;
    }, HEARTBEAT_INTERVAL_MS);
    await Bun.sleep(LIVENESS_WINDOW_MS);
    clearInterval(heartbeat);
    const observed = { heartbeats, stillRunning: !settled };
    worker.close();
    await runaway;

    // In-process this timer never fires: the query holds the stack for its whole duration
    // and the event loop cannot reach the callback. Off it, the desk keeps serving.
    expect(observed.stillRunning).toBe(true);
    expect(observed.heartbeats).toBeGreaterThanOrEqual(MIN_HEARTBEATS);
  });

  test("nothing but a statement and its parameters reaches the worker", async () => {
    const { path } = seeded();
    const constructed: unknown[][] = [];
    const posted: unknown[] = [];
    const RealWorker = globalThis.Worker;
    class RecordingWorker extends RealWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) {
        constructed.push(args);
        super(...args);
      }
      override postMessage(message: unknown, transfer?: unknown): void {
        posted.push({ message, transfer });
        super.postMessage(message as never, transfer as never);
      }
    }

    globalThis.Worker = RecordingWorker as unknown as typeof Worker;
    try {
      await start(path).read("SELECT name FROM widget WHERE size > ?", [10]);
    } finally {
      globalThis.Worker = RealWorker;
    }

    // Three ways reach the thread, so all three are asserted: the constructor's options (where an
    // `env` or `argv` entry would land), the transfer list, and the messages themselves.
    expect(constructed.map((args) => args.length)).toEqual([1]);
    expect(String(constructed[0]?.[0])).toMatch(/query-worker-thread\.ts$/);
    expect(posted).toEqual([
      { message: { kind: "open", id: expect.any(Number), path }, transfer: undefined },
      {
        message: {
          kind: "read",
          id: expect.any(Number),
          sql: "SELECT name FROM widget WHERE size > ?",
          parameters: [10],
        },
        transfer: undefined,
      },
    ]);
  });

  test("a read creates no registry, version, artifact, cache or read-dependency state", async () => {
    const { path, database } = seeded({ migrate: true });
    const before = sweepPlatformStores(database, join(path, ".."));
    const worker = start(path);

    await worker.read("SELECT count(*) AS total FROM widget");
    await expect(worker.read("INSERT INTO widget (name, size) VALUES ('x', 1)")).rejects.toThrow(
      /attempt to write a readonly database/,
    );
    await worker.read("SELECT name FROM widget ORDER BY name");
    const after = sweepPlatformStores(database, join(path, ".."));

    expect(after.stores).toEqual(before.stores);
    expect(addedPaths(before, after)).toEqual([]);
  });

  test("the worker's connection runs on the SQLite runtime the main thread pinned", async () => {
    const { path, database } = seeded();
    const expected = database.query("SELECT sqlite_version() AS version").get() as {
      version: string;
    };

    const [row] = await start(path).read("SELECT sqlite_version() AS version");

    expect(row?.version).toBe(expected.version);
  });
});

describe("the query worker's lifetime", () => {
  afterEach(release);

  test("the platform search normalizer did not come with the connection", async () => {
    const { path } = seeded();

    // Not a preference — registering it on this thread segfaults, for the reason
    // `query-worker-thread.ts` records. Asserted so the day it changes is deliberate.
    await expect(start(path).read("SELECT platform_search_normalize('x') AS n")).rejects.toThrow(
      /no such function: platform_search_normalize/,
    );
  });

  test("refuses a second read while one is still running", async () => {
    const { path } = seeded();
    const worker = start(path);

    const first = worker.read("SELECT 1 AS ok");
    await expect(worker.read("SELECT 2 AS ok")).rejects.toThrow(QueryWorkerBusyError);

    expect(await first).toEqual([{ ok: 1 }]);
  });

  test("a closed worker refuses further reads", async () => {
    const { path } = seeded();
    const worker = start(path);
    await worker.read("SELECT 1 AS ok");

    worker.close();

    await expect(worker.read("SELECT 1 AS ok")).rejects.toThrow(QueryWorkerClosedError);
  });

  test("closing terminates the thread once, however many times it is asked to", async () => {
    const { path } = seeded();
    const RealWorker = globalThis.Worker;
    let terminated = 0;
    class CountingWorker extends RealWorker {
      override terminate() {
        terminated += 1;
        return super.terminate();
      }
    }

    globalThis.Worker = CountingWorker as unknown as typeof Worker;
    try {
      const worker = start(path);
      await worker.read("SELECT 1 AS ok");
      worker.close();
      worker.close();
    } finally {
      globalThis.Worker = RealWorker;
    }

    // Every other `close()` assertion here is satisfied by `end()` rejecting the pending reads, so
    // a `close()` leaving the thread running would still pass — decision 10's kill is `terminate`.
    expect(terminated).toBe(1);
  });

  test("a worker that cannot open reports a dead worker, not a refused statement", async () => {
    const worker = start(join(tmpdir(), "omni-crud-query-worker-absent", "nothing.db"));

    await expect(worker.read("SELECT 1 AS ok")).rejects.toThrow(QueryWorkerClosedError);
    await expect(worker.read("SELECT 1 AS ok")).rejects.toThrow(QueryWorkerClosedError);
  });
});

describe("the query worker's connection cannot leave its own file", () => {
  afterEach(release);

  test("refuses VACUUM, which a read-only connection would otherwise honour", async () => {
    const { path } = seeded();
    const leaked = join(path, "..", "leaked.db");

    await expect(start(path).read(`VACUUM INTO '${leaked}'`)).rejects.toThrow(
      QueryWorkerStatementError,
    );

    // The guarantee is the absent file, not the message: read-only SQLite writes this one.
    expect(existsSync(leaked)).toBe(false);
  });

  test("refuses ATTACH, which PRAGMA query_only would otherwise honour", async () => {
    const { path } = seeded();
    const worker = start(path);

    await expect(worker.read(`ATTACH DATABASE '${path}' AS other`)).rejects.toThrow(
      QueryWorkerStatementError,
    );

    // Its own file and nothing else, which is the whole claim.
    expect(await worker.read("SELECT name FROM pragma_database_list")).toEqual([{ name: "main" }]);
  });

  test("refuses PRAGMA, so the guard cannot be turned off from a statement", async () => {
    const { path } = seeded();
    const worker = start(path);

    await expect(worker.read("PRAGMA query_only = OFF")).rejects.toThrow(QueryWorkerStatementError);

    expect(await worker.read("SELECT * FROM pragma_query_only")).toEqual([{ query_only: 1 }]);
  });

  test("refuses a temp table, which would otherwise spill to disk unbounded", async () => {
    const { path } = seeded();

    await expect(start(path).read("CREATE TEMP TABLE spill (n INTEGER)")).rejects.toThrow(
      /attempt to write a readonly database/,
    );
  });

  test("refuses a second statement rather than silently dropping it", async () => {
    const { path } = seeded();

    await expect(start(path).read("SELECT 1 AS ok; VACUUM INTO 'x.db'")).rejects.toThrow(
      /one statement at a time/,
    );
  });

  test("reads a semicolon inside a literal as data, not as a second statement", async () => {
    const { path } = seeded();

    const rows = await start(path).read("SELECT ';  ATTACH' AS text, 1 AS ok;");

    expect(rows).toEqual([{ text: ";  ATTACH", ok: 1 }]);
  });
});
