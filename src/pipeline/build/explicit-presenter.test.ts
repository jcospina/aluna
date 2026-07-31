// The explicit presenter's delivery bound — Module 4.8/03 (PLAN decisions 28, 29, 31;
// ADR-0002).
//
// Terminal delivery is bounded because the build lease is held for the whole of it, so a
// subscriber that stops reading must not hold mutation ownership open. That bound has a
// consequence the happy path never shows: delivery can stop part-way through the story.
//
// What the presenter may do about it is limited by the transport underneath. `sseTransport`
// serializes every write through one chain, so a write that stalled is still at the head of
// it and anything queued behind lands never. These cases pin the two decisions that follow:
// a non-activating terminal is let go rather than retried behind the stall, and an
// activation — the one outcome with something durable left to say — gets one more short
// attempt, but only while somebody is still listening.

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  createScratchDbEnv,
  makeMetricsRecorder,
  NOTES_INCARNATION_ID,
  notesCapabilityRow,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../app/app.test-support.ts";
import type { CommitCapabilityResult } from "../../builder/index.ts";
import type { BuildJob, SendBuildEvent } from "../jobs/build-jobs.ts";
import { STALE_BUILD_NOTICE } from "../streaming/terminal-presentation.ts";
import type { CoreBuildTerminal } from "./core-builder.ts";
import { createExplicitPresenter } from "./explicit-presenter.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("aluna-explicit-presenter-");
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

// Deliberately generous. Every stall case asserts the presenter returns in well under
// *two* bounds — the signature a second recovery window would leave — so the bound has to
// be large enough that ordinary scheduler noise under a loaded shard stays far below it.
const TIMEOUT_MS = 150;
/**
 * One write slow enough to overrun the bound on its own, and to still drain comfortably
 * inside the recovery's fresh window. Loading the whole delay onto a single event keeps the
 * case deterministic: with the delay spread across the sequence, which window's `done`
 * reaches the wire first is a race, and the test would be pinning the race rather than the
 * behaviour.
 */
const SLOW_WRITE_MS = 220;

const JOB: BuildJob = {
  id: "presenter-job",
  prompt: "add a due date and make it stand out",
  restoration: { kind: "neutral" },
  status: "running",
};

const STALE_TERMINAL: CoreBuildTerminal = {
  kind: "stale",
  refusal: {
    reason: "catalog_revision",
    incarnationId: null,
    capabilityId: null,
    expectedCatalogFingerprint: "sha256:before",
    actualCatalogFingerprint: "sha256:after",
  },
};

/**
 * An activated v1 as the Builder hands it over. Complete enough that the commit preview
 * and the View swap are both really rendered — a thinner stand-in would throw on the way
 * in and route these cases through `presentBuilt`'s catch instead of its delivery bound,
 * which is the branch under test.
 */
function builtTerminal(): CoreBuildTerminal {
  const row = notesCapabilityRow();
  return {
    kind: "built",
    incarnationId: NOTES_INCARNATION_ID,
    commit: {
      row,
      previousLabel: null,
      incarnationId: NOTES_INCARNATION_ID,
      version: 1,
      buildId: JOB.id,
      artifactsPath: "/tmp/aluna-presenter/notes/v1",
      snapshotVerified: true,
      snapshotContentDigest: `sha256:${"a".repeat(64)}`,
      manifest: { behavioral_tier: "off" },
      files: [],
    } as unknown as CommitCapabilityResult,
  };
}

interface FakeTransport {
  readonly send: SendBuildEvent;
  readonly events: { event: string; data: string }[];
}

/**
 * A transport with the one property that decides this file's answers: writes are
 * **serialized**, exactly as `sseTransport` serializes them. A fake that let each event
 * resolve independently would make a follow-up write look deliverable while a stalled one
 * sat at the head of the real chain — and would report the opposite conclusion.
 *
 * `stall` names an event whose write never completes (a reader that stopped consuming);
 * `slow` names one whose write is merely slow, on a chain that still drains.
 */
function serializedSend(options: { stall?: string; slow?: string } = {}): FakeTransport {
  const events: { event: string; data: string }[] = [];
  let writes: Promise<void> = Promise.resolve();
  const write = (event: string, data: string): Promise<void> => {
    if (event === options.stall) return new Promise<void>(() => undefined);
    return new Promise<void>((resolve) =>
      setTimeout(
        () => {
          events.push({ event, data });
          resolve();
        },
        event === options.slow ? SLOW_WRITE_MS : 0,
      ),
    );
  };
  return {
    events,
    send: (event, data) => {
      const next = writes.then(() => write(event, data));
      writes = next.catch(() => undefined);
      return next;
    },
  };
}

function presenterOver(transport: FakeTransport, canPresent = () => true) {
  return createExplicitPresenter({
    job: JOB,
    send: transport.send,
    canPresent,
    isAborted: () => false,
    buildDatabases: env.conns,
    recordMetrics: makeMetricsRecorder().recordMetrics,
    // The bound is the caller's precisely because the lease is held across it.
    terminalPresenterTimeoutMs: TIMEOUT_MS,
  });
}

test("a terminal that delivers completely sends exactly one done, last", async () => {
  const transport = serializedSend();

  const completion = await presenterOver(transport).present(STALE_TERMINAL);

  expect(completion).toBe("terminal-sent");
  expect(transport.events.map((entry) => entry.event)).toEqual(["narration", "fragment", "done"]);
  expect(transport.events[0]?.data).toContain(STALE_BUILD_NOTICE);
});

test("a stale terminal whose restoration stalls is let go rather than retried behind the stall", async () => {
  const transport = serializedSend({ stall: "fragment" });
  const startedAt = performance.now();

  const completion = await presenterOver(transport).present(STALE_TERMINAL);
  const elapsed = performance.now() - startedAt;

  expect(completion).toBe("terminal-sent");
  // The warm line landed before the reader went quiet; nothing after it could.
  expect(transport.events.map((entry) => entry.event)).toEqual(["narration"]);
  // The point of not retrying: mutation ownership is released after *one* bound, not two.
  // A second window would have queued its `done` behind the stall and bought nothing while
  // every queued build waited for it. The client is closed by the reconnect instead, which
  // `BuildJobQueue.stream` answers with `done`/`missing` on a fresh chain.
  expect(elapsed).toBeLessThan(TIMEOUT_MS * 2);
});

test("a cancellation whose restoration stalls is let go on the same terms", async () => {
  const transport = serializedSend({ stall: "fragment" });
  const startedAt = performance.now();

  const completion = await presenterOver(transport).present({
    kind: "cancelled",
    incarnationId: null,
  });

  expect(completion).toBe("terminal-sent");
  expect(performance.now() - startedAt).toBeLessThan(TIMEOUT_MS * 2);
});

test("a failure whose restoration stalls is let go on the same terms", async () => {
  const transport = serializedSend({ stall: "fragment" });
  const startedAt = performance.now();

  const completion = await presenterOver(transport).present({
    kind: "failed",
    error: new Error("the build fell over"),
    incarnationId: null,
  });

  expect(completion).toBe("terminal-sent");
  expect(performance.now() - startedAt).toBeLessThan(TIMEOUT_MS * 2);
});

test("an activation that could not be shown still tells the person their version is live", async () => {
  // A chain that is slow rather than blocked: preparing the View swap overruns the bound,
  // but writes still drain, so the short recovery line genuinely reaches the wire. This is
  // the one terminal worth a second attempt — the version is already durable, and saying
  // nothing would leave them looking at an old View believing nothing happened.
  const transport = serializedSend({ slow: "commit" });

  const completion = await presenterOver(transport).present(builtTerminal());

  expect(completion).toBe("terminal-sent");
  // The claim under test is that they are *told*, not which window's `done` won the race
  // out — asserting the latter would pin scheduler timing rather than behaviour.
  expect(transport.events.map((entry) => entry.event)).toContain("narration");
  expect(transport.events.find((entry) => entry.event === "narration")?.data).toContain(
    "Refresh and I'll bring it back.",
  );
});

test("an activation nobody is waiting for is never delivered under the lease", async () => {
  const transport = serializedSend();

  const completion = await presenterOver(transport, () => false).present(builtTerminal());

  // No writes, no bounded window, no second one — the lease is released immediately. The
  // activation itself is already durable and needs no audience to be true.
  expect(completion).toBeUndefined();
  expect(transport.events).toEqual([]);
});
