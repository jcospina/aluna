import { afterEach, beforeEach, expect, test } from "bun:test";
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
  NOTES_SPEC,
  notesCapabilityRow,
  postPrompt,
  READ_HANDLER,
  readSse,
  responseText,
  type ScratchDbEnv,
  SEARCH_HANDLER,
  teardownScratchDbEnv,
  UPDATE_HANDLER,
  wait,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";
import { createMutationCoordinator } from "./mutation-coordinator/index.ts";
import type { RecordMetrics } from "./pipeline/index.ts";
import type { DeepPartial, GenerateResult, Provider } from "./provider/index.ts";
import { getCapability, insertCapability } from "./registry/index.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-complete-view-");
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

function newCapabilityThenFailingSpec(): Provider {
  const responses: unknown[] = [
    {
      type: "new_capability",
      confidence: 0.97,
      target_capability: null,
      proposed_action: "Create a recipes capability.",
      user_facing_label: "Got it. I'm putting that together now.",
      requires_confirmation: false,
    },
    {},
  ];
  return {
    generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      const response = responses.shift();
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield response as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(response as T),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      };
    },
  };
}

function newCapabilityThenHangingSpec(): {
  readonly provider: Provider;
  readonly specStarted: Promise<void>;
} {
  let call = 0;
  let markSpecStarted!: () => void;
  const specStarted = new Promise<void>((resolve) => {
    markSpecStarted = resolve;
  });
  const provider: Provider = {
    generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      call += 1;
      if (call === 1) {
        const intent = {
          type: "new_capability",
          confidence: 0.97,
          target_capability: null,
          proposed_action: "Create a recipes capability.",
          user_facing_label: "Got it. I'm putting that together now.",
          requires_confirmation: false,
        } as T;
        return {
          partialStream: (async function* () {
            yield intent as DeepPartial<T>;
          })(),
          object: Promise.resolve(intent),
          usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
        };
      }

      markSpecStarted();
      return {
        partialStream: (async function* () {})(),
        object: new Promise<T>(() => undefined),
        usage: new Promise(() => undefined),
      };
    },
  };
  return { provider, specStarted };
}

function successfulBuildProvider(): Provider {
  const responses: unknown[] = [
    {
      type: "new_capability",
      confidence: 0.97,
      target_capability: null,
      proposed_action: "Create a notes capability.",
      user_facing_label: "Got it. I'm putting that together now.",
      requires_confirmation: false,
    },
    NOTES_SPEC,
    { content: ITEM_RENDERER },
    { content: CREATE_HANDLER },
    { content: READ_HANDLER },
    { content: UPDATE_HANDLER },
    { content: DELETE_HANDLER },
    { content: SEARCH_HANDLER },
    BEHAVIORAL_SUITE,
  ];
  return {
    generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      const response = responses.shift() as T;
      return {
        partialStream: (async function* () {
          yield response as DeepPartial<T>;
        })(),
        object: Promise.resolve(response),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      };
    },
  };
}

test("a failed admitted build restores the captured live View through read", async () => {
  insertCapability(notesCapabilityRow(), env.conns.readwrite);
  const mutationCoordinator = createMutationCoordinator();
  const { recordMetrics } = makeMetricsRecorder();
  const app = createApp({
    getProvider: newCapabilityThenFailingSpec,
    recordMetrics,
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases: env.conns },
    mutationCoordinator,
  });
  const post = await app.request("/prompt", {
    method: "POST",
    body: new URLSearchParams({
      prompt: "track recipes",
      __aluna_restore_capability_id: "notes",
      __aluna_restore_incarnation_id: "11111111-1111-4111-8111-111111111111",
    }),
  });
  const jobId = buildJobIdFromSubscriber(await responseText(post));

  const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
  const restoration = eventData(events, "fragment");

  expect(events.map(({ event }) => event)).not.toContain("commit");
  expect(events.at(-1)).toMatchObject({ event: "done", data: "error" });
  expect(restoration).toContain('data-build-restoration="capability"');
  expect(restoration).toContain('data-active-capability-id="notes"');
  expect(restoration).toContain('data-search-state="idle"');
  expect(restoration).toContain('hx-get="/capability/notes/read" hx-trigger="load"');
  expect(restoration).not.toContain("hx-swap-oob");
  expect(mutationCoordinator.snapshot().activeLease).toBeNull();
});

test("a connected cancellation restores the captured View before done", async () => {
  insertCapability(notesCapabilityRow(), env.conns.readwrite);
  const mutationCoordinator = createMutationCoordinator();
  const { recordMetrics } = makeMetricsRecorder();
  const { provider, specStarted } = newCapabilityThenHangingSpec();
  const app = createApp({
    getProvider: () => provider,
    recordMetrics,
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases: env.conns },
    mutationCoordinator,
  });
  const post = await app.request("/prompt", {
    method: "POST",
    body: new URLSearchParams({
      prompt: "track recipes",
      __aluna_restore_capability_id: "notes",
      __aluna_restore_incarnation_id: "11111111-1111-4111-8111-111111111111",
    }),
  });
  const jobId = buildJobIdFromSubscriber(await responseText(post));
  const stream = await app.request(`/build/${jobId}/stream`);
  const payload = readSse(stream);
  await specStarted;

  expect((await app.request(`/build/${jobId}/cancel`, { method: "POST" })).status).toBe(202);
  const events = collectSseEvents(await payload);
  const fragmentIndex = events.findIndex(({ event }) => event === "fragment");
  const doneIndex = events.findIndex(({ event }) => event === "done");

  expect(events.map(({ event }) => event)).not.toContain("commit");
  expect(fragmentIndex).toBeGreaterThan(-1);
  expect(doneIndex).toBeGreaterThan(fragmentIndex);
  expect(events[doneIndex]?.data).toBe("error");
  expect(events[fragmentIndex]?.data).toContain('data-build-restoration="capability"');
  expect(events[fragmentIndex]?.data).toContain(
    'hx-get="/capability/notes/read" hx-trigger="load"',
  );
  expect(
    JSON.parse(eventData(events, "metrics-preview").split("\n").at(-1) ?? "null"),
  ).toMatchObject({ lifecycleStatus: "failed", outcome: "cancelled" });
  expect(mutationCoordinator.snapshot().activeLease).toBeNull();
});

test("cancellation before the stream opens preserves the descriptor for restoration", async () => {
  insertCapability(notesCapabilityRow(), env.conns.readwrite);
  const mutationCoordinator = createMutationCoordinator();
  const { recordMetrics } = makeMetricsRecorder();
  const { provider } = newCapabilityThenHangingSpec();
  const app = createApp({
    getProvider: () => provider,
    recordMetrics,
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases: env.conns },
    mutationCoordinator,
  });
  const post = await app.request("/prompt", {
    method: "POST",
    body: new URLSearchParams({
      prompt: "track recipes",
      __aluna_restore_capability_id: "notes",
      __aluna_restore_incarnation_id: "11111111-1111-4111-8111-111111111111",
    }),
  });
  const jobId = buildJobIdFromSubscriber(await responseText(post));

  expect((await app.request(`/build/${jobId}/cancel`, { method: "POST" })).status).toBe(202);
  const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

  expect(events.map(({ event }) => event)).not.toContain("commit");
  expect(eventData(events, "fragment")).toContain('data-build-restoration="capability"');
  expect(events.at(-1)).toMatchObject({ event: "done", data: "error" });
  expect(mutationCoordinator.snapshot().activeLease).toBeNull();
});

test("post-activation payload failure keeps success authoritative and uses recovery", async () => {
  const mutationCoordinator = createMutationCoordinator();
  const { lifecycles, recordMetrics } = makeMetricsRecorder();
  const succeed = recordMetrics.succeed;
  const get = recordMetrics.get;
  let activated = false;
  const postActivationFault = Object.assign(recordMetrics, {
    succeed(input: Parameters<RecordMetrics["succeed"]>[0]) {
      succeed(input);
      activated = true;
    },
    get(buildId: string, incarnationId: string) {
      if (activated) throw new Error("post-activation metrics preview unavailable");
      return get(buildId, incarnationId);
    },
  }) satisfies RecordMetrics;
  const app = createApp({
    getProvider: successfulBuildProvider,
    recordMetrics: postActivationFault,
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases: env.conns },
    mutationCoordinator,
  });
  const jobId = buildJobIdFromSubscriber(
    await responseText(await postPrompt(app, "track my notes")),
  );

  const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

  expect(getCapability("notes", env.conns.readonly)).toMatchObject({ version: 1 });
  expect(lifecycles.at(-1)).toMatchObject({
    lifecycleStatus: "success",
    outcome: "activated",
  });
  expect(events.map(({ event }) => event)).not.toContain("fragment");
  expect(events.map(({ event }) => event)).not.toContain("build-error-preview");
  expect(events.at(-2)).toMatchObject({ event: "narration" });
  expect(events.at(-1)).toMatchObject({ event: "done", data: "error" });
  expect(mutationCoordinator.snapshot().activeLease).toBeNull();
  const reload = await app.request("/capability/notes", {
    headers: { "HX-Request": "true" },
  });
  const rehydrated = await reload.text();
  expect(rehydrated).toContain('data-active-capability-id="notes"');
  expect(rehydrated).toContain('hx-get="/capability/notes/read" hx-trigger="load"');
});

test("a production SSE disconnect after commit preserves activation and releases its lease", async () => {
  const mutationCoordinator = createMutationCoordinator();
  const { lifecycles, recordMetrics } = makeMetricsRecorder();
  const app = createApp({
    getProvider: successfulBuildProvider,
    recordMetrics,
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases: env.conns },
    mutationCoordinator,
  });
  const jobId = buildJobIdFromSubscriber(
    await responseText(await postPrompt(app, "track my notes")),
  );
  const response = await app.request(`/build/${jobId}/stream`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("expected build SSE body");
  const decoder = new TextDecoder();
  let received = "";
  while (!received.includes("event: commit\n")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error("build stream ended before commit");
    received += decoder.decode(chunk.value, { stream: true });
  }
  await reader.cancel();

  for (let attempt = 0; attempt < 50 && mutationCoordinator.snapshot().activeLease; attempt += 1) {
    await wait(10);
  }
  expect(getCapability("notes", env.conns.readonly)).toMatchObject({ version: 1 });
  expect(lifecycles.at(-1)).toMatchObject({
    lifecycleStatus: "success",
    outcome: "activated",
  });
  expect(mutationCoordinator.snapshot().activeLease).toBeNull();

  const rehydrated = await (
    await app.request("/capability/notes", { headers: { "HX-Request": "true" } })
  ).text();
  expect(rehydrated).toContain('data-active-capability-id="notes"');
  expect(rehydrated).toContain('hx-get="/capability/notes/read" hx-trigger="load"');
});
