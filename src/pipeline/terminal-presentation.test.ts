import { describe, expect, test } from "bun:test";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import {
  deliverActivatedPresentation,
  deliverFailedPresentation,
} from "./terminal-presentation.ts";

describe("deliverActivatedPresentation", () => {
  test("delivers the complete terminal presenter sequence", async () => {
    const events: string[] = [];
    const delivered = await deliverActivatedPresentation(
      async (event) => {
        events.push(event);
      },
      "preview",
      "fragment",
      20,
    );

    expect(delivered).toBe(true);
    expect(events).toEqual(["commit-preview", "commit", "done"]);
  });

  test("keeps build ownership through the complete terminal sequence", async () => {
    const coordinator = createMutationCoordinator();
    const reservation = coordinator.reserveBuild();
    const events: string[] = [];

    await coordinator.withBuildLease(reservation, () =>
      deliverActivatedPresentation(
        async (event) => {
          expect(coordinator.snapshot().activeLease?.kind).toBe("build");
          events.push(event);
        },
        "preview",
        "fragment",
      ),
    );

    expect(events).toEqual(["commit-preview", "commit", "done"]);
    expect(coordinator.snapshot().activeLease).toBeNull();
  });

  test("bounds a presenter that never settles after durable activation", async () => {
    const startedAt = performance.now();
    const delivered = await deliverActivatedPresentation(
      () => new Promise(() => undefined),
      "preview",
      "fragment",
      15,
    );

    expect(delivered).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(100);
  });
});

describe("deliverFailedPresentation", () => {
  test("delivers developer evidence before the product-safe terminal failure", async () => {
    const events: Array<{ event: string; data: string }> = [];
    const failure = new Error("Behavioral gate exposed internal evidence.");

    const delivered = await deliverFailedPresentation(
      async (event, data) => {
        events.push({ event, data });
      },
      failure,
      20,
    );

    expect(delivered).toBe(true);
    expect(events.map(({ event }) => event)).toEqual(["build-error-preview", "narration", "done"]);
    expect(JSON.parse(events[0]?.data ?? "")).toMatchObject({
      kind: "build-error-preview",
      status: "failed",
      errorName: "Error",
      message: failure.message,
    });
    expect(events[1]?.data).toMatch(/mind trying again/i);
    expect(events[1]?.data).not.toMatch(/behavioral|gate|internal/i);
    expect(events[2]?.data).toBe("error");
  });
});
