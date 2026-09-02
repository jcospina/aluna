// The core Builder / presenter split and lease-head stale revalidation
// (PLAN decisions 28, 31, 37; ADR-0006; ARCH §6.2 step 1).
//
// Two things are proven here, and neither of them involves SSE.
//
// First, the seam: the Builder runs a complete evolution — Diff, Gate, publication,
// activation, durable metrics — driven by a recording fake presenter that knows nothing
// about transports, DOM, or the prompt route. That is the interface Module 7's implicit
// loop will consume with a presenter of its own.
//
// Second, staleness: a request whose target expectation, expected-absence, or resolver
// catalog no longer holds at the head of the lease is refused. It calls no provider, never
// opens a `running` row, and writes one direct terminal `failed/stale` admission row with
// every generation stage skipped — carrying the expected incarnation for an evolution, and
// none at all for a new capability refused before one was ever assigned.

import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { notesSpec } from "../../builder/gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../builder/index.ts";
import { listGenerationLifecycles } from "../../platform/metrics/index.ts";
import type { GenerateResult, Provider } from "../../platform/provider/index.ts";
import {
  fingerprintActiveRegistryCatalog,
  getCapability,
  listCapabilities,
  readActiveRegistryCatalog,
} from "../../registry/index.ts";
import { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import {
  committedGate,
  committedSpec,
  dueDateCandidate,
  type EngineEnv,
  engineProvider,
  INCARNATION_ID,
  setUpCommitted,
  tearDownCommitted,
} from "../evolution/run/evolution-run.test-support.ts";
import type { BuildPipelineCompletion, SendBuildEvent } from "../jobs/build-jobs.ts";
import { createMetricsRecorder } from "../metrics-recorder.ts";
import {
  resolvedExistingCapabilityRequest,
  resolvedNewCapabilityRequest,
} from "./admission/resolved-request.ts";
import { type CoreBuilderPresenter, type CoreBuildTerminal, runCoreBuild } from "./core-builder.ts";

const OTHER_INCARNATION_ID = "77777777-7777-4777-8777-777777777777";
const RESOLVER = {
  intent: { type: "extend_capability" as const, confidence: 0.94, targetCapability: "notes" },
  model: "test-model",
  durationMs: 12,
  usage: { inputTokens: 40, outputTokens: 10, totalTokens: 50 },
  catalogFingerprint: "sha256:unused",
};

let gate: CapabilityGateResult;
let env: EngineEnv;

beforeAll(async () => {
  gate = await committedGate();
});

beforeEach(async () => {
  env = await setUpCommitted(gate);
});

afterEach(() => {
  tearDownCommitted(env);
});

/**
 * A presenter with no transport at all: it records the terminal lifecycle event and the
 * liveness sink's traffic. Everything the Builder does to the database and the filesystem
 * happens without it.
 */
function fakePresenter(): {
  presenter: CoreBuilderPresenter;
  terminals: CoreBuildTerminal[];
  events: { event: string; data: string }[];
} {
  const terminals: CoreBuildTerminal[] = [];
  const events: { event: string; data: string }[] = [];
  const send: SendBuildEvent = async (event, data) => void events.push({ event, data });
  return {
    terminals,
    events,
    presenter: {
      send,
      canPresent: () => true,
      isAborted: () => false,
      present(terminal): Promise<BuildPipelineCompletion> {
        terminals.push(terminal);
        return Promise.resolve("terminal-sent");
      },
    },
  };
}

/** A provider that fails the test if the Builder ever asks it for anything. */
function refusingProvider(): { provider: Provider; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    provider: {
      generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
        calls.push(prompt);
        throw new Error("a stale refusal must never reach a provider");
      },
    },
  };
}

function currentFingerprint(): string {
  return readActiveRegistryCatalog(env.conns.readonly).fingerprint;
}

/** A fingerprint that is valid in shape but belongs to a registry view that never was. */
function foreignFingerprint(): string {
  return fingerprintActiveRegistryCatalog([]);
}

function extendIntent() {
  return {
    type: "extend_capability" as const,
    confidence: 0.94,
    target_capability: "notes",
    resolution: "extend" as const,
    proposed_identity: null,
    proposed_action: "Add a due date to notes.",
    user_facing_label: "Adding a due date.",
    requires_confirmation: false as const,
  };
}

function newCapabilityIntent(proposedId: string | null) {
  return {
    type: "new_capability" as const,
    confidence: 0.9,
    target_capability: proposedId === null ? null : "notes",
    resolution: proposedId === null ? ("new" as const) : ("namespace" as const),
    proposed_identity: proposedId === null ? null : { id: proposedId, label: "Work Notes" },
    proposed_action: "Create a separate capability.",
    user_facing_label: "Setting that up.",
    requires_confirmation: false as const,
  };
}

interface RunOptions {
  readonly provider: Provider;
  readonly request: Parameters<typeof runCoreBuild>[0]["request"];
  readonly buildId: string;
  /** Stand in for a build that waited in the queue before the lease was granted. */
  readonly builtAt?: number;
}

async function run(options: RunOptions) {
  const { presenter, terminals, events } = fakePresenter();
  const completion = await runCoreBuild({
    buildId: options.buildId,
    request: options.request,
    presenter,
    provider: options.provider,
    recordMetrics: createMetricsRecorder(env.conns.readwrite),
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    mutationCoordinator: new MutationCoordinator(),
    builtAt: options.builtAt ?? performance.now(),
  });
  return { completion, terminals, events, rows: listGenerationLifecycles(env.conns.readonly) };
}

function staleTerminal(terminals: readonly CoreBuildTerminal[]) {
  const terminal = terminals.at(0);
  if (terminal?.kind !== "stale") {
    throw new Error(`expected a stale refusal, got ${terminal?.kind ?? "nothing"}`);
  }
  return terminal;
}

/** Move the committed capability to v2 behind the request's back. */
async function activateSecondVersion(): Promise<void> {
  const { provider } = engineProvider(dueDateCandidate());
  const active = getCapability("notes", env.conns.readonly);
  if (!active) throw new Error("committed capability did not activate");
  const { presenter } = fakePresenter();
  await runCoreBuild({
    buildId: "racing-build",
    request: resolvedExistingCapabilityRequest({
      prompt: "add a due date",
      intent: extendIntent(),
      target: {
        capabilityId: active.id,
        incarnationId: active.incarnation_id,
        version: active.version,
      },
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
    presenter,
    provider,
    recordMetrics: createMetricsRecorder(env.conns.readwrite),
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    mutationCoordinator: new MutationCoordinator(),
    builtAt: performance.now(),
  });
}

test("the core Builder activates a real evolution through a presenter that has no transport", async () => {
  const candidate = dueDateCandidate();
  const { provider, prompts } = engineProvider(candidate);
  const active = getCapability("notes", env.conns.readonly);
  if (!active) throw new Error("committed capability did not activate");

  const { completion, terminals, rows } = await run({
    provider,
    buildId: "seam-build",
    request: resolvedExistingCapabilityRequest({
      prompt: "add a due date to my notes",
      intent: extendIntent(),
      target: {
        capabilityId: active.id,
        incarnationId: active.incarnation_id,
        version: active.version,
      },
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
  });

  expect(completion).toBe("terminal-sent");
  const terminal = terminals.at(0);
  if (terminal?.kind !== "evolved") throw new Error(`unexpected terminal ${terminal?.kind}`);
  expect(terminal.outcome.kind).toBe("activated");
  // Mutation, Gate, activation and metrics all happened, with no SSE anywhere in sight.
  expect(prompts.length).toBeGreaterThan(0);
  expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
  expect(rows).toMatchObject([
    { buildId: "seam-build", incarnationId: INCARNATION_ID, outcome: "activated" },
  ]);
});

test("the core Builder builds and activates a brand-new capability through the same presenter", async () => {
  // The other half of the seam. Nothing about this path is evolution: it assigns the
  // incarnation, opens the durable row, authors a spec from nothing, and ends at a
  // pointer that did not exist before — all through a presenter with no transport.
  const authored = notesSpec({
    id: "recipes",
    label: "Recipes",
    prompt_context: "Stores the user's recipes.",
  });
  const { provider, prompts } = engineProvider(authored);

  const { completion, terminals, rows } = await run({
    provider,
    buildId: "seam-new-build",
    request: resolvedNewCapabilityRequest({
      prompt: "let me keep track of recipes",
      intent: newCapabilityIntent(null),
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
  });

  expect(completion).toBe("terminal-sent");
  const terminal = terminals.at(0);
  if (terminal?.kind !== "built") throw new Error(`unexpected terminal ${terminal?.kind}`);
  expect(prompts.length).toBeGreaterThan(0);
  // A live v1 pointer beside the capability that was already committed.
  expect(getCapability("recipes", env.conns.readonly)?.version).toBe(1);
  expect(
    listCapabilities(env.conns.readonly)
      .map((row) => row.id)
      .sort(),
  ).toEqual(["notes", "recipes"]);
  // The durable row was opened under the incarnation admission assigned, then enriched
  // with the semantic id the authored spec supplied, and finalized `success/activated`.
  const built = rows.find((row) => row.buildId === "seam-new-build");
  expect(built).toMatchObject({
    lifecycleStatus: "success",
    outcome: "activated",
    capabilityId: "recipes",
    incarnationId: terminal.incarnationId,
  });
  expect(built?.incarnationId).not.toBe(INCARNATION_ID);
});

test("a semantically identical candidate resolves to success/no_change through the seam", async () => {
  // Decision 37's measured no-op, reached the same way a person reaches it: the Builder
  // authored a candidate, the Diff Engine found zero change facts, and nothing moved. It
  // is the row that must stay distinguishable from a stale refusal in both columns.
  const { provider } = engineProvider(committedSpec());
  const active = getCapability("notes", env.conns.readonly);
  if (!active) throw new Error("committed capability did not activate");

  const { completion, terminals, rows } = await run({
    provider,
    buildId: "no-change-build",
    request: resolvedExistingCapabilityRequest({
      prompt: "keep it exactly as it is",
      intent: extendIntent(),
      target: {
        capabilityId: active.id,
        incarnationId: active.incarnation_id,
        version: active.version,
      },
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
  });

  expect(completion).toBe("terminal-sent");
  const terminal = terminals.at(0);
  if (terminal?.kind !== "evolved") throw new Error(`unexpected terminal ${terminal?.kind}`);
  expect(terminal.outcome.kind).toBe("no_change");
  // No version bumped, no pointer moved — the measurement is the whole durable effect.
  expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
  const measured = rows.find((row) => row.buildId === "no-change-build");
  expect(measured).toMatchObject({
    lifecycleStatus: "success",
    outcome: "no_change",
    incarnationId: INCARNATION_ID,
    capabilityId: "notes",
  });
  // The candidate *was* authored, which is exactly what separates this from a refusal:
  // spec generation ran, and the spend it cost is on the row.
  expect(measured?.stages.some((stage) => stage.state === "generated")).toBe(true);
  expect(measured?.measurement?.usage).toBeDefined();
});

test("an evolution measures on its caller's clock, not on the moment the engine started", async () => {
  // The engine used to start its own clock when it began work, which silently dropped
  // everything the person had already waited through — classification, then the queue
  // behind somebody else's lease. A v1 build has always counted that time; this pins the
  // evolution to the same clock by handing it one that started five seconds ago.
  const { provider } = engineProvider(dueDateCandidate());
  const active = getCapability("notes", env.conns.readonly);
  if (!active) throw new Error("committed capability did not activate");

  const { rows } = await run({
    provider,
    buildId: "queued-evolution",
    builtAt: performance.now() - 5_000,
    request: resolvedExistingCapabilityRequest({
      prompt: "add a due date to my notes",
      intent: extendIntent(),
      target: {
        capabilityId: active.id,
        incarnationId: active.incarnation_id,
        version: active.version,
      },
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
  });

  const evolved = rows.find((row) => row.buildId === "queued-evolution");
  expect(evolved?.outcome).toBe("activated");
  expect(evolved?.measurement?.timings?.totalMs).toBeGreaterThanOrEqual(5_000);
});

test("a superseded expected version is refused stale and never reaches the no-op comparison", async () => {
  const active = getCapability("notes", env.conns.readonly);
  if (!active) throw new Error("committed capability did not activate");
  // The request is resolved against v1, then another build takes the capability to v2.
  const request = resolvedExistingCapabilityRequest({
    prompt: "add a due date to my notes",
    intent: extendIntent(),
    target: {
      capabilityId: active.id,
      incarnationId: active.incarnation_id,
      version: active.version,
    },
    catalogFingerprint: currentFingerprint(),
    resolver: RESOLVER,
  });
  await activateSecondVersion();

  const { provider, calls } = refusingProvider();
  const { terminals, rows } = await run({ provider, request, buildId: "stale-version" });

  expect(staleTerminal(terminals).refusal).toMatchObject({
    reason: "target_version",
    // An evolution's refusal is filed under the incarnation it expected — that identity
    // predates the request and did not move.
    incarnationId: INCARNATION_ID,
    capabilityId: "notes",
  });
  expect(calls).toEqual([]);

  const refused = rows.find((row) => row.buildId === "stale-version");
  // Distinct from decision 37's measured no-op in both columns: a candidate was never
  // authored, so there was nothing to compare and nothing to call identical.
  expect(refused).toMatchObject({
    lifecycleStatus: "failed",
    outcome: "stale",
    incarnationId: INCARNATION_ID,
    capabilityId: "notes",
  });
  expect(refused?.stages.every((stage) => stage.state === "skipped")).toBe(true);
  expect(refused?.stages.length).toBeGreaterThan(0);
  // The resolver's own measurement rides along; no Builder tokens are claimed.
  expect(refused?.resolver?.durationMs).toBe(12);
  expect(refused?.measurement?.usage).toBeUndefined();
});

test("an evolution target reborn under another incarnation is refused stale", async () => {
  const active = getCapability("notes", env.conns.readonly);
  if (!active) throw new Error("committed capability did not activate");
  const { provider, calls } = refusingProvider();

  const { terminals, rows } = await run({
    provider,
    buildId: "stale-target",
    request: resolvedExistingCapabilityRequest({
      prompt: "add a due date to my notes",
      intent: extendIntent(),
      target: {
        capabilityId: active.id,
        incarnationId: OTHER_INCARNATION_ID,
        version: active.version,
      },
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
  });

  expect(staleTerminal(terminals).refusal).toMatchObject({
    reason: "target_missing",
    incarnationId: OTHER_INCARNATION_ID,
  });
  expect(calls).toEqual([]);
  // Unlike the expected-absent collision, this row *is* filed under the capability id: the
  // build really did aim at `notes`, and the expected incarnation beside it says which
  // `notes` it meant. That pair is a complete, true statement about a capability this build
  // owned — which is exactly what the collision case cannot say about the id it borrowed.
  expect(rows).toMatchObject([
    {
      buildId: "stale-target",
      lifecycleStatus: "failed",
      outcome: "stale",
      capabilityId: "notes",
      incarnationId: OTHER_INCARNATION_ID,
    },
  ]);
});

test("a new-capability refusal before incarnation assignment files its row without one", async () => {
  const { provider, calls } = refusingProvider();

  const { terminals, rows } = await run({
    provider,
    buildId: "stale-catalog",
    request: resolvedNewCapabilityRequest({
      prompt: "track my reading list",
      intent: newCapabilityIntent(null),
      // Classified against a registry view this process has never held.
      catalogFingerprint: foreignFingerprint(),
      resolver: RESOLVER,
    }),
  });

  const refusal = staleTerminal(terminals).refusal;
  expect(refusal.reason).toBe("catalog_revision");
  expect(refusal.incarnationId).toBeNull();
  expect(refusal.capabilityId).toBeNull();
  expect(calls).toEqual([]);
  expect(rows).toMatchObject([
    {
      buildId: "stale-catalog",
      lifecycleStatus: "failed",
      outcome: "stale",
      incarnationId: null,
      capabilityId: null,
    },
  ]);
  // Nothing was created, and the committed capability is untouched.
  expect(listCapabilities(env.conns.readonly).map((row) => row.id)).toEqual(["notes"]);
});

test("a proposed separate id that was taken in the meantime is an expected-absent collision", async () => {
  const { provider, calls } = refusingProvider();

  const { terminals, rows } = await run({
    provider,
    buildId: "stale-collision",
    request: resolvedNewCapabilityRequest({
      prompt: "keep my work notes apart",
      intent: newCapabilityIntent("notes"),
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
  });

  expect(staleTerminal(terminals).refusal).toMatchObject({
    reason: "expected_absent_collision",
    // The id it asked to be absent is named; no incarnation was ever assigned to it.
    capabilityId: "notes",
    incarnationId: null,
  });
  expect(calls).toEqual([]);
  // The durable row names neither, and the collision is exactly why: `notes` is somebody
  // else's committed capability that this build never touched, so charging it with the
  // refusal would put a failure on a capability whose own history is spotless.
  expect(rows).toMatchObject([
    { buildId: "stale-collision", outcome: "stale", incarnationId: null, capabilityId: null },
  ]);
  expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
});

test("a presenter that throws on delivery is not handed a second terminal", async () => {
  const terminals: CoreBuildTerminal[] = [];
  const failing: CoreBuilderPresenter = {
    send: async () => undefined,
    canPresent: () => true,
    isAborted: () => false,
    present(terminal) {
      terminals.push(terminal);
      return Promise.reject(new Error("the subscriber vanished mid-delivery"));
    },
  };

  const attempt = runCoreBuild({
    buildId: "one-terminal",
    request: resolvedNewCapabilityRequest({
      prompt: "track my reading list",
      intent: newCapabilityIntent(null),
      catalogFingerprint: foreignFingerprint(),
      resolver: RESOLVER,
    }),
    presenter: failing,
    provider: refusingProvider().provider,
    recordMetrics: createMetricsRecorder(env.conns.readwrite),
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    mutationCoordinator: new MutationCoordinator(),
    builtAt: performance.now(),
  });

  // The delivery failure surfaces to the caller's own safety net rather than looping the
  // Builder into presenting its presenter's failure.
  await expect(attempt).rejects.toThrow("the subscriber vanished mid-delivery");
  expect(terminals).toHaveLength(1);
  expect(terminals[0]?.kind).toBe("stale");
  // …and the durable refusal was still written exactly once, before any presentation.
  expect(listGenerationLifecycles(env.conns.readonly)).toMatchObject([
    { buildId: "one-terminal", outcome: "stale" },
  ]);
});

test("cancelling a queued build is a cancellation, not a failure", async () => {
  // Somebody else owns the lease, so this request sits in the queue — exactly when a user
  // is most likely to press Cancel, because nothing appears to be happening.
  const coordinator = new MutationCoordinator();
  const blocking = coordinator.tryAcquireRecordWrite();
  if (!blocking) throw new Error("expected to occupy the mutation lease");
  const { presenter, terminals } = fakePresenter();
  // The same signal the build job queue's Cancel wires up.
  const cancellation = new AbortController();

  const attempt = runCoreBuild({
    buildId: "cancelled-in-queue",
    signal: cancellation.signal,
    request: resolvedNewCapabilityRequest({
      prompt: "track my reading list",
      intent: newCapabilityIntent(null),
      catalogFingerprint: currentFingerprint(),
      resolver: RESOLVER,
    }),
    presenter,
    provider: refusingProvider().provider,
    recordMetrics: createMetricsRecorder(env.conns.readwrite),
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    mutationCoordinator: coordinator,
    builtAt: performance.now(),
  });

  // Cancel while the ticket is still queued behind the held lease.
  await Promise.resolve();
  expect(coordinator.snapshot().queuedTickets).toHaveLength(1);
  cancellation.abort();
  await attempt;
  coordinator.release(blocking);

  // The user stopped this on purpose. Telling them it failed would be false, and the
  // coordinator's internal admission error must never reach the wire.
  expect(terminals).toHaveLength(1);
  expect(terminals[0]?.kind).toBe("cancelled");
  // Nothing was admitted, so there is no durable row of any kind.
  expect(listGenerationLifecycles(env.conns.readonly)).toEqual([]);
});

test("a refused admission never opens a running row", async () => {
  const { provider } = refusingProvider();
  const { rows } = await run({
    provider,
    buildId: "no-running-row",
    request: resolvedNewCapabilityRequest({
      prompt: "track my reading list",
      intent: newCapabilityIntent(null),
      catalogFingerprint: foreignFingerprint(),
      resolver: RESOLVER,
    }),
  });

  // One row, terminal on its first and only write. `running` was never a state it held,
  // so startup reconciliation has nothing of this build's to interrupt.
  expect(rows).toHaveLength(1);
  expect(rows[0]?.lifecycleStatus).toBe("failed");
  expect(rows[0]?.createdAt).toBe(rows[0]?.updatedAt as string);
});
