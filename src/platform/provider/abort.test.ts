import { expect, test } from "bun:test";
import { type ZodType, z } from "zod";

import { createMutationCoordinator } from "../../mutation-coordinator/index.ts";
import { abortableProvider, ProviderAbortedError } from "./abort.ts";
import type { GenerateResult, Provider } from "./contract.ts";

/** A provider whose handles never settle, so only the abort path can resolve them. */
function neverSettlingProvider(object?: Promise<unknown>): Provider {
  const never = new Promise<never>(() => undefined);
  return {
    generate<T>(): GenerateResult<T> {
      return {
        partialStream: {
          [Symbol.asyncIterator]() {
            return { next: () => never };
          },
        },
        object: (object ?? never) as Promise<T>,
        usage: never,
      };
    },
  };
}

test("an aborted provider wait exits the active build body and releases its lease", async () => {
  const never = new Promise<never>(() => undefined);
  const provider: Provider = {
    generate<T>(): GenerateResult<T> {
      return {
        partialStream: {
          [Symbol.asyncIterator]() {
            return { next: () => never };
          },
        },
        object: never,
        usage: never,
      };
    },
  };
  const controller = new AbortController();
  const coordinator = createMutationCoordinator();
  const reservation = coordinator.reserveBuild();
  const build = coordinator.withBuildLease(
    reservation,
    async () => {
      const result = abortableProvider(provider, controller.signal).generate(
        "wait forever",
        z.string(),
      );
      await result.object;
    },
    { signal: controller.signal },
  );

  expect(coordinator.snapshot().activeLease?.kind).toBe("build");
  controller.abort();
  await expect(build).rejects.toHaveProperty("name", "AbortError");
  expect(coordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
});

test("lease expiry aborts a hung provider and leaves later writes available", async () => {
  const coordinator = createMutationCoordinator({ buildLeaseTtlMs: 20 });
  const reservation = coordinator.reserveBuild();
  const build = coordinator.withBuildLease(reservation, async (lease) => {
    const result = abortableProvider(neverSettlingProvider(), lease.signal).generate(
      "wait forever",
      z.string(),
    );
    await result.object;
  });

  await expect(build).rejects.toBeInstanceOf(ProviderAbortedError);
  expect(coordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  const recordLease = coordinator.tryAcquireRecordWrite();
  expect(recordLease).toBeDefined();
  expect(recordLease && coordinator.release(recordLease)).toBe(true);
});

test("abort also stops a usage wait after the provider object has resolved", async () => {
  const controller = new AbortController();
  const provider = neverSettlingProvider(Promise.resolve("ready"));
  const result = abortableProvider(provider, controller.signal).generate("wait", z.string());

  expect(await result.object).toBe("ready");
  controller.abort();
  await expect(result.usage).rejects.toHaveProperty("name", "AbortError");
});

test("a non-Error abort reason still rejects as a named provider abort", async () => {
  // The two cases above abort with no reason, so `signal.reason` is a DOMException
  // and the wrapper simply forwards it. A caller that aborts with a plain value
  // takes the other branch, which must still produce a typed platform error rather
  // than rejecting with a bare string.
  const controller = new AbortController();
  const result = abortableProvider(neverSettlingProvider(), controller.signal).generate(
    "wait forever",
    z.string(),
  );

  controller.abort("shutting down");

  await expect(result.object).rejects.toBeInstanceOf(ProviderAbortedError);
  await expect(result.object).rejects.toHaveProperty("name", "ProviderAbortedError");
});

test("an already-aborted wrapper never initiates underlying provider work", () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const provider: Provider = {
    generate<T>(): GenerateResult<T> {
      calls += 1;
      return neverSettlingProvider().generate("", z.unknown() as ZodType<T>);
    },
  };

  expect(() =>
    abortableProvider(provider, controller.signal).generate("must not start", z.string()),
  ).toThrow();
  expect(calls).toBe(0);
});
