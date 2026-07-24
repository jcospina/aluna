// The evolution-candidate dev tracer routes — Module 4.6/01–03. Route-level proof
// of the living demo: the developer-panel affordance admits a live capability
// plus a hand-typed intent, the trace streams the candidate assembling, and the
// terminal presentation carries the accepted candidate (or the warm rejection)
// into the developer preview while the displaced View is restored. From 4.6/03 a
// real change also assembles the executed work — additive DDL, copy/regenerate,
// and the Gate over the assembled snapshot — surfaced in the preview; but nothing
// durable changes: no version bump, no commit event, no metrics lifecycle row
// (publication/activation is 4.6/05). Driven through fake providers — no spend.
//
// The Gate's smoke rung loads the platform SQLite search extension, which segfaults
// `bun test` on macOS (a known Bun FFI bug); run this suite in the Linux container.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ZodType } from "zod";

import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  lastEventData,
  makeMetricsRecorder,
  makeScratchApp,
  readSse,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import {
  type CandidateDraft,
  candidateFrom,
  JOURNAL_INCARNATION_ID,
  journalCapabilityRow,
  makeCandidateProvider,
  shelvesCapabilityRow,
} from "./builder/candidate.test-support.ts";
import {
  createHandlerFor,
  fullHandlersFor,
  generatedUnitsFor,
  itemRendererFor,
  makeSequenceProvider,
  readHandlerFor,
  searchHandlerFor,
  updateHandlerFor,
} from "./builder/gate.test-support.ts";
import {
  activatePublishedSnapshot,
  type CapabilityGateResult,
  expectedAbsentCapability,
  publishCapabilitySnapshot,
  runCapabilityGate,
} from "./builder/index.ts";
import { applyCapabilityTableDdl, deriveCapabilityTableDdl } from "./capability-data/index.ts";
import {
  CANDIDATE_ACCEPTED_NOTICE,
  CANDIDATE_NO_CHANGE_NOTICE,
  CANDIDATE_REJECTED_NOTICE,
} from "./pipeline/terminal-presentation.ts";
import type { Provider } from "./provider/index.ts";
import {
  type CapabilitySpec,
  capabilitySpecFromRow,
  compareAndSwapCapability,
  getCapability,
  insertCapability,
} from "./registry/index.ts";

let env: ScratchDbEnv;

// The committed journal capability as a validated spec plus a valid unit set the Gate
// clears — published on disk so the evolution assembler can byte-copy its units.
function journalSpec(): CapabilitySpec {
  return capabilitySpecFromRow(journalCapabilityRow());
}

function journalHandlers(spec: CapabilitySpec) {
  return fullHandlersFor(spec, { create: createHandlerFor(spec), read: readHandlerFor(spec) });
}

let journalGate: CapabilityGateResult;

beforeAll(async () => {
  const spec = journalSpec();
  journalGate = await runCapabilityGate({
    spec,
    ddl: deriveCapabilityTableDdl(spec),
    handlers: journalHandlers(spec),
    itemRenderer: itemRendererFor(spec),
    behavioralTier: { enabled: false },
  });
});

beforeEach(async () => {
  env = createScratchDbEnv("aluna-evolution-candidate-");
  const spec = journalSpec();
  const publication = publishCapabilitySnapshot({
    buildId: "v1",
    spec,
    incarnationId: JOURNAL_INCARNATION_ID,
    version: 1,
    units: generatedUnitsFor(spec, journalHandlers(spec)),
    gate: journalGate,
    artifactsRoot: env.artifactsRoot,
  });
  await activatePublishedSnapshot({
    database: env.conns.readwrite,
    spec,
    publication,
    expected: expectedAbsentCapability(),
    applyMigration: (database) => void applyCapabilityTableDdl(spec, database),
    finalizeMetrics: () => undefined,
  });
  insertCapability(shelvesCapabilityRow(), env.conns.readwrite);
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

function scratchApp(response: unknown) {
  const { recordMetrics, rows, lifecycles } = makeMetricsRecorder();
  const { provider, prompts } = makeCandidateProvider(response);
  const app = makeScratchApp(env, provider, recordMetrics);
  return { app, prompts, rows, lifecycles };
}

async function admitTrace(app: ReturnType<typeof scratchApp>["app"], intent: string) {
  const res = await app.request("/demo/evolution-candidate/journal", {
    method: "POST",
    body: new URLSearchParams({ intent }),
  });
  expect(res.status).toBe(200);
  const fragment = await res.text();
  const jobId = buildJobIdFromSubscriber(fragment);
  return { fragment, jobId, streamPath: `/demo/evolution-candidate/build/${jobId}/stream` };
}

describe("the developer-panel affordance", () => {
  test("a full-page capability load renders the intent form targeting that capability", async () => {
    const { app } = scratchApp(candidateFrom(journalCapabilityRow()));
    const res = await app.request("/capability/journal");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="developer-evolution-candidate-control"');
    expect(html).toContain('hx-post="/demo/evolution-candidate/journal"');
    expect(html).toContain('name="intent"');
    expect(html).toContain("Evolution candidate");
    expect(html).toContain('id="spec-candidate-preview"');
  });

  test("the cold-start shell keeps the empty placeholder — no capability, no form", async () => {
    const bare = createScratchDbEnv("aluna-evolution-candidate-bare-");
    try {
      const { recordMetrics } = makeMetricsRecorder();
      const { provider } = makeCandidateProvider({});
      const app = makeScratchApp(bare, provider, recordMetrics);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('<div id="developer-evolution-candidate-control"></div>');
      expect(html).not.toContain('hx-post="/demo/evolution-candidate/');
    } finally {
      teardownScratchDbEnv(bare);
    }
  });
});

describe("admission", () => {
  test("an unknown capability is a warm 404", async () => {
    const { app } = scratchApp({});
    const res = await app.request("/demo/evolution-candidate/ghosts", {
      method: "POST",
      body: new URLSearchParams({ intent: "Add something" }),
    });
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("I can't find that here");
  });

  test("a blank intent is a warm 422 and admits nothing", async () => {
    const { app } = scratchApp({});
    const res = await app.request("/demo/evolution-candidate/journal", {
      method: "POST",
      body: new URLSearchParams({ intent: "   " }),
    });
    expect(res.status).toBe(422);
    expect(await res.text()).toContain("Tell me what you'd like to change first.");
  });

  test("an admitted trace returns the build subscriber wired to its own stream", async () => {
    const { app } = scratchApp(candidateFrom(journalCapabilityRow()));
    const { fragment, jobId } = await admitTrace(app, "Add a mood field");
    expect(fragment).toContain(`/demo/evolution-candidate/build/${jobId}/stream`);
    expect(fragment).toContain(`/demo/evolution-candidate/build/${jobId}/cancel`);
  });

  test("cancelling an unknown job is a 404", async () => {
    const { app } = scratchApp({});
    const res = await app.request("/demo/evolution-candidate/build/missing/cancel", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });
});

// The candidate journal spec plus one new active string field, and a queued provider
// that authors it and then hands back the three regenerated units the assembler asks for.
function moodCandidate(): CapabilitySpec {
  const spec = journalSpec();
  return {
    ...spec,
    schema: {
      fields: [
        ...spec.schema.fields,
        { name: "mood", label: "Mood", type: "string", required: false, lifecycle: "active" },
      ],
    },
  };
}

/**
 * Hold one generation call open so a test can act while the assembly is genuinely
 * mid-flight. The partials still stream; only the resolved object waits on `release`.
 */
function pausingProvider(inner: Provider, pauseOnCall: number) {
  let calls = 0;
  let signalReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider: Provider = {
    generate<T>(prompt: string, schema: ZodType<T>) {
      calls += 1;
      const result = inner.generate(prompt, schema);
      if (calls !== pauseOnCall) return result;
      signalReached();
      return { ...result, object: released.then(() => result.object) };
    },
  };
  return { provider, reached, release: () => release() };
}

function moodEvolutionApp(candidate: CapabilitySpec) {
  const metrics = makeMetricsRecorder();
  const { provider, prompts } = makeSequenceProvider([
    candidate,
    { content: createHandlerFor(candidate) },
    { content: updateHandlerFor(candidate) },
    { content: searchHandlerFor(candidate) },
  ]);
  return { app: makeScratchApp(env, provider, metrics.recordMetrics), prompts, ...metrics };
}

describe("an accepted candidate", () => {
  test("streams the trace and hands the validated candidate to the developer preview", async () => {
    const candidate = moodCandidate();
    const { app, prompts, rows, lifecycles } = moodEvolutionApp(candidate);
    const { streamPath } = await admitTrace(app, "Add a mood field");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    // Foreground narration stays in product voice: the intent line, then the accepted notice.
    const narration = eventData(events, "narration");
    expect(narration).toContain("Let me think through that change.");
    expect(narration).toContain(CANDIDATE_ACCEPTED_NOTICE);

    // The developer receives the accepted candidate and the Diff Engine's facts/work plan.
    expect(eventData(events, "spec-preview")).toContain('"mood"');
    const preview = JSON.parse(lastEventData(events, "candidate-preview"));
    expect(preview.status).toBe("accepted");
    expect(preview.capabilityId).toBe("journal");
    expect(preview.committedVersion).toBe(1);
    expect(preview.candidate).toEqual(JSON.parse(JSON.stringify(candidate)));
    expect(preview.diff.isNoop).toBe(false);
    expect(preview.diff.facts).toEqual([
      { kind: "new_active_field", field: "mood", fieldType: "string" },
    ]);
    expect(preview.diff.workPlan.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect(preview.diff.workPlan.platformWork).toEqual(["add_column", "platform_form_detail"]);

    // 4.6/03: the executed-work summary — regenerated vs. byte-copied units, the additive
    // DDL, and the Gate over the assembled snapshot.
    expect(preview.assembly.status).toBe("complete");
    expect(preview.assembly.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect([...preview.assembly.copiedUnits].sort()).toEqual(["delete", "item", "read"]);
    expect(preview.assembly.additiveMigration).toEqual([
      'ALTER TABLE "cap_journal" ADD COLUMN "mood" TEXT;',
    ]);
    const gate = Object.fromEntries(
      preview.assembly.gate.map((rung: { rung: string; status: string }) => [
        rung.rung,
        rung.status,
      ]),
    );
    expect(gate.structural).toBe("passed");
    expect(gate.smoke).toBe("passed");

    // The displaced View is restored and the stream closes warm.
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(eventData(events, "done")).toBe("ok");

    // The trace changed nothing durable: no commit, no version bump, no metrics row.
    expect(prompts[0]).toContain("Add a mood field");
    expect(eventData(events, "commit")).toBe("");
    expect(eventData(events, "metrics-preview")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
    expect(rows).toHaveLength(0);
    expect(lifecycles).toHaveLength(0);
  });
});

// Assembly is the long half of a trace — several live regenerations plus the Gate. It
// streams like a v1 build rather than landing as one terminal payload: the plan first
// (it is derived, so it needs no model call), then the units, then the Gate.
describe("the streamed assembly", () => {
  test("streams the assembly plan, the units, and the Gate while the work runs", async () => {
    const candidate = moodCandidate();
    const { app } = moodEvolutionApp(candidate);
    const { streamPath } = await admitTrace(app, "Add a mood field");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));
    const names = events.map((event) => event.event);
    const candidatePreviews = events
      .filter((event) => event.event === "candidate-preview")
      .map((event) => JSON.parse(event.data));

    // The running plan lands before any unit work: the whole shape of the evolution —
    // the added column and the copy/regenerate split — is visible while the units are
    // still being written, with no Gate verdict yet.
    expect(candidatePreviews.length).toBeGreaterThan(1);
    const running = candidatePreviews[0];
    expect(running.assembly.status).toBe("running");
    expect(running.assembly.regeneratedUnits).toEqual(["create", "update", "search"]);
    expect([...running.assembly.copiedUnits].sort()).toEqual(["delete", "item", "read"]);
    expect(running.assembly.additiveMigration).toEqual([
      'ALTER TABLE "cap_journal" ADD COLUMN "mood" TEXT;',
    ]);
    expect(running.assembly.gate).toEqual([]);
    expect(names.indexOf("candidate-preview")).toBeLessThan(names.indexOf("units-preview"));

    // The units block fills as the regenerated units assemble, and the copied units join
    // the same inventory already complete — the developer sees all six, not a list at the end.
    const units = JSON.parse(lastEventData(events, "units-preview"));
    expect(units.status).toBe("complete");
    expect(units.units.map((unit: { name: string }) => unit.name).sort()).toEqual([
      "create",
      "delete",
      "item",
      "read",
      "search",
      "update",
    ]);
    expect(units.units.every((unit: { status: string }) => unit.status === "complete")).toBe(true);
    const copiedItem = units.units.find((unit: { name: string }) => unit.name === "item");
    expect(copiedItem.content).toBe(itemRendererFor(journalSpec()));
    expect(copiedItem.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    // The Gate verdict streams into its own block before the terminal candidate preview.
    const gate = JSON.parse(lastEventData(events, "gate-preview"));
    expect(gate.kind).toBe("gate-preview");
    expect(gate.rungs.find((rung: { rung: string }) => rung.rung === "structural").status).toBe(
      "passed",
    );
    expect(gate.rungs.find((rung: { rung: string }) => rung.rung === "smoke").status).toBe(
      "passed",
    );
    expect(names.lastIndexOf("gate-preview")).toBeLessThan(names.lastIndexOf("candidate-preview"));

    // The terminal preview is the complete one: same plan, now carrying the Gate.
    expect(candidatePreviews.at(-1).assembly.status).toBe("complete");
    expect(candidatePreviews.at(-1).assembly.gate.length).toBeGreaterThan(0);
  });

  // A trace that dies mid-assembly must not leave the panel showing a plan that nothing
  // is working on any more.
  test("a failed assembly closes out the running plan instead of leaving it hanging", async () => {
    const candidate = moodCandidate();
    // The candidate authors fine; the create Handler never passes its checks, so its
    // bounded write→check→fix loop exhausts and the assembly throws.
    const { provider } = makeSequenceProvider([
      candidate,
      { content: "export default 'not a handler';" },
      { content: "export default 'still not a handler';" },
    ]);
    const { recordMetrics } = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, recordMetrics);
    const { streamPath } = await admitTrace(app, "Add a mood field");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    const previews = events
      .filter((event) => event.event === "candidate-preview")
      .map((event) => JSON.parse(event.data));
    expect(previews).toHaveLength(2);
    expect(previews[0].assembly.status).toBe("running");
    expect(previews.at(-1).assembly.status).toBe("failed");
    // The failure itself still reports through the error preview, and nothing durable moved.
    expect(eventData(events, "build-error-preview")).toContain("did not pass");
    expect(eventData(events, "done")).toBe("error");
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
  });

  // Cancel is a deliberate stop, not a failure — and the plan must still be closed out.
  test("a cancelled assembly closes the plan out as cancelled", async () => {
    const candidate = moodCandidate();
    const { provider: queued } = makeSequenceProvider([
      candidate,
      { content: createHandlerFor(candidate) },
      { content: updateHandlerFor(candidate) },
      { content: searchHandlerFor(candidate) },
    ]);
    // Hold the last regeneration open so the cancel lands mid-assembly, deterministically.
    const { provider, reached, release } = pausingProvider(queued, 4);
    const { recordMetrics } = makeMetricsRecorder();
    const app = makeScratchApp(env, provider, recordMetrics);
    const { jobId, streamPath } = await admitTrace(app, "Add a mood field");
    const payload = readSse(await app.request(streamPath));

    await reached;
    const cancelled = await app.request(`/demo/evolution-candidate/build/${jobId}/cancel`, {
      method: "POST",
    });
    expect(cancelled.status).toBe(202);
    release();

    const events = collectSseEvents(await payload);
    const previews = events
      .filter((event) => event.event === "candidate-preview")
      .map((event) => JSON.parse(event.data));
    expect(previews.at(-1).assembly.status).toBe("cancelled");
    // The Gate never ran, the View came back, and nothing durable moved.
    expect(eventData(events, "gate-preview")).toBe("");
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(eventData(events, "done")).toBe("error");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
  });

  test("a measured no-op streams no assembly work at all", async () => {
    const { app } = scratchApp(candidateFrom(journalCapabilityRow()));
    const { streamPath } = await admitTrace(app, "Keep it exactly as it is");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));
    // Nothing to assemble: no units, no Gate, and exactly one terminal candidate preview.
    expect(eventData(events, "units-preview")).toBe("");
    expect(eventData(events, "gate-preview")).toBe("");
    expect(events.filter((event) => event.event === "candidate-preview")).toHaveLength(1);
  });
});

describe("a measured no-op", () => {
  test("a semantically identical candidate is success/no_change with the View restored", async () => {
    // The provider re-authors the exact committed spec — a semantic no-op.
    const identical = candidateFrom(journalCapabilityRow());
    const { app, rows, lifecycles } = scratchApp(identical);
    const { streamPath } = await admitTrace(app, "Keep it exactly as it is");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    // The dev preview reports the zero-fact Diff as the measured no-op.
    const preview = JSON.parse(eventData(events, "candidate-preview"));
    expect(preview.status).toBe("no_change");
    expect(preview.diff.isNoop).toBe(true);
    expect(preview.diff.facts).toEqual([]);
    expect(preview.diff.workPlan.regeneratedUnits).toEqual([]);

    // Metrics finalize success/no_change with every downstream stage skipped.
    const metrics = JSON.parse(eventData(events, "metrics-preview"));
    expect(metrics.lifecycleStatus).toBe("success");
    expect(metrics.outcome).toBe("no_change");
    expect(metrics.stages).toEqual(
      expect.arrayContaining([{ stage: "activation", state: "skipped" }]),
    );
    const finalLifecycle = lifecycles.at(-1);
    expect(finalLifecycle?.lifecycleStatus).toBe("success");
    expect(finalLifecycle?.outcome).toBe("no_change");

    // Warm close in product voice, committed View restored, no version bump.
    expect(eventData(events, "narration")).toContain(CANDIDATE_NO_CHANGE_NOTICE);
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(eventData(events, "done")).toBe("ok");
    expect(eventData(events, "commit")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
    // The legacy terminal row and the running→success lifecycle are both recorded.
    expect(rows).toHaveLength(1);
    expect(finalLifecycle).toBeDefined();
  });
});

describe("a rejected candidate", () => {
  test("streams the warm rejection with every violation in the developer preview", async () => {
    const authored = candidateFrom(journalCapabilityRow());
    authored.schema.fields = authored.schema.fields.filter(
      (field) => field.name !== "archived_reason",
    );
    const { app, rows } = scratchApp(authored);
    const { streamPath } = await admitTrace(app, "Forget the archive note");

    const events = collectSseEvents(await readSse(await app.request(streamPath)));

    const narration = eventData(events, "narration");
    expect(narration).toContain(CANDIDATE_REJECTED_NOTICE);

    const preview = JSON.parse(eventData(events, "candidate-preview"));
    expect(preview.status).toBe("rejected");
    expect(preview.candidate).toBeUndefined();
    expect(
      preview.issues.some((issue: { message: string }) =>
        issue.message.includes('committed field "archived_reason" must be returned exactly once'),
      ),
    ).toBe(true);

    // Warm rejection, not a crash — and still nothing durable.
    expect(eventData(events, "done")).toBe("error");
    expect(eventData(events, "fragment")).toContain("capability-surface");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(1);
    expect(rows).toHaveLength(0);
  });
});

describe("a stale target", () => {
  test("a capability changed between admit and lease fails the trace, not the registry", async () => {
    const draft: CandidateDraft = candidateFrom(journalCapabilityRow());
    const { app } = scratchApp(draft);
    const { streamPath } = await admitTrace(app, "Add a mood field");

    // Another build activates v2 before this trace reaches the queue head.
    const journal = journalCapabilityRow();
    compareAndSwapCapability(
      journalCapabilityRow({
        version: 2,
        artifacts_path: `capabilities/journal/${journal.incarnation_id}/v2/`,
      }),
      {
        state: "active",
        capabilityId: journal.id,
        incarnationId: journal.incarnation_id,
        version: 1,
      },
      env.conns.readwrite,
    );

    const events = collectSseEvents(await readSse(await app.request(streamPath)));
    expect(eventData(events, "done")).toBe("error");
    expect(eventData(events, "build-error-preview")).toContain(
      "changed before its evolution trace began",
    );
    expect(eventData(events, "candidate-preview")).toBe("");
    expect(getCapability("journal", env.conns.readonly)?.version).toBe(2);
  });
});
