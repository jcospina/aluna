// POST /prompt and GET /build/:id/stream — the resolver-driven default pipeline: a
// POST admits immediately and returns the SSE subscriber fragment, then the stream
// classifies the intent and either builds a new_capability end to end or streams a
// warm deflection. These cases run against a scratch db shared with the router; the
// coordinator cases prove the resolved-build route waits on the injected shared
// mutation coordinator. Shared setup and fixtures live in app.test-support.ts.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodType } from "zod";

import {
  BEHAVIORAL_SUITE,
  buildJobIdFromSubscriber,
  CREATE_HANDLER,
  collectSseEvents,
  createScratchDbEnv,
  DELETE_HANDLER,
  eventData,
  ITEM_RENDERER,
  makeMetricsRecorder,
  makeScratchApp,
  NOTES_SPEC,
  notesCapabilityRow,
  postPrompt,
  READ_HANDLER,
  readSse,
  responseText,
  SEARCH_HANDLER,
  teardownScratchDbEnv,
  UPDATE_HANDLER,
  wait,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";
import type { PlatformDatabase } from "./db.ts";
import type { IntentClassification } from "./intent-resolver/index.ts";
import { createMutationCoordinator } from "./mutation-coordinator/index.ts";
import type { RecordMetrics } from "./pipeline/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "./provider/index.ts";
import { getCapability, insertCapability, listCapabilities } from "./registry/index.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

function defaultPipelineApp(provider: Provider, recordMetrics: RecordMetrics) {
  return makeScratchApp({ dir, conns, artifactsRoot }, provider, recordMetrics);
}

function makePromptBuildProvider(
  intent: IntentClassification,
  spec: unknown = NOTES_SPEC,
  behavioralSuite: unknown = BEHAVIORAL_SUITE,
  units: {
    readonly item?: string;
    readonly create?: string;
    readonly read?: string;
    readonly update?: string;
    readonly delete?: string;
    readonly search?: string;
  } = {},
): { provider: Provider; prompts: string[] } {
  const prompts: string[] = [];
  const responses = [
    intent,
    spec,
    { content: units.item ?? ITEM_RENDERER },
    { content: units.create ?? CREATE_HANDLER },
    { content: units.read ?? READ_HANDLER },
    { content: units.update ?? UPDATE_HANDLER },
    { content: units.delete ?? DELETE_HANDLER },
    { content: units.search ?? SEARCH_HANDLER },
    behavioralSuite,
  ];
  const provider: Provider = {
    generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      const response = responses.shift();
      if (response === undefined) {
        throw new Error(`fake provider exhausted after ${prompts.length} prompt(s)`);
      }
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield response as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(response as T),
        usage: Promise.resolve({ inputTokens: 41, outputTokens: 12, totalTokens: 53 }),
      };
    },
  };
  return { provider, prompts };
}

const PERSONAL_NOTES_SPEC = {
  ...NOTES_SPEC,
  id: "personal_notes",
  label: "Personal Notes",
  prompt_context:
    "Stores personal notes with titles, content, optional tags, pinned status, and an optional note date for easy retrieval.",
};

const newCapabilityIntent: IntentClassification = {
  type: "new_capability",
  confidence: 0.97,
  target_capability: null,
  proposed_action: "Create a notes capability.",
  user_facing_label: "Got it. I'm putting that together now.",
  requires_confirmation: false,
};

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline)", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("POST admits immediately; the stream classifies and proceeds to build new_capability", async () => {
    const { provider, prompts } = makePromptBuildProvider(newCapabilityIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
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

    expect(eventNames[0]).toBe("narration");
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
    expect(narrations[1]?.data).toBe(newCapabilityIntent.user_facing_label);
    const metricEvents = events.filter((event) => event.event === "metrics-preview");
    expect(JSON.parse(metricEvents[0]?.data ?? "null")).toMatchObject({
      lifecycleStatus: "running",
      outcome: null,
    });
    expect(JSON.parse(metricEvents.at(-1)?.data ?? "null")).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });

    // intent + spec + 6 units (item renderer + five Actions) + behavioral test-gen.
    expect(prompts).toHaveLength(9);
    expect(prompts[0]).toContain("Aluna's Intent Resolver");
    expect(prompts[0]).toContain("track my notes");
    expect(prompts[1]).toContain("Aluna's Capability Builder");
    expect(prompts[1]).toContain("Create a notes capability.");

    expect(dataFor("narration")).not.toMatch(/\bspec\b|\bschema\b|\bhandler\b|\bmigration\b/i);
    const commitSwap = dataFor("commit");
    expect(commitSwap).toContain('class="capability-surface"');
    expect(commitSwap).toContain('hx-get="/capability/notes/read"');
    expect(commitSwap).toContain('hx-post="/capability/notes/create"');
    expect(commitSwap).toContain('hx-swap-oob="beforeend:#capability-toolbar"');
    expect(commitSwap).toContain("data-capability-entry");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "success",
      capabilityId: "notes",
      intent: { type: "new_capability", confidence: 0.97, targetCapability: null },
    });
    // 9 provider calls × 53 tokens each: intent + spec + 6 units + behavioral test-gen.
    expect(rows[0]?.usage?.totalTokens).toBe(477);
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
  });
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
    const { provider } = makePromptBuildProvider(newCapabilityIntent);
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
    const { provider } = makePromptBuildProvider(newCapabilityIntent, {});
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
    const { provider, prompts } = makePromptBuildProvider(newCapabilityIntent, {});
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

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline) — warm deflection", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("non-new-capability intents stream a warm deflection, write metrics, and build nothing", async () => {
    const dataQueryIntent: IntentClassification = {
      type: "data_query",
      confidence: 0.89,
      target_capability: "notes",
      proposed_action: "Answer a question about saved notes.",
      user_facing_label: "I can look across your notes.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makePromptBuildProvider(dataQueryIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "how many notes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const narration = events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join("");

    expect(events.map((event) => event.event)).toEqual(["narration", "fragment", "done"]);
    expect(eventData(events, "fragment")).toContain('data-build-restoration="neutral"');
    expect(eventData(events, "fragment")).toContain("what you&#39;ve saved");
    expect(events[0]?.data).toContain("new place");
    expect(events[0]?.data).toContain("already started");
    expect(events.at(-1)).toEqual({ id: "2", event: "done", data: "ok" });
    expect(narration).not.toMatch(
      /capability|intent|data_query|registry|schema|migration|handler|artifact|metrics|provider/i,
    );

    expect(prompts).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: { type: "data_query", confidence: 0.89, targetCapability: "notes" },
    });
    expect(rows[0]?.timings).toBeUndefined();
    expect(rows[0]?.gateRungs).toBeUndefined();
    expect(rows[0]?.unitAttempts).toBeUndefined();
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
      proposed_action: "Add another way to track notes inside the existing Notes capability.",
      user_facing_label: "I can add that to your notes.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makePromptBuildProvider(extendIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
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
    expect(events.map((event) => event.event)).toEqual(["fragment", "done"]);
    expect(eventData(events, "fragment")).toContain("already have Notes");
    expect(eventData(events, "fragment")).toContain('data-build-restoration-behavior="preserve"');
    expect(eventData(events, "fragment")).toContain('id="prompt-notice" hx-swap-oob="innerHTML"');
    expect(narration).not.toMatch(
      /capability|intent|extend_capability|registry|schema|migration|handler|artifact/i,
    );
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: { type: "extend_capability", confidence: 1, targetCapability: "notes" },
    });
    expect(listCapabilities(conns.readonly)).toHaveLength(1);
    expect(listCapabilities(conns.readonly)[0]?.id).toBe("notes");
    expect(existsSync(artifactsRoot)).toBe(false);
  });
});

describe("POST /prompt and GET /build/:id/stream (resolver-driven default pipeline) — duplicate guard", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-build-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("an existing registry row deflects before provider or builder work", async () => {
    insertCapability(
      notesCapabilityRow({
        id: "personal_notes",
        label: '<img src=x onerror="alert(1)">',
        incarnation_id: "22222222-2222-4222-8222-222222222222",
        artifacts_path: "capabilities/personal_notes/22222222-2222-4222-8222-222222222222/v1/",
        prompt_context: PERSONAL_NOTES_SPEC.prompt_context,
      }),
      conns.readwrite,
    );
    const { provider, prompts } = makePromptBuildProvider(newCapabilityIntent, PERSONAL_NOTES_SPEC);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "I want to keep track of my notes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
    const narration = events
      .filter((event) => event.event === "narration")
      .map((event) => event.data)
      .join("");

    expect(events.map((event) => event.event)).toEqual(["fragment", "done"]);
    expect(narration).toBe("");
    expect(eventData(events, "fragment")).toContain("&lt;img");
    expect(eventData(events, "fragment")).not.toContain("<img");
    expect(prompts).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: {
        type: "extend_capability",
        targetCapability: "personal_notes",
      },
    });
    expect(rows[0]?.timings).toBeUndefined();
    expect(rows[0]?.gateRungs).toBeUndefined();
    expect(rows[0]?.unitAttempts).toBeUndefined();
    expect(listCapabilities(conns.readonly)).toHaveLength(1);
    expect(
      conns.readonly
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cap_personal_notes'")
        .get(),
    ).toBeNull();
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test("a distinct recipe prompt is not caught by the deterministic Notes duplicate guard", async () => {
    insertCapability(
      notesCapabilityRow({
        id: "personal_notes",
        label:
          "We’ll set you up to capture and organize your notes so you can quickly find them later.",
        incarnation_id: "22222222-2222-4222-8222-222222222222",
        artifacts_path: "capabilities/personal_notes/22222222-2222-4222-8222-222222222222/v1/",
        prompt_context: PERSONAL_NOTES_SPEC.prompt_context,
      }),
      conns.readwrite,
    );
    const rejectIntent: IntentClassification = {
      type: "reject",
      confidence: 0.51,
      target_capability: null,
      proposed_action: "Do not build during this guard test.",
      user_facing_label: "I'm not quite sure what to make from that yet.",
      requires_confirmation: false,
    };
    const { provider, prompts } = makePromptBuildProvider(rejectIntent);
    const { rows, recordMetrics } = makeMetricsRecorder();
    const app = defaultPipelineApp(provider, recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "I want to keep track of my recipes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("I want to keep track of my recipes");
    expect(events.map((event) => event.event)).toEqual(["narration", "fragment", "done"]);
    expect(events[0]?.data).toContain("new place");
    expect(events[0]?.data).toContain("already started");
    expect(rows[0]).toMatchObject({
      id: jobId,
      outcome: "deflected",
      intent: { type: "reject", confidence: 0.51, targetCapability: null },
    });
    expect(existsSync(artifactsRoot)).toBe(false);
  });
});
