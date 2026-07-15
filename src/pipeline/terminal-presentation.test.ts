import { describe, expect, test } from "bun:test";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import { deliverActivatedPresentation } from "./terminal-presentation.ts";

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
