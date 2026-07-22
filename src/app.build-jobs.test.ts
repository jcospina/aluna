// POST /prompt and GET /build/:id/stream — the build-job queue lifecycle: a POST
// creates an ephemeral job and hands back the SSE subscriber fragment without touching
// the provider, and the per-build stream emits typed monotonic events, transport
// heartbeats during silent stages, and closes cleanly on `done`. Shared fixtures live
// in app.test-support.ts; the id-sequence and deferred helpers are local to these tests.

import { describe, expect, test } from "bun:test";

import {
  collectSseEvents,
  makeFakeProvider,
  postPrompt,
  readSse,
  responseText,
  wait,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";
import { type BuildPipeline, createBuildJobQueue } from "./build-jobs.ts";
import { createMutationCoordinator } from "./mutation-coordinator/index.ts";

function createIdSequence(ids: readonly string[]): () => string {
  let index = 0;
  return () => {
    const id = ids[index];
    if (!id) throw new Error("test exhausted build ids");
    index += 1;
    return id;
  };
}

function createDeferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

describe("POST /prompt and GET /build/:id/stream (build jobs) — admission and subscriber fragment", () => {
  test("an abandoned prompt job owns no mutation state", async () => {
    let providerCalls = 0;
    const mutationCoordinator = createMutationCoordinator();
    const app = createApp({
      mutationCoordinator,
      getProvider: () => {
        providerCalls += 1;
        return makeFakeProvider("unused", "unused");
      },
    });

    const response = await postPrompt(app, "track notes");

    expect(response.status).toBe(200);
    expect(providerCalls).toBe(0);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("POST returns the subscriber fragment immediately without touching the provider", async () => {
    let providerCalls = 0;
    const buildJobs = createBuildJobQueue({ createId: createIdSequence(["job-one"]) });
    const app = createApp({
      buildJobs,
      getProvider: () => {
        providerCalls += 1;
        return makeFakeProvider("unused", "unused");
      },
    });

    const res = await postPrompt(app, "I want to keep track of notes");
    const fragment = await responseText(res);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(fragment).toContain('data-build-job-id="job-one"');
    expect(fragment).toContain('sse-connect="/build/job-one/stream"');
    expect(fragment).toContain('sse-swap="narration"');
    expect(fragment).toContain('sse-swap="fragment"');
    expect(fragment).toContain('sse-swap="commit"');
    expect(fragment).toContain('sse-swap="metrics-preview"');
    expect(fragment).toContain('data-preview-target="spec-metrics-preview"');
    expect(fragment).toContain('sse-swap="spec-preview"');
    expect(fragment).toContain('data-preview-target="spec-build-preview"');
    expect(fragment).toContain('sse-swap="build-error-preview"');
    expect(fragment).toContain('data-preview-target="spec-gate-preview"');
    expect(fragment).toContain('id="prompt-notice" hx-swap-oob="innerHTML"');
    // Proven in Epic 2.6a: htmx-ext-sse wraps a native EventSource that auto-
    // reconnects on a server-closed stream, so the subscriber must close on `done`
    // (the htmx analogue of the raw path's source.close()) or the build re-runs.
    expect(fragment).toContain('sse-close="done"');
    expect(providerCalls).toBe(0);
  });

  test("the job stream emits typed monotonic SSE events and closes on done", async () => {
    let providerCalls = 0;
    const buildJobs = createBuildJobQueue({ createId: createIdSequence(["job-stream"]) });
    const app = createApp({
      buildJobs,
      getProvider: () => {
        providerCalls += 1;
        return makeFakeProvider("unused", "unused");
      },
    });

    await postPrompt(app, "track notes");
    const res = await app.request("/build/job-stream/stream");
    const payload = await readSse(res);
    const events = collectSseEvents(payload);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(events.map((event) => event.id)).toEqual(["0", "1"]);
    expect(events.map((event) => event.event)).toEqual(["narration", "done"]);
    expect(events[0]?.data).toMatch(/putting that together/i);
    expect(events[1]?.data).toBe("ok");
    expect(providerCalls).toBe(0);
  });
});

describe("POST /prompt and GET /build/:id/stream (build jobs) — streaming lifecycle and concurrency", () => {
  test("the job stream sends transport heartbeats while a build stage is silent", async () => {
    const pipeline: BuildPipeline = async ({ send }) => {
      await send("narration", "Starting.");
      await wait(70);
      await send("narration", "Finished.");
    };
    const buildJobs = createBuildJobQueue({
      createId: createIdSequence(["job-heartbeat"]),
      pipeline,
    });
    const app = createApp({ buildJobs, sseHeartbeatMs: 20 });

    await postPrompt(app, "track notes");
    const events = collectSseEvents(
      await readSse(await app.request("/build/job-heartbeat/stream")),
    );
    const eventNames = events.map((event) => event.event);
    const heartbeatIndex = eventNames.indexOf("heartbeat");

    expect(heartbeatIndex).toBeGreaterThan(0);
    expect(heartbeatIndex).toBeLessThan(eventNames.lastIndexOf("narration"));
    expect(events[heartbeatIndex]).toEqual({ id: "", event: "heartbeat", data: "" });
    expect(events.at(-1)).toEqual({ id: "2", event: "done", data: "ok" });
  });

  test("prompt jobs no longer use a check-then-act busy flag", async () => {
    let providerCalls = 0;
    const started = createDeferred();
    const unblock = createDeferred();
    const pipeline: BuildPipeline = async ({ send }) => {
      await send("narration", "First line.");
      started.resolve();
      await unblock.promise;
      await send("narration", "Last line.");
    };
    const buildJobs = createBuildJobQueue({
      createId: createIdSequence(["job-active", "job-after"]),
      pipeline,
    });
    const app = createApp({
      buildJobs,
      getProvider: () => {
        providerCalls += 1;
        return makeFakeProvider("unused", "unused");
      },
    });

    await postPrompt(app, "track notes");
    const streamPayload = readSse(await app.request("/build/job-active/stream"));
    await started.promise;

    const secondRes = await postPrompt(app, "track recipes");
    const secondFragment = await responseText(secondRes);

    expect(secondRes.status).toBe(200);
    expect(secondFragment).toContain('data-build-job-id="job-after"');
    expect(secondFragment).toContain('sse-connect="/build/job-after/stream"');
    expect(providerCalls).toBe(0);

    unblock.resolve();
    const payload = await streamPayload;
    const streamEvents = collectSseEvents(payload);
    expect(streamEvents.map((event) => event.event)).toEqual(["narration", "narration", "done"]);
    expect(streamEvents.map((event) => event.id)).toEqual(["0", "1", "2"]);
    expect(streamEvents.map((event) => event.data).join(" ")).toContain("First line. Last line.");

    const secondEvents = collectSseEvents(
      await readSse(await app.request("/build/job-after/stream")),
    );
    expect(secondEvents.at(-1)).toEqual({ id: "2", event: "done", data: "ok" });
  });

  test("unknown and completed job streams end cleanly with done", async () => {
    const buildJobs = createBuildJobQueue({ createId: createIdSequence(["job-complete"]) });
    const app = createApp({ buildJobs });

    const unknownEvents = collectSseEvents(
      await readSse(await app.request("/build/missing/stream")),
    );
    expect(unknownEvents).toEqual([{ id: "0", event: "done", data: "missing" }]);

    await postPrompt(app, "track notes");
    const firstRunEvents = collectSseEvents(
      await readSse(await app.request("/build/job-complete/stream")),
    );
    expect(firstRunEvents.at(-1)).toEqual({ id: "1", event: "done", data: "ok" });

    const completedEvents = collectSseEvents(
      await readSse(await app.request("/build/job-complete/stream")),
    );
    expect(completedEvents).toEqual([{ id: "0", event: "done", data: "missing" }]);
  });
});
