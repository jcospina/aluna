import { describe, expect, test } from "bun:test";

import {
  createMutationCoordinator,
  MutationOwnershipError,
  MutationReservationCancelledError,
  MutationReservationExpiredError,
} from "./index.ts";

function idSequence(): () => string {
  let next = 0;
  return () => String(++next);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  test("reservation expiry and abort cancellation remove only the owned queued ticket", async () => {
    const coordinator = createMutationCoordinator({
      buildReservationTtlMs: 20,
      createId: idSequence(),
    });
    const recordLease = coordinator.tryAcquireRecordWrite();
    expect(recordLease).toBeDefined();

    const expiring = coordinator.reserveBuild();
    await expect(coordinator.acquireBuild(expiring)).rejects.toBeInstanceOf(
      MutationReservationExpiredError,
    );

    const cancelled = coordinator.reserveBuild();
    const controller = new AbortController();
    const cancelledLease = coordinator.acquireBuild(cancelled, { signal: controller.signal });
    controller.abort();
    await expect(cancelledLease).rejects.toBeInstanceOf(MutationReservationCancelledError);

    expect(recordLease && coordinator.release(recordLease)).toBe(true);
    expect(coordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
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
