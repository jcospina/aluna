import { describe, expect, test } from "bun:test";

import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import {
  deliverActivatedPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
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

  test("a timed-out write cannot unlock late commit or done events", async () => {
    const events: string[] = [];
    const delivered = await deliverActivatedPresentation(
      async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        events.push(event);
      },
      "preview",
      "fragment",
      5,
    );

    expect(delivered).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events).toEqual(["commit-preview"]);
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
      '<div data-build-restoration="neutral"></div>',
      20,
    );

    expect(delivered).toBe(true);
    expect(events.map(({ event }) => event)).toEqual([
      "build-error-preview",
      "narration",
      "fragment",
      "done",
    ]);
    expect(JSON.parse(events[0]?.data ?? "")).toMatchObject({
      kind: "build-error-preview",
      status: "failed",
      errorName: "Error",
      message: failure.message,
    });
    expect(events[1]?.data).toMatch(/mind trying again/i);
    expect(events[1]?.data).not.toMatch(/behavioral|gate|internal/i);
    expect(events[2]?.data).toContain('data-build-restoration="neutral"');
    expect(events[3]?.data).toBe("error");
  });
});

describe("deliverRestoredPresentation", () => {
  test("maps semantic restoration outcomes onto ADR-0002 done data", async () => {
    const events: Array<{ event: string; data: string }> = [];
    const send = async (event: string, data: string) => {
      events.push({ event, data });
    };
    const fragment = '<div data-build-restoration="capability"></div>';

    await deliverRestoredPresentation(send, fragment, "no_change");
    await deliverRestoredPresentation(send, fragment, "stale");
    await deliverRestoredPresentation(send, fragment, "cancelled");

    expect(events).toEqual([
      { event: "fragment", data: fragment },
      { event: "done", data: "ok" },
      { event: "fragment", data: fragment },
      { event: "done", data: "error" },
      { event: "fragment", data: fragment },
      { event: "done", data: "error" },
    ]);
  });

  test("bounds optional deflection narration with the restoration sequence", async () => {
    const events: string[] = [];
    const delivered = await deliverRestoredPresentation(
      async (event) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        events.push(event);
      },
      '<div data-build-restoration="neutral"></div>',
      "ok",
      5,
      { narration: "Warm deflection." },
    );

    expect(delivered).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events).toEqual(["narration"]);
  });

  test("sends finalized metrics before a cancelled restoration", async () => {
    const events: Array<{ event: string; data: string }> = [];
    await deliverRestoredPresentation(
      async (event, data) => void events.push({ event, data }),
      '<div data-build-restoration="neutral"></div>',
      "cancelled",
      20,
      { metricsPreview: '{"lifecycleStatus":"failed","outcome":"cancelled"}' },
    );

    expect(events.map(({ event }) => event)).toEqual(["metrics-preview", "fragment", "done"]);
    expect(events[0]?.data).toContain('"outcome":"cancelled"');
  });
});
