import { expect, test } from "bun:test";
import { z } from "zod";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import { abortableProvider } from "./abort.ts";
import type { GenerateResult, Provider } from "./contract.ts";

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

test("abort also stops a usage wait after the provider object has resolved", async () => {
  const never = new Promise<never>(() => undefined);
  const provider: Provider = {
    generate<T>(): GenerateResult<T> {
      return {
        partialStream: {
          [Symbol.asyncIterator]() {
            return { next: () => never };
          },
        },
        object: Promise.resolve("ready" as T),
        usage: never,
      };
    },
  };
  const controller = new AbortController();
  const result = abortableProvider(provider, controller.signal).generate("wait", z.string());

  expect(await result.object).toBe("ready");
  controller.abort();
  await expect(result.usage).rejects.toHaveProperty("name", "AbortError");
});
