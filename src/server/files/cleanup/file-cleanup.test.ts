import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS } from "../../../lifecycle/deletion/index.ts";
import { until } from "../../../platform/async.test-support.ts";
import { CLEANUP_ERROR_MAX_LENGTH } from "../../../platform/errors.ts";
import { seedFileLedgerRow } from "../../../platform/files/store/ledger.test-support.ts";
import { FILE_LEDGER_TABLE, readFileLedgerRow } from "../../../platform/files/store/ledger.ts";
import {
  createLocalObjectStore,
  type ObjectStore,
} from "../../../platform/files/store/object-store.ts";
import { STAGING_DIRECTORY } from "../../../platform/files/store/object-store-root.ts";
import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../platform/persistence/scratch-db.test-support.ts";
import {
  createMutationCoordinator,
  type MutationCoordinator,
} from "../../../runtime/concurrency/mutation-coordinator.ts";
import { EXHAUSTED_ATTEMPTS, seedEnqueuedFile } from "./file-cleanup.test-support.ts";
import { createFileCleanupWorker, type FileCleanupOptions } from "./file-cleanup.ts";

let env: ScratchDbEnv;
let coordinator: MutationCoordinator;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-file-cleanup-");
  coordinator = createMutationCoordinator();
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

const root = () => join(env.dir, "storage");
const stagedPath = (key: string) => join(root(), STAGING_DIRECTORY, key);
const storedPath = (key: string) => join(root(), key);

const enqueued = (attempts = 0) => seedEnqueuedFile(env.conns.readwrite, attempts);
const HELD_OPEN = "EBUSY: the file is held open";

function place(key: string, where: "staged" | "stored" | "both" = "stored"): void {
  mkdirSync(join(root(), STAGING_DIRECTORY), { recursive: true });
  if (where !== "stored") writeFileSync(stagedPath(key), "staged bytes");
  if (where !== "staged") writeFileSync(storedPath(key), "stored bytes");
}

const row = (key: string) => readFileLedgerRow(env.conns.readwrite, key);
const onDisk = (key: string) => existsSync(stagedPath(key)) || existsSync(storedPath(key));

function worker(options: Partial<FileCleanupOptions> = {}) {
  return createFileCleanupWorker({
    databases: env.conns,
    objectStore: createLocalObjectStore(root()),
    mutationCoordinator: coordinator,
    schedule: () => {},
    ...options,
  });
}

/** A clock that moves only when a scheduled retry fires, and the delays each was scheduled at. */
function fakeClock() {
  let now = 0;
  const delays: number[] = [];
  const runs: { at: number; run: () => void }[] = [];
  return {
    delays,
    options: {
      now: () => now,
      schedule: (run: () => void, delayMs: number) => {
        delays.push(delayMs);
        runs.push({ at: now + delayMs, run });
      },
    },
    pending: () => runs.length,
    /** Move to the earliest scheduled retry, run it, and wait for its pass. */
    async fire(cleanup: { idle(): Promise<void> }) {
      runs.sort((a, b) => a.at - b.at);
      const next = runs.shift();
      if (!next) return;
      now = next.at;
      next.run();
      await cleanup.idle();
    },
  };
}

/** A store whose deletes wait until `release`, noting each key it was asked for. */
function heldStore() {
  let release = () => {};
  const unlinking = new Promise<void>((resolve) => (release = resolve));
  const deleted: string[] = [];
  const store: Pick<ObjectStore, "delete"> = {
    async delete(key) {
      deleted.push(key);
      await unlinking;
    },
  };
  return { store, deleted, release };
}

/** What `run` writes to `console.error`, one line per call, kept off the test's output. */
async function logged(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => lines.push(parts.map(String).join(" "));
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lines;
}

/** A store whose deletes fail with `error` until `heal` is called. */
function failingStore(error = HELD_OPEN) {
  const inner = createLocalObjectStore(root());
  let healed = false;
  const store: Pick<ObjectStore, "delete"> = {
    async delete(key) {
      if (!healed) throw new Error(error);
      await inner.delete(key);
    },
  };
  return { store, heal: () => (healed = true) };
}

describe("a pass over the ledger's queue", () => {
  test("unlinks both paths a key can occupy, and then deletes its row", async () => {
    const [both, stored, staged] = [enqueued(), enqueued(), enqueued()];
    place(both, "both");
    place(stored, "stored");
    place(staged, "staged");

    const outcomes = await worker().drain();

    expect(outcomes.map((outcome) => outcome.key).sort()).toEqual([both, stored, staged].sort());
    expect(outcomes.every((outcome) => outcome.error === undefined)).toBe(true);
    for (const key of [both, stored, staged]) {
      expect(onDisk(key)).toBe(false);
      expect(row(key)).toBeNull();
    }
  });

  test("counts a key whose bytes are already gone as cleaned", async () => {
    const key = enqueued();
    await worker().drain();
    expect(row(key)).toBeNull();
  });

  test("unlinks the staging path first, so stored bytes outlive a staged copy that will not go", async () => {
    const key = enqueued();
    place(key, "stored");
    mkdirSync(join(stagedPath(key), "held"), { recursive: true });

    const [outcome] = await worker().drain();

    expect(outcome?.error).toBeString();
    expect(existsSync(storedPath(key))).toBe(true);
    expect(row(key)).toMatchObject({ state: "cleanup_enqueued", cleanup_attempts: 1 });
  });

  test("touches no key that is pending or owned", async () => {
    const pending = seedFileLedgerRow(env.conns.readwrite, {
      capabilityId: "photos",
      incarnationId: "photos-1",
      field: "photo",
    });
    const owned = seedFileLedgerRow(env.conns.readwrite, {
      capabilityId: "photos",
      incarnationId: "photos-1",
      field: "photo",
      state: "owned",
    });
    place(pending);
    place(owned);

    expect(await worker().drain()).toEqual([]);
    expect([onDisk(pending), onDisk(owned)]).toEqual([true, true]);
  });

  test("never sees a key enqueued by a transaction that has not committed", async () => {
    const key = seedFileLedgerRow(env.conns.readwrite, {
      capabilityId: "photos",
      incarnationId: "photos-1",
      field: "photo",
      state: "owned",
    });
    place(key);
    const { readwrite } = env.conns;
    readwrite.exec("BEGIN IMMEDIATE TRANSACTION");
    readwrite.run(`UPDATE ${FILE_LEDGER_TABLE} SET state = 'cleanup_enqueued' WHERE key = ?`, [
      key,
    ]);
    const cleanup = worker();

    cleanup.wake();
    await cleanup.idle();
    readwrite.exec("ROLLBACK");

    expect(onDisk(key)).toBe(true);
    expect(row(key)).toMatchObject({ state: "owned" });
  });

  test("holds no lease while it unlinks, and writes the row under a platform write", async () => {
    const key = enqueued();
    const leases: (string | undefined)[] = [];
    const recordWrites: boolean[] = [];
    const store: Pick<ObjectStore, "delete"> = {
      async delete() {
        leases.push(coordinator.snapshot().activeLease?.kind);
        const lease = coordinator.tryAcquireRecordWrite();
        recordWrites.push(lease !== undefined);
        if (lease) coordinator.release(lease);
      },
    };
    const withPlatformWrite = coordinator.withPlatformWrite.bind(coordinator);
    coordinator.withPlatformWrite = (body, options) =>
      withPlatformWrite((held) => {
        leases.push(held.kind);
        return body(held);
      }, options);

    await worker({ objectStore: store }).drain();

    expect(leases).toEqual([undefined, "platform"]);
    expect(recordWrites).toEqual([true]);
    expect(row(key)).toBeNull();
  });
});

describe("a pass asked for while one runs", () => {
  test("a wake runs another once it ends", async () => {
    const first = enqueued();
    const { store, deleted, release } = heldStore();
    const cleanup = worker({ objectStore: store });

    cleanup.wake();
    await until(() => deleted.length === 1);
    const second = enqueued();
    cleanup.wake();
    release();
    await cleanup.idle();

    expect(deleted).toEqual([first, second]);
    expect([row(first), row(second)]).toEqual([null, null]);
  });

  test("a drain answers with the pass it was owed", async () => {
    const first = enqueued();
    const { store, deleted, release } = heldStore();
    const cleanup = worker({ objectStore: store });

    cleanup.wake();
    await until(() => deleted.length === 1);
    const second = enqueued();
    const drained = cleanup.drain();
    release();

    expect(await drained).toEqual([{ key: second }]);
    expect(row(first)).toBeNull();
  });
});

describe("a key whose cleanup fails", () => {
  test("keeps its row with the attempt counted and the error, and retries once at each delay", async () => {
    const key = enqueued();
    const clock = fakeClock();
    const { store } = failingStore();
    const cleanup = worker({ objectStore: store, ...clock.options });

    cleanup.wake();
    await cleanup.idle();
    for (let retry = 1; clock.pending() > 0; retry += 1) {
      expect(row(key)).toMatchObject({ cleanup_attempts: retry, cleanup_error: HELD_OPEN });
      await clock.fire(cleanup);
    }

    expect(clock.delays).toEqual([...DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS]);
    expect(row(key)).toMatchObject({
      state: "cleanup_enqueued",
      cleanup_attempts: EXHAUSTED_ATTEMPTS,
    });
  });

  test("spends none of its retries on wakes for other keys", async () => {
    const key = enqueued();
    const clock = fakeClock();
    const { store } = failingStore();
    const cleanup = worker({ objectStore: store, ...clock.options });

    for (let wakes = 0; wakes < EXHAUSTED_ATTEMPTS + 1; wakes += 1) {
      cleanup.wake();
      await cleanup.idle();
    }

    expect(row(key)).toMatchObject({ cleanup_attempts: 1 });
  });

  test("a fresh failure is retried at its own first delay, not behind a longer one", async () => {
    const [first] = DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS;
    const tired = enqueued(EXHAUSTED_ATTEMPTS - 2);
    const clock = fakeClock();
    const { store } = failingStore();
    const cleanup = worker({ objectStore: store, ...clock.options });
    await cleanup.drain();
    expect(row(tired)).toMatchObject({ cleanup_attempts: EXHAUSTED_ATTEMPTS - 1 });
    expect(clock.delays).toEqual(DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS.slice(-1));
    const fresh = enqueued();

    cleanup.wake();
    await cleanup.idle();

    expect(clock.delays.at(-1)).toBe(first);
    expect(row(fresh)).toMatchObject({ cleanup_attempts: 1 });
  });

  test("past its last retry waits for a pass that includes it, as a desk load asks", async () => {
    const tired = enqueued(EXHAUSTED_ATTEMPTS);
    const fresh = enqueued();
    const clock = fakeClock();
    const cleanup = worker(clock.options);

    cleanup.wake();
    await cleanup.idle();
    expect([row(tired)?.state, row(fresh)]).toEqual(["cleanup_enqueued", null]);
    expect(clock.pending()).toBe(0);

    await cleanup.drain();
    expect(row(tired)).toBeNull();
  });

  test("says so once, as its retries are spent, and not on every desk load after", async () => {
    const key = enqueued(EXHAUSTED_ATTEMPTS - 1);
    const { store } = failingStore();
    const cleanup = worker({ objectStore: store });
    const said = await logged(async () => {
      await cleanup.drain();
      await cleanup.drain();
    });
    expect(row(key)).toMatchObject({ cleanup_attempts: EXHAUSTED_ATTEMPTS + 1 });
    expect(said.filter((line) => line.includes(key))).toHaveLength(1);
  });

  test("a desk load leaves a key still waiting out its delay alone", async () => {
    const key = enqueued();
    const clock = fakeClock();
    const { store } = failingStore();
    const cleanup = worker({ objectStore: store, ...clock.options });

    cleanup.wake();
    await cleanup.idle();
    for (let loads = 0; loads < EXHAUSTED_ATTEMPTS; loads += 1) await cleanup.drain();

    expect(row(key)).toMatchObject({ cleanup_attempts: 1 });
  });

  test("goes once the cause clears, and leaves nothing scheduled behind it", async () => {
    const key = enqueued();
    const clock = fakeClock();
    const { store, heal } = failingStore();
    const cleanup = worker({ objectStore: store, ...clock.options });

    cleanup.wake();
    await cleanup.idle();
    heal();
    await clock.fire(cleanup);

    expect(row(key)).toBeNull();
    expect(clock.pending()).toBe(0);
  });

  test("a delete that hangs counts as a failed attempt, and the pass goes on", async () => {
    const [hung, next] = [enqueued(), enqueued()];
    const inner = createLocalObjectStore(root());
    const store: Pick<ObjectStore, "delete"> = {
      delete: (key) => (key === hung ? new Promise(() => {}) : inner.delete(key)),
    };

    const outcomes = await worker({ objectStore: store, deleteTimeoutMs: 5 }).drain();

    const failed = (key: string) => outcomes.find((outcome) => outcome.key === key)?.error;
    expect([failed(hung), failed(next)]).toEqual([expect.any(String), undefined]);
    expect(row(hung)).toMatchObject({ cleanup_attempts: 1 });
  });

  test("keeps no more of the error than the tombstone does", async () => {
    const key = enqueued();
    const { store } = failingStore("x".repeat(CLEANUP_ERROR_MAX_LENGTH * 2));
    await worker({ objectStore: store }).drain();
    expect(row(key)?.cleanup_error).toHaveLength(CLEANUP_ERROR_MAX_LENGTH);
  });
});

test("a pass that cannot write its outcomes retries on the delays, counted by passes, then stops", async () => {
  const key = enqueued();
  env.conns.readwrite.exec(
    `CREATE TRIGGER "disk_full" BEFORE DELETE ON ${FILE_LEDGER_TABLE}
     BEGIN SELECT RAISE(ABORT, 'disk full'); END;`,
  );
  const clock = fakeClock();
  const cleanup = worker(clock.options);

  await logged(async () => {
    cleanup.wake();
    await cleanup.idle();
    while (clock.pending() > 0) await clock.fire(cleanup);
  });

  expect(clock.delays).toEqual([...DEFAULT_DELETION_CLEANUP_RETRY_DELAYS_MS]);
  expect(row(key)).toMatchObject({ state: "cleanup_enqueued", cleanup_attempts: 0 });
});
