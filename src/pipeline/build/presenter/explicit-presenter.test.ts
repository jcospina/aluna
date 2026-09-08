// The explicit presenter's delivery bound (PLAN decisions 28, 29, 31;
// ADR-0002).
//
// Terminal delivery is bounded because the build lease is held for the whole of it, so a
// subscriber that stops reading must not hold mutation ownership open. That bound has a
// consequence the happy path never shows: delivery can stop part-way through the story.
//
// What the presenter may do about it is limited by the transport underneath. `sseTransport`
// serializes every write through one chain, so a write that stalled is still at the head of it
// and anything queued behind lands never. These cases pin the two decisions: a non-activating
// terminal is let go rather than retried behind the stall, and an activation — the one outcome
// with something durable left to say — gets one more short attempt, while somebody is listening.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { CommitCapabilityResult } from "../../../builder/index.ts";
import {
  createScratchDbEnv,
  makeMetricsRecorder,
  NOTES_INCARNATION_ID,
  notesCapabilityRow,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../../server/app.test-support.ts";
import { renderBuildEnding } from "../../../server/http/index.ts";
import type { BuildJob, SendBuildEvent } from "../../jobs/build-jobs.ts";
import { STALE_BUILD_ENDING } from "../../streaming/terminal-presentation.ts";
import type { CoreBuildTerminal } from "../core-builder.ts";
import { createExplicitPresenter } from "./explicit-presenter.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("aluna-explicit-presenter-");
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

// Deliberately generous: every stall case asserts a return well under *two* bounds, the signature
// a second recovery window would leave, so scheduler noise on a loaded shard stays far below it.
const TIMEOUT_MS = 150;
/**
 * One write slow enough to overrun the bound alone and still drain inside the recovery window.
 * Spreading the delay would make which window's `done` lands first a race, and pin that instead.
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
 * An activated v1 as the Builder hands it over, complete enough to render the commit preview and
 * the View swap: a thinner stand-in throws into `presentBuilt`'s catch, missing the bound tested.
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
 * A transport that serializes writes as `sseTransport` does: independent resolution would make a
 * follow-up look deliverable behind a stall. `stall` never completes, `slow` drains eventually.
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
  expect(transport.events[0]?.data).toBe(renderBuildEnding(JOB.id, STALE_BUILD_ENDING));
});

test("a stale terminal whose restoration stalls is let go rather than retried behind the stall", async () => {
  const transport = serializedSend({ stall: "fragment" });
  const startedAt = performance.now();

  const completion = await presenterOver(transport).present(STALE_TERMINAL);
  const elapsed = performance.now() - startedAt;

  expect(completion).toBe("terminal-sent");
  // The warm line landed before the reader went quiet; nothing after it could.
  expect(transport.events.map((entry) => entry.event)).toEqual(["narration"]);
  // The point of not retrying: ownership is released after one bound, not two. A second window
  // would queue its `done` behind the stall; the reconnect gets `done`/`missing` on a fresh chain.
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
  // Slow rather than blocked: the View swap overruns the bound but writes still drain, so the
  // recovery line lands. The version is durable, and silence leaves them on an old View.
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
