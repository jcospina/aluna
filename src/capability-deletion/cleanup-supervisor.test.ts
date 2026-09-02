import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import { getCapability, listCapabilityDeletionTombstones } from "../registry/index.ts";
import { createMutationCoordinator } from "../runtime/concurrency/mutation-coordinator.ts";
import { createReadGateCoordinator } from "../runtime/concurrency/read-gates.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../runtime/router/dispatch/router.test-support.ts";
import { createDeletionCleanupSupervisor } from "./cleanup-supervisor.ts";
import { destroyCapability, type OwnedResourceCleanupAdapter } from "./two-phase-destruction.ts";

/** An adapter whose cleanup fails until it is told to stop failing. */
function flakyAdapter(state: { fails: boolean; cleaned: number }): OwnedResourceCleanupAdapter {
  return {
    name: "resources",
    collect: () => ["one"],
    clean: () => {
      if (state.fails) throw new Error("the object store is unavailable");
      state.cleaned += 1;
    },
  };
}

describe("deletion cleanup supervisor", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });
  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  async function commitWithPendingCleanup(state: { fails: boolean; cleaned: number }) {
    const target = notesRow();
    install(conns, target);
    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters: [flakyAdapter(state)],
    });
    expect(result.status).toBe("cleanup_pending");
    // Logically gone regardless — cleanup failure never resurrects the capability.
    expect(getCapability(target.id, conns.readonly)).toBeNull();
    return target;
  }

  test("retries in-process until the cause clears, then releases the reserved id", async () => {
    const state = { fails: true, cleaned: 0 };
    await commitWithPendingCleanup(state);
    const pending: (() => void)[] = [];
    const supervisor = createDeletionCleanupSupervisor({
      database: conns.readwrite,
      adapters: [flakyAdapter(state)],
      mutationCoordinator: createMutationCoordinator(),
      retryDelaysMs: [1, 1, 1],
      schedule: (run) => pending.push(run),
    });

    supervisor.requestRetry();
    pending.shift()?.();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Still owed, and the reason is durable rather than a console line.
    expect(supervisor.pending()).toMatchObject([
      { capabilityId: "notes", attempts: 1, lastError: "the object store is unavailable" },
    ]);

    state.fails = false;
    await supervisor.runOnce();

    expect(listCapabilityDeletionTombstones(conns.readonly)).toEqual([]);
    expect(supervisor.pending()).toEqual([]);
    expect(state.cleaned).toBe(1);
  });

  test("a cause that never clears exhausts its backoff and is surfaced, not retried forever", async () => {
    const state = { fails: true, cleaned: 0 };
    await commitWithPendingCleanup(state);
    const supervisor = createDeletionCleanupSupervisor({
      database: conns.readwrite,
      adapters: [flakyAdapter(state)],
      mutationCoordinator: createMutationCoordinator(),
      retryDelaysMs: [1, 1],
      schedule: (run) => run(),
    });

    await supervisor.runOnce();
    await supervisor.runOnce();

    const [wedged] = supervisor.pending();
    expect(wedged).toMatchObject({
      capabilityId: "notes",
      attempts: 2,
      exhausted: true,
      lastError: "the object store is unavailable",
    });

    // Exhausted means no further timer is armed — this one needs a person.
    let scheduled = 0;
    const exhausted = createDeletionCleanupSupervisor({
      database: conns.readwrite,
      adapters: [flakyAdapter(state)],
      mutationCoordinator: createMutationCoordinator(),
      retryDelaysMs: [1, 1],
      schedule: () => {
        scheduled += 1;
      },
    });
    exhausted.requestRetry();
    expect(scheduled).toBe(0);

    // …and `forceRetry` is how that person asks. A desk load presses it, so refreshing the
    // page is the recovery gesture — the tombstone is still reserving the capability id.
    exhausted.forceRetry();
    expect(scheduled).toBe(1);
  });
});

describe("deletion cleanup supervisor — scheduling", () => {
  let dir: string;
  let conns: PlatformDatabase;

  beforeEach(() => {
    ({ dir, conns } = setupRouterTest());
  });
  afterEach(() => {
    teardownRouterTest(dir, conns);
  });

  async function commitWithPendingCleanup(state: { fails: boolean; cleaned: number }) {
    const target = notesRow();
    install(conns, target);
    const result = await destroyCapability({
      target,
      database: conns.readwrite,
      readonlyDatabase: conns.readonly,
      readGates: createReadGateCoordinator(),
      adapters: [flakyAdapter(state)],
    });
    expect(result.status).toBe("cleanup_pending");
    return target;
  }

  // The busy loop this replaced: while a build held the coordinator, `runOnce`
  // short-circuited on `running`, the chained `requestRetry` scheduled again, and — no
  // attempt having been counted — it scheduled at the *first* rung. One pass a second, for
  // as long as the build ran.
  test("a pass already in flight is not scheduled around, it is waited for", async () => {
    const state = { fails: true, cleaned: 0 };
    await commitWithPendingCleanup(state);
    const mutationCoordinator = createMutationCoordinator();
    const scheduledDelays: number[] = [];
    const supervisor = createDeletionCleanupSupervisor({
      database: conns.readwrite,
      adapters: [flakyAdapter(state)],
      mutationCoordinator,
      retryDelaysMs: [1, 5, 30],
      schedule: (_run, delayMs) => {
        scheduledDelays.push(delayMs);
      },
    });

    // A build holds the coordinator, so the pass parks inside `withPlatformWrite`.
    const build = mutationCoordinator.reserveBuild();
    const buildLease = await mutationCoordinator.acquireBuild(build);
    const parked = supervisor.runOnce();

    for (let i = 0; i < 5; i += 1) supervisor.requestRetry();
    expect(scheduledDelays).toEqual([]);

    mutationCoordinator.release(buildLease);
    await parked;

    // Exactly one retry, and at the rung the recorded attempt actually earned.
    expect(scheduledDelays).toEqual([5]);
  });

  test("cleanup runs under a platform write lease, never on a free connection", async () => {
    const state = { fails: false, cleaned: 0 };
    await commitWithPendingCleanup({ fails: true, cleaned: 0 });
    const mutationCoordinator = createMutationCoordinator();
    const supervisor = createDeletionCleanupSupervisor({
      database: conns.readwrite,
      adapters: [flakyAdapter(state)],
      mutationCoordinator,
    });

    const run = supervisor.runOnce();
    const sawLease = mutationCoordinator.snapshot().activeLease?.kind;
    await run;

    expect(sawLease).toBe("platform");
    expect(mutationCoordinator.snapshot().activeLease).toBeNull();
  });
});
