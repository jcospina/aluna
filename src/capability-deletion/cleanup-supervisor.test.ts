import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createReadGateCoordinator } from "../read-gates/index.ts";
import { getCapability, listCapabilityDeletionTombstones } from "../registry/index.ts";
import {
  install,
  notesRow,
  setupRouterTest,
  teardownRouterTest,
} from "../router/router.test-support.ts";
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
