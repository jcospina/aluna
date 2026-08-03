import { describe, expect, test } from "bun:test";

import {
  type CapabilityIncarnation,
  createReadGateCoordinator,
  ReadGateDrainTimeoutError,
  ReadGateUnavailableError,
} from "./index.ts";

const A = { capabilityId: "a", incarnationId: "incarnation-a" } as const;
const B = { capabilityId: "b", incarnationId: "incarnation-b" } as const;
const C = { capabilityId: "c", incarnationId: "incarnation-c" } as const;

function input(
  incarnations: readonly CapabilityIncarnation[],
  catalog: readonly CapabilityIncarnation[] = [A, B, C],
) {
  return { catalog, incarnations };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ReadGateCoordinator atomic admission and draining", () => {
  test("a closing member refuses an atomic multi-incarnation set without tracking any member", async () => {
    const coordinator = createReadGateCoordinator();
    coordinator.synchronizeCatalog([A, B, C]);
    const closing = await coordinator.closeAndDrain(B);

    expect(coordinator.tryAcquire(input([A, B]))).toBeUndefined();
    expect(coordinator.snapshot()).toEqual([
      { ...A, state: "active", readerCount: 0 },
      { ...B, state: "closing", readerCount: 0 },
      { ...C, state: "active", readerCount: 0 },
    ]);

    const uninvolved = coordinator.tryAcquire(input([A, C]));
    expect(uninvolved).toBeDefined();
    expect(coordinator.snapshot().filter(({ readerCount }) => readerCount > 0)).toEqual([
      { ...A, state: "active", readerCount: 1 },
      { ...C, state: "active", readerCount: 1 },
    ]);
    expect(uninvolved && coordinator.release(uninvolved)).toBe(true);
    expect(coordinator.reopen(closing)).toBe(true);
  });

  test("missing and stale catalog members also refuse the whole set", () => {
    const coordinator = createReadGateCoordinator();
    const staleB = { ...B, incarnationId: "old-b" };

    expect(coordinator.tryAcquire(input([A, B], [A]))).toBeUndefined();
    expect(coordinator.tryAcquire(input([A, staleB]))).toBeUndefined();
    expect(coordinator.snapshot()).toEqual([
      { ...A, state: "active", readerCount: 0 },
      { ...B, state: "active", readerCount: 0 },
      { ...C, state: "active", readerCount: 0 },
    ]);
  });

  test("closing signals existing sets and drains only after the exact owner releases", async () => {
    const coordinator = createReadGateCoordinator({ drainTimeoutMs: 100 });
    const tokens = coordinator.tryAcquire(input([A, B]));
    expect(tokens).toBeDefined();

    const drain = coordinator.closeAndDrain(B);
    expect(tokens?.signal.aborted).toBe(true);
    expect(coordinator.tryAcquire(input([B]))).toBeUndefined();
    expect(coordinator.snapshot().find(({ capabilityId }) => capabilityId === "b")).toMatchObject({
      state: "closing",
      readerCount: 1,
    });

    await wait(0);
    expect(coordinator.release(tokens as NonNullable<typeof tokens>)).toBe(true);
    const closing = await drain;
    expect(coordinator.snapshot().find(({ capabilityId }) => capabilityId === "b")).toMatchObject({
      state: "closing",
      readerCount: 0,
    });
    expect(coordinator.reopen(closing)).toBe(true);
  });

  test("timeout reopens in finally and admits new reads while the old owner remains tracked", async () => {
    const coordinator = createReadGateCoordinator({ drainTimeoutMs: 5 });
    const oldTokens = coordinator.tryAcquire(input([A]));
    expect(oldTokens).toBeDefined();

    await expect(coordinator.closeAndDrain(A)).rejects.toBeInstanceOf(ReadGateDrainTimeoutError);
    expect(coordinator.snapshot()[0]).toEqual({ ...A, state: "active", readerCount: 1 });

    const newTokens = coordinator.tryAcquire(input([A]));
    expect(newTokens).toBeDefined();
    expect(coordinator.release(oldTokens as NonNullable<typeof oldTokens>)).toBe(true);
    expect(newTokens && coordinator.release(newTokens)).toBe(true);
  });
});

describe("ReadGateCoordinator ownership and recovery", () => {
  test("stale, duplicated, and already-released ownership cannot decrement a later reader", () => {
    const coordinator = createReadGateCoordinator();
    const first = coordinator.tryAcquire(input([A, A]));
    expect(first).toBeDefined();
    if (!first) throw new Error("expected initial read ownership");
    expect(first.incarnations).toEqual([A]);
    let reentrantRelease: boolean | undefined;
    first.signal.addEventListener("abort", () => {
      reentrantRelease = coordinator.release(first);
    });
    expect(coordinator.release(first)).toBe(true);
    expect(reentrantRelease).toBe(false);
    expect(first.signal.aborted).toBe(true);

    const second = coordinator.tryAcquire(input([A]));
    expect(second).toBeDefined();
    expect(first && coordinator.release(first)).toBe(false);
    expect(coordinator.snapshot()[0]?.readerCount).toBe(1);
    expect(second && coordinator.release(second)).toBe(true);
    expect(second && coordinator.release(second)).toBe(false);
  });

  test("one finally path releases success, failure, and close-signalled cancellation", async () => {
    const coordinator = createReadGateCoordinator({ drainTimeoutMs: 100 });
    await expect(coordinator.withTokens(input([A]), async () => "ok")).resolves.toBe("ok");
    await expect(
      coordinator.withTokens(input([A]), async () => {
        throw new Error("read failed");
      }),
    ).rejects.toThrow("read failed");

    const cancelled = coordinator.withTokens(
      input([A]),
      (tokens) =>
        new Promise<never>((_resolve, reject) => {
          tokens.signal.addEventListener(
            "abort",
            () => reject(tokens.signal.reason ?? new Error("cancelled")),
            { once: true },
          );
        }),
    );
    const closing = coordinator.closeAndDrain(A);
    await expect(cancelled).rejects.toThrow(/closing/i);
    const closingLease = await closing;
    expect(coordinator.snapshot()[0]?.readerCount).toBe(0);
    expect(coordinator.reopen(closingLease)).toBe(true);
  });

  test("boot recovery invalidates crashed ownership and reopens only the active catalog", async () => {
    const coordinator = createReadGateCoordinator();
    const staleTokens = coordinator.tryAcquire(input([A]));
    const closingPromise = coordinator.closeAndDrain(A, { timeoutMs: 100 });
    expect(staleTokens?.signal.aborted).toBe(true);

    coordinator.recoverAtBoot([A, C]);
    await expect(closingPromise).rejects.toBeInstanceOf(ReadGateDrainTimeoutError);
    expect(coordinator.release(staleTokens as NonNullable<typeof staleTokens>)).toBe(false);
    expect(coordinator.snapshot()).toEqual([
      { ...A, state: "active", readerCount: 0 },
      { ...C, state: "active", readerCount: 0 },
    ]);
    expect(coordinator.tryAcquire(input([A], [A, C]))).toBeDefined();
  });

  test("withTokens refuses before the operation begins when any member is unavailable", async () => {
    const coordinator = createReadGateCoordinator();
    coordinator.synchronizeCatalog([A, B]);
    const closing = await coordinator.closeAndDrain(B);
    let began = false;

    await expect(
      coordinator.withTokens(input([A, B], [A, B]), () => {
        began = true;
      }),
    ).rejects.toBeInstanceOf(ReadGateUnavailableError);
    expect(began).toBe(false);
    expect(coordinator.reopen(closing)).toBe(true);
  });
});
