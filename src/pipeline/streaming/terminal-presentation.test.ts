import { describe, expect, test } from "bun:test";

import { createMutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import { renderBuildEnding } from "../../web/index.ts";
import {
  CANDIDATE_NO_CHANGE_ENDING,
  CANDIDATE_REJECTED_ENDING,
  deliverActivatedPresentation,
  deliverCandidateNoChangePresentation,
  deliverCandidateRejectedPresentation,
  deliverFailedPresentation,
  deliverRestoredPresentation,
  deliverStalePresentation,
  FAILED_BUILD_ENDING,
  STALE_BUILD_ENDING,
} from "./terminal-presentation.ts";

/**
 * A write the test decides when to settle, so "the presenter is still in flight
 * when the bound expires" is a fact rather than a race against a real sleep.
 */
function blockingWrite(events: string[]) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    release,
    write: async (event: string) => {
      await released;
      events.push(event);
    },
  };
}

/**
 * Drain everything the released write schedules. Once it settles the rest of the
 * sequence is pure microtask work, so a single macrotask tick runs it to
 * completion — no duration is being guessed.
 */
function drainPendingWrites(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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
    // Resolving at all is the assertion: a presenter that never settles must not
    // hold the sequence open. An unbounded implementation hangs here until bun's
    // own per-test timeout fails the test.
    const delivered = await deliverActivatedPresentation(
      () => new Promise(() => undefined),
      "preview",
      "fragment",
      15,
    );

    expect(delivered).toBe(false);
  });

  test("a timed-out write cannot unlock late commit or done events", async () => {
    const events: string[] = [];
    const { write, release } = blockingWrite(events);
    const delivered = await deliverActivatedPresentation(write, "preview", "fragment", 5);

    // The bound expired with the very first write still in flight.
    expect(delivered).toBe(false);

    // Letting that write finish now must not reopen the sequence: it records its
    // own event, and commit/done stay unsent because the gate closed at teardown.
    release();
    await drainPendingWrites();
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
      "build-1",
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
    expect(events[1]?.data).toContain("data-build-ending");
    expect(events[1]?.data).not.toMatch(/behavioral|gate|internal/i);
    // The window holds on the ending, so the line is not also left behind as a notice
    // on the desk: the log is the live region and is where the person is already
    // looking (PLAN decision 23).
    expect(events[2]?.data).not.toContain("prompt-notice");
    expect(events[2]?.data).toBe('<div data-build-restoration="neutral"></div>');
    expect(events[3]?.data).toBe("error");
  });
});

/**
 * The three terminals that have something to tell you (PLAN decisions 23 and 25).
 *
 * Each one says its own thing — a failure, a refusal and a measured no-op are three
 * different pieces of news and get three authored lines, not one generic apology. Each
 * says it as the last thing the narration says, and each streams the restoration it is
 * not yet placing: the shell parks it until the ending is dismissed.
 */
describe("a terminal the window holds", () => {
  /** @returns the events one held terminal wrote, in order. */
  async function held(
    deliver: (send: (event: string, data: string) => Promise<void>) => Promise<boolean>,
  ) {
    const events: Array<{ event: string; data: string }> = [];
    await deliver(async (event, data) => {
      events.push({ event, data });
    });
    return events;
  }

  const BUILD_ID = "build-1";
  const RESTORATION = '<div data-build-restoration="capability"><p>collection</p></div>';

  const TERMINALS = [
    {
      name: "a build that failed",
      line: FAILED_BUILD_ENDING,
      deliver: (send: (event: string, data: string) => Promise<void>) =>
        deliverFailedPresentation(send, BUILD_ID, new Error("internal"), RESTORATION, 20),
    },
    {
      name: "a refusal as stale",
      line: STALE_BUILD_ENDING,
      deliver: (send: (event: string, data: string) => Promise<void>) =>
        deliverStalePresentation(send, BUILD_ID, RESTORATION, 20),
    },
    {
      name: "a measured no-op",
      line: CANDIDATE_NO_CHANGE_ENDING,
      deliver: (send: (event: string, data: string) => Promise<void>) =>
        deliverCandidateNoChangePresentation(send, BUILD_ID, "{}", RESTORATION, "{}", 20),
    },
    {
      name: "a candidate that could not be shaped",
      line: CANDIDATE_REJECTED_ENDING,
      deliver: (send: (event: string, data: string) => Promise<void>) =>
        deliverCandidateRejectedPresentation(send, BUILD_ID, "{}", RESTORATION, 20),
    },
  ] as const;

  test("the four authored lines are four different sentences", () => {
    expect(new Set(TERMINALS.map(({ line }) => line)).size).toBe(TERMINALS.length);
  });

  for (const { name, line, deliver } of TERMINALS) {
    test(`${name} ends the narration with its own line and holds the restoration`, async () => {
      const events = await held(deliver);
      const narration = events.filter((entry) => entry.event === "narration");
      const fragment = events.filter((entry) => entry.event === "fragment");

      expect(narration).toHaveLength(1);
      expect(narration[0]?.data).toBe(renderBuildEnding(BUILD_ID, line));
      expect(narration[0]?.data).toContain("data-build-ending");
      expect(narration[0]?.data).toContain("data-build-dismiss");

      expect(fragment).toHaveLength(1);
      expect(fragment[0]?.data).toBe(RESTORATION);
      expect(fragment[0]?.data).not.toContain("prompt-notice");

      // The ending is the last thing said, and nothing commits behind it.
      const names = events.map(({ event }) => event);
      expect(names.at(-1)).toBe("done");
      expect(names).not.toContain("commit");
      expect(names.indexOf("narration")).toBeLessThan(names.indexOf("fragment"));
    });
  }

  test("cancel leaves nothing to dismiss", async () => {
    const events = await held((send) =>
      deliverRestoredPresentation(send, RESTORATION, "cancelled", 20),
    );

    expect(events.map(({ event }) => event)).toEqual(["fragment", "done"]);
    expect(events.some(({ data }) => data.includes("data-build-ending"))).toBe(false);
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
    const { write, release } = blockingWrite(events);
    const delivered = await deliverRestoredPresentation(
      write,
      '<div data-build-restoration="neutral"></div>',
      "ok",
      5,
      { narration: "Warm deflection." },
    );

    // The bound expired while the narration write was still in flight; the
    // fragment and done that follow it must never reach a torn-down presenter.
    expect(delivered).toBe(false);

    release();
    await drainPendingWrites();
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
