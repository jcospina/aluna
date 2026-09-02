import { describe, expect, test } from "bun:test";

import {
  createMutationCoordinator,
  MutationLeaseExpiredError,
  MutationOwnershipError,
  MutationReservationCancelledError,
} from "./index.ts";

function idSequence(): () => string {
  let next = 0;
  return () => String(++next);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertExpiredLeaseUnblocksQueue(): Promise<void> {
  const coordinator = createMutationCoordinator({
    buildLeaseTtlMs: 20,
    createId: idSequence(),
  });
  const firstTicket = coordinator.reserveBuild();
  const secondTicket = coordinator.reserveBuild();
  let firstLeaseSignal: AbortSignal | undefined;
  let firstLeaseId: string | undefined;
  let leaseExpired!: () => void;
  const firstLeaseExpired = new Promise<void>((resolve) => {
    leaseExpired = resolve;
  });
  let finishCleanup!: () => void;
  const cleanupFinished = new Promise<void>((resolve) => {
    finishCleanup = resolve;
  });

  const firstBuild = coordinator.withBuildLease(firstTicket, async (lease) => {
    firstLeaseId = lease.leaseId;
    firstLeaseSignal = lease.signal;
    lease.signal.addEventListener("abort", leaseExpired, { once: true });
    await new Promise<void>((resolve) => {
      lease.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    await cleanupFinished;
    throw lease.signal.reason;
  });
  const secondLeasePromise = coordinator.acquireBuild(secondTicket);
  let secondAcquired = false;
  void secondLeasePromise.then(() => {
    secondAcquired = true;
  });

  await firstLeaseExpired;
  expect(firstLeaseSignal?.aborted).toBe(true);
  expect(firstLeaseSignal?.reason).toBeInstanceOf(MutationLeaseExpiredError);
  expect(coordinator.snapshot().activeLease?.leaseId).toBe(firstLeaseId);
  await Promise.resolve();
  expect(secondAcquired).toBe(false);
  finishCleanup();
  await expect(firstBuild).rejects.toBeInstanceOf(MutationLeaseExpiredError);

  const secondLease = await secondLeasePromise;
  expect(secondLease.kind).toBe("build");
  expect(coordinator.snapshot().activeLease?.leaseId).toBe(secondLease.leaseId);
  expect(coordinator.release(secondLease)).toBe(true);
}

describe("MutationCoordinator", () => {
  test("admits build reservations FIFO and a stale lease cannot release the next owner", async () => {
    const coordinator = createMutationCoordinator({ createId: idSequence() });
    const firstTicket = coordinator.reserveBuild();
    const secondTicket = coordinator.reserveBuild();

    const firstLease = await coordinator.acquireBuild(firstTicket);
    const secondLeasePromise = coordinator.acquireBuild(secondTicket);

    expect(firstLease.kind).toBe("build");
    expect(coordinator.snapshot()).toMatchObject({
      queuedTickets: [{ ticketId: secondTicket.ticketId, kind: "build" }],
      activeLease: { leaseId: firstLease.leaseId, kind: "build" },
    });
    expect(coordinator.tryAcquireRecordWrite()).toBeUndefined();

    expect(coordinator.release(firstLease)).toBe(true);
    const secondLease = await secondLeasePromise;
    expect(coordinator.release(firstLease)).toBe(false);
    expect(coordinator.snapshot().activeLease?.leaseId).toBe(secondLease.leaseId);
    expect(coordinator.release(secondLease)).toBe(true);
  });

  test("record writes cannot pass a queued build even before it acquires the lease", () => {
    const coordinator = createMutationCoordinator({ createId: idSequence() });
    const ticket = coordinator.reserveBuild();

    expect(coordinator.snapshot().queuedTickets).toHaveLength(1);
    expect(coordinator.tryAcquireRecordWrite()).toBeUndefined();
    expect(coordinator.cancelBuild(ticket)).toBe(true);

    const recordLease = coordinator.tryAcquireRecordWrite();
    expect(recordLease?.kind).toBe("record");
    expect(recordLease && coordinator.release(recordLease)).toBe(true);
  });

  test("one build reservation can have only one acquisition owner", async () => {
    const coordinator = createMutationCoordinator({ createId: idSequence() });
    const blocker = coordinator.tryAcquireRecordWrite();
    expect(blocker).toBeDefined();
    const ticket = coordinator.reserveBuild();

    const firstAcquisition = coordinator.acquireBuild(ticket);
    await expect(coordinator.acquireBuild(ticket)).rejects.toBeInstanceOf(MutationOwnershipError);

    expect(blocker && coordinator.release(blocker)).toBe(true);
    const buildLease = await firstAcquisition;
    expect(coordinator.snapshot().activeLease?.leaseId).toBe(buildLease.leaseId);
    expect(coordinator.release(buildLease)).toBe(true);
  });

  test("platform writes wait behind builds and release their short lease in finally", async () => {
    const coordinator = createMutationCoordinator({ createId: idSequence() });
    const ticket = coordinator.reserveBuild();
    const buildLease = await coordinator.acquireBuild(ticket);
    const order: string[] = [];

    const platformWrite = coordinator.withPlatformWrite(() => {
      order.push("platform");
      throw new Error("write failed");
    });
    await wait(0);

    expect(order).toEqual([]);
    expect(coordinator.snapshot().queuedTickets).toMatchObject([{ kind: "platform" }]);
    coordinator.release(buildLease);
    await expect(platformWrite).rejects.toThrow("write failed");
    expect(order).toEqual(["platform"]);
    expect(coordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });
});

describe("MutationCoordinator — reservation lifetimes", () => {
  // The reservation TTL bounds *abandonment*, not queueing: a build reservation blocks the
  // head of the queue until its owner asks for the lease, so one whose owner never comes
  // back has to time out. An owner that is waiting is not abandonment.
  test("an abandoned reservation expires and stops blocking the queue", async () => {
    const coordinator = createMutationCoordinator({
      buildReservationTtlMs: 20,
      createId: idSequence(),
    });
    const recordLease = coordinator.tryAcquireRecordWrite();
    expect(recordLease).toBeDefined();

    // Reserved and then never acquired — the caller went away between the two.
    const abandoned = coordinator.reserveBuild();
    expect(coordinator.snapshot().queuedTickets).toMatchObject([{ kind: "build" }]);
    await wait(40);
    expect(coordinator.snapshot().queuedTickets).toEqual([]);
    await expect(coordinator.acquireBuild(abandoned)).rejects.toBeInstanceOf(
      MutationOwnershipError,
    );

    const cancelled = coordinator.reserveBuild();
    const controller = new AbortController();
    const cancelledLease = coordinator.acquireBuild(cancelled, { signal: controller.signal });
    controller.abort();
    await expect(cancelledLease).rejects.toBeInstanceOf(MutationReservationCancelledError);

    expect(recordLease && coordinator.release(recordLease)).toBe(true);
    expect(coordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  // The defect this replaced: the clock started at `reserveBuild()` and kept running while
  // the ticket waited, so the second of two concurrent builds always died at 30s with
  // `MutationReservationExpiredError` — shown to the person as "Hmm, that didn't work" after
  // they had waited and paid for a resolver call. A real build takes minutes.
  test("a queued build waits for the lease however long the holder takes", async () => {
    const coordinator = createMutationCoordinator({
      buildReservationTtlMs: 20,
      createId: idSequence(),
    });
    const first = coordinator.reserveBuild();
    const second = coordinator.reserveBuild();

    const firstLease = await coordinator.acquireBuild(first);
    const queued = coordinator.acquireBuild(second);

    // Well past the reservation TTL, and the ticket is still queued rather than expired.
    await wait(60);
    expect(coordinator.snapshot().queuedTickets).toMatchObject([
      { kind: "build", expiresAt: null },
    ]);

    coordinator.release(firstLease);
    const secondLease = await queued;
    expect(secondLease.kind).toBe("build");
    expect(coordinator.release(secondLease)).toBe(true);
  });

  test("build failure releases in finally and active ownership is distinct from cancellation", async () => {
    const coordinator = createMutationCoordinator({ createId: idSequence() });
    const ticket = coordinator.reserveBuild();

    await expect(
      coordinator.withBuildLease(ticket, () => {
        expect(coordinator.cancelBuild(ticket)).toBe(false);
        throw new Error("aborted build");
      }),
    ).rejects.toThrow("aborted build");

    expect(coordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
    expect(coordinator.cancelBuild(ticket)).toBe(false);
  });

  test("an expired active lease aborts its owner and admits the next queued build", () =>
    assertExpiredLeaseUnblocksQueue());

  test("capability deletion never queues and refuses any queued build or active owner", async () => {
    const coordinator = createMutationCoordinator({ createId: idSequence() });
    const ticket = coordinator.reserveBuild();

    expect(coordinator.tryAcquireDeletion()).toBeUndefined();
    const buildLease = await coordinator.acquireBuild(ticket);
    expect(coordinator.tryAcquireDeletion()).toBeUndefined();
    coordinator.release(buildLease);

    const deletionLease = coordinator.tryAcquireDeletion();
    expect(deletionLease?.kind).toBe("deletion");
    expect(coordinator.tryAcquireDeletion()).toBeUndefined();
    expect(deletionLease && coordinator.release(deletionLease)).toBe(true);
    expect(coordinator.snapshot().queuedTickets).toEqual([]);
  });
});
