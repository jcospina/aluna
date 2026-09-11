// POST /prompt and GET /build/:id/stream — the resolver-driven default pipeline: a
// POST admits immediately and returns the SSE subscriber fragment, then the stream
// classifies the intent and either builds a new_capability end to end or streams a
// warm deflection. These cases run against a scratch db shared with the router; the
// coordinator cases prove the resolved-build route waits on the injected shared
// mutation coordinator. Shared setup and fixtures live in app.test-support.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { REJECT_DEFLECTION } from "../../../pipeline/build/admission/deflection.ts";
import type { RecordMetrics } from "../../../pipeline/index.ts";
import type { IntentClassification } from "../../../pipeline/intent/index.ts";
import type { PlatformDatabase } from "../../../platform/persistence/db.ts";
import type { Provider } from "../../../platform/provider/index.ts";
import { getCapability, insertCapability, listCapabilities } from "../../../registry/index.ts";
import { createMutationCoordinator } from "../../../runtime/concurrency/mutation-coordinator.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  DATA_QUERY_INTENT,
  eventData,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  notesCapabilityRow,
  postPrompt,
  REJECT_INTENT,
  readSse,
  responseText,
  type SseEvent,
  teardownScratchDbEnv,
  throwingProvider,
  wait,
} from "../../app.test-support.ts";
import { createApp } from "../../app.ts";
import { escapeHtml } from "../../http/html.ts";
import { ANSWER_WINDOW_ATTRIBUTE, ANSWER_WINDOW_OPENING } from "../../http/index.ts";
import { makeQuestionProvider } from "./staged-question.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

function defaultPipelineApp(provider: Provider, recordMetrics: RecordMetrics) {
  return makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);
}

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline)", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("POST admits immediately; the stream classifies and proceeds to build new_capability", async () => {
    const { provider, prompts } = makePromptBuildProvider(NEW_CAPABILITY_INTENT);
    const { rows, lifecycles, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const postRes = await postPrompt(app, "track my notes");
    const fragment = await responseText(postRes);
    const jobId = buildJobIdFromSubscriber(fragment);

    expect(postRes.status).toBe(200);
    expect(fragment).toContain(`sse-connect="/build/${jobId}/stream"`);
    expect(prompts).toHaveLength(0);

    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const eventNames = events.map((event) => event.event);
    const dataFor = (name: string) => eventData(events, name);

    // The desk works out what the sentence is on the prompt bar, so a build's first narration is
    // the build's own line and no frame is revealed before there is one.
    expect(eventNames[0]).toBe("fragment");
    expect(events[0]?.data).toContain('id="prompt-notice"');
    expect(eventNames).toContain("spec-preview");
    expect(eventNames).toContain("migration-preview");
    expect(eventNames).toContain("units-preview");
    expect(eventNames).toContain("gate-preview");
    expect(eventNames).toContain("commit-preview");
    expect(eventNames.at(-2)).toBe("commit");
    expect(eventNames.at(-1)).toBe("done");
    expect(dataFor("done")).toBe("ok");
    expect(events[0]?.data).toContain("new place");
    expect(events[0]?.data).toContain("already started");
    const narrations = events.filter((event) => event.event === "narration");
    expect(narrations[0]?.data).toBe(NEW_CAPABILITY_INTENT.user_facing_label);
    const metricEvents = events.filter((event) => event.event === "metrics-preview");
    expect(JSON.parse(metricEvents[0]?.data ?? "null")).toMatchObject({
      lifecycleStatus: "running",
      outcome: null,
      resolver: {
        durationMs: expect.any(Number),
        catalogFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(JSON.parse(metricEvents.at(-1)?.data ?? "null")).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });
    expect(lifecycles[0]?.resolver?.catalogFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);

    // intent + spec + five per-Action behavioral suites + 6 units (item renderer + five
    // Actions). The tests come before the units: intent is frozen before code exists.
    expect(prompts).toHaveLength(13);
    expect(prompts[0]).toContain("Aluna's Intent Resolver");
    expect(prompts[0]).toContain("track my notes");
    expect(prompts[1]).toContain("Aluna's Capability Builder");
    expect(prompts[1]).toContain("Create a notes capability.");

    expect(dataFor("narration")).not.toMatch(/\bspec\b|\bschema\b|\bhandler\b|\bmigration\b/i);
    const commitSwap = dataFor("commit");
    expect(commitSwap).toContain('class="capability-surface"');
    expect(commitSwap).toContain('hx-get="/capability/notes/read"');
    expect(commitSwap).toContain('hx-post="/capability/notes/create"');
    expect(commitSwap).toContain('hx-swap-oob="beforeend:#capability-logos"');
    expect(commitSwap).toContain("data-capability-logo");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "success",
      capabilityId: "notes",
      intent: { type: "new_capability", confidence: 0.97, targetCapability: null },
    });
    // 13 provider calls × 53 tokens each: intent + spec + five per-Action test suites + 6 units.
    expect(rows[0]?.usage?.totalTokens).toBe(13 * 53);
    expect(rows[0]?.timings?.specGenMs).toBeGreaterThanOrEqual(0);
    expect(rows[0]?.gateRungs?.map((rung) => rung.rung)).toEqual([
      "structural",
      "smoke",
      "behavioral",
      "design-lint",
    ]);

    expect(getCapability("notes", conns.readonly)?.version).toBe(1);
    const committed = getCapability("notes", conns.readonly);
    expect(existsSync(resolve(committed?.artifacts_path ?? "", "create.ts"))).toBe(true);
  }, 20_000);
});

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline) — shared coordinator lease", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("the production resolved-build route waits on the injected shared coordinator", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const recordLease = mutationCoordinator.tryAcquireRecordWrite();
    expect(recordLease).toBeDefined();
    const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT);
    const { recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      mutationCoordinator,
    });

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "track my notes")),
    );
    const payload = readSse(await app.request(`/build/${jobId}/stream`));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (mutationCoordinator.snapshot().queuedTickets.some((ticket) => ticket.kind === "build")) {
        break;
      }
      await wait(1);
    }

    expect(mutationCoordinator.snapshot()).toMatchObject({
      queuedTickets: [{ kind: "build" }],
      activeLease: { kind: "record" },
    });
    expect(recordLease && mutationCoordinator.release(recordLease)).toBe(true);
    expect(collectSseEvents(await payload).at(-1)).toMatchObject({ event: "done", data: "ok" });
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("a failed production build presents one terminal error before releasing ownership", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, {});
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: () => provider,
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      mutationCoordinator,
    });
    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "track my notes")),
    );

    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const terminalEvents = events.filter((event) =>
      ["build-error-preview", "narration", "done"].includes(event.event),
    );
    const errorPreview = JSON.parse(eventData(events, "build-error-preview")) as {
      kind: string;
      status: string;
      errorName: string;
      message: string;
    };

    expect(terminalEvents.slice(-3).map((event) => event.event)).toEqual([
      "build-error-preview",
      "narration",
      "done",
    ]);
    expect(errorPreview).toMatchObject({
      kind: "build-error-preview",
      status: "failed",
      errorName: "ZodError",
    });
    expect(errorPreview.message).not.toBe("");
    expect(events.filter((event) => event.event === "done")).toEqual([
      expect.objectContaining({ data: "error" }),
    ]);
    const narration = events.filter((event) => event.event === "narration").at(-1)?.data ?? "";
    expect(narration).toMatch(/mind trying again/i);
    expect(narration).not.toMatch(/Zod|spec|schema|provider|handler|gate/i);
    expect(rows[0]?.outcome).toBe("failure");
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("a failed metrics write cannot move failure presentation outside the lease", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const { provider, prompts } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, {});
    const { recordMetrics } = makeMetricsRecorder();
    const failingMetrics = Object.assign(recordMetrics, {
      start() {
        throw new Error("metrics unavailable");
      },
    }) satisfies RecordMetrics;
    const app = createApp({
      getProvider: () => provider,
      recordMetrics: failingMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      mutationCoordinator,
    });
    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "track my notes")),
    );

    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(events.filter((event) => event.event === "done")).toEqual([
      expect.objectContaining({ data: "error" }),
    ]);
    // The resolver call is pre-admission; the failed durable row prevents every
    // Builder-owned spec/unit/test provider call.
    expect(prompts).toHaveLength(1);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });
});

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline) — provider unavailable", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a missing provider key streams a warm apology, with no internals in the copy", async () => {
    // `createProvider` throws "Missing OMNI_API_KEY ..." before the resolver can classify. The
    // build must still close cleanly with product-voice copy.
    const { recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: throwingProvider("Missing OMNI_API_KEY. ..."),
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
    });
    const postRes = await postPrompt(app, "track my notes");
    expect(postRes.status).toBe(200);
    const jobId = buildJobIdFromSubscriber(await responseText(postRes));

    const streamRes = await app.request(`/build/${jobId}/stream`);
    expect(streamRes.status).toBe(200);
    // SSE headers, previously asserted on the deleted `/stream` route. `no-store` rather than the
    // framework's `no-cache`: this body carries the user's own question (ADR-0008, 6.5/02).
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    expect(streamRes.headers.get("cache-control")).toContain("no-store");
    const events = collectSseEvents(await readSse(streamRes));

    const narration = events.filter((event) => event.event === "narration").at(-1)?.data ?? "";
    expect(narration).toMatch(/mind trying again/i);
    // No internals leak into the UI copy — asserted over every event the page shows, not just the
    // terminal line. The raw message stays on `build-error-preview`, which is not product copy.
    const productCopy = events
      .filter((event) => event.event === "narration" || event.event === "fragment")
      .map((event) => event.data)
      .join("\n");
    expect(productCopy).not.toMatch(/OMNI_API_KEY|api key|provider/i);
    expect(events.filter((event) => event.event === "done")).toEqual([
      expect.objectContaining({ data: "error" }),
    ]);
  });
});

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline) — warm deflection", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a refused sentence streams a warm deflection, writes metrics, and builds nothing", async () => {
    const { provider, prompts } = makePromptBuildProvider(REJECT_INTENT);
    const { rows, resolutionRows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "delete everything")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const narration = events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join("");

    // Nothing was admitted, so nothing stands on the desk: a deflection explains itself
    // in the prompt bar and leaves the ground exactly as it found it.
    // The first fragment is Aluna saying she is working out what the sentence is, which goes on
    // the prompt bar rather than into a window (`renderResolvingNotice`).
    expect(events.map((event) => event.event)).toEqual([
      "fragment",
      "metrics-preview",
      "fragment",
      "done",
    ]);
    expect(eventData(events, "fragment")).toContain('data-build-restoration="neutral"');
    expect(eventData(events, "fragment")).toContain('id="prompt-notice"');
    expect(eventData(events, "fragment")).toContain("not quite sure what to make");
    // A refusal opens no window at all: the bar is the whole of what a refused sentence gets
    // (PLAN decision 23).
    expect(eventData(events, "fragment")).not.toContain(ANSWER_WINDOW_ATTRIBUTE);
    expect(events[0]?.data).toContain("new place");
    expect(events[0]?.data).toContain("already started");
    expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
    expect(narration).not.toMatch(
      /capability|intent|data_query|registry|schema|migration|handler|artifact|metrics|provider/i,
    );

    expect(prompts).toHaveLength(1);
    expect(rows).toEqual([]);
    expect(resolutionRows).toHaveLength(1);
    expect(resolutionRows[0]).toMatchObject({
      promptJobId: jobId,
      outcome: "completed",
      resolver: {
        intent: { type: "reject" },
        catalogFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(JSON.parse(eventData(events, "metrics-preview"))).toEqual(resolutionRows[0]);
    expect(listCapabilities(conns.readonly)).toEqual([]);
    expect(
      conns.readonly
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cap_notes'")
        .get(),
    ).toBeNull();
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test('the duplicate "track my notes" ask deflects via extend_capability when Notes exists', async () => {
    insertCapability(notesCapabilityRow(), conns.readwrite);
    const extendIntent: IntentClassification = {
      type: "extend_capability",
      confidence: 0.94,
      target_capability: "notes",
      resolution: "extend",
      proposed_identity: null,
      proposed_action: "Add another way to track notes inside the existing Notes capability.",
      user_facing_label: "I can add that to your notes.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makePromptBuildProvider(extendIntent);
    const { rows, resolutionRows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "track my notes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const narration = events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join("");

    expect(prompts).toHaveLength(0);
    expect(events.map((event) => event.event)).toEqual(["metrics-preview", "fragment", "done"]);
    expect(eventData(events, "fragment")).toContain("already have Notes");
    expect(eventData(events, "fragment")).toContain('data-build-restoration-behavior="preserve"');
    expect(eventData(events, "fragment")).toContain('id="prompt-notice" hx-swap-oob="innerHTML"');
    expect(narration).not.toMatch(
      /capability|intent|extend_capability|registry|schema|migration|handler|artifact/i,
    );
    expect(rows).toEqual([]);
    expect(resolutionRows[0]).toMatchObject({
      promptJobId: jobId,
      outcome: "completed",
      resolver: {
        intent: { type: "extend_capability", confidence: 1, targetCapability: "notes" },
        durationMs: 0,
      },
    });
    expect(resolutionRows[0]?.resolver.usage.totalTokens).toBeUndefined();
    expect(listCapabilities(conns.readonly)).toHaveLength(1);
    expect(listCapabilities(conns.readonly)[0]?.id).toBe("notes");
    expect(existsSync(artifactsRoot)).toBe(false);
  });
});

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline) — a question", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("a question opens the answer window and gives back the frame it borrowed", async () => {
    insertCapability(notesCapabilityRow(), conns.readwrite);
    const { provider } = makeQuestionProvider({
      intent: DATA_QUERY_INTENT,
      reads: [],
      answer: { answer: "I had a look at your notes — you added four last week." },
    });
    const { rows, resolutionRows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "how many notes did I add last week?")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const fragments = eventData(events, "fragment");

    // No narration at all: the desk works the sentence out on the prompt bar, the answer window
    // opens, and everything after it is said in that window. Nothing is ever placed in a window,
    // so no frame is revealed for a question that never wanted one.
    expect(events.map((event) => event.event)).toEqual([
      "fragment",
      "metrics-preview",
      "fragment",
      "fragment",
      "done",
    ]);
    expect(fragments).toContain(`${ANSWER_WINDOW_ATTRIBUTE}="how many notes did I add last week?"`);
    expect(fragments).toContain(escapeHtml(ANSWER_WINDOW_OPENING));
    // A question restores nothing, because it displaced nothing: the desk gives the frame the
    // submit borrowed straight back (PLAN decisions 21, 23).
    expect(fragments).not.toContain("data-build-restoration");
    // And nothing is left on the bar for the window to contradict. The one notice on this path is
    // the desk working the sentence out, and the window opening is what takes it down.
    const notices = eventData(events, "fragment").match(/id="prompt-notice"/g) ?? [];
    expect(notices).toHaveLength(1);
    expect(eventData([events[0] as SseEvent], "fragment")).toContain('id="prompt-notice"');
    // Nothing a deflection would have said reaches the window: a question is answered, and the
    // refusal's line is the only one `deflectionNarration` still has (6.5/03).
    expect(fragments).not.toContain(escapeHtml(REJECT_DEFLECTION));

    expect(rows).toEqual([]);
    expect(resolutionRows).toHaveLength(1);
    expect(resolutionRows[0]).toMatchObject({
      promptJobId: jobId,
      outcome: "completed",
      resolver: { intent: { type: "data_query", confidence: 0.89, targetCapability: "notes" } },
    });
    // Asking adds nothing to the desk: the one capability that was there is the one that is
    // there, at the version it was at.
    expect(listCapabilities(conns.readonly).map((row) => [row.id, row.version])).toEqual([
      ["notes", 1],
    ]);
  });
});
