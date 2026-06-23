// Tests for the platform's one route file. The /stream channel calls the AI
// provider — so these drive it through a **fake** `Provider` injected into
// `createApp`, never the real one: no network, no spend, fully deterministic. (The
// real streamed round-trip is proven by running the app, not asserted here — that
// is the whole point of the rework: a test must not bill the BYO key on every run.)
// The fakeability is the contract's, by design (src/provider/contract.test.ts).
//
// Incrementality is asserted structurally (more than one narration event; the
// reassembled narration equals the greeting), not via wall-clock timing, to stay
// non-flaky. app.request() drives app.fetch without binding a port.

import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";

import { createApp } from "./app.ts";
import { type BuildPipeline, createBuildJobQueue } from "./build-jobs.ts";
import type { DeepPartial, GenerateResult, Provider } from "./provider/index.ts";

interface SseEvent {
  readonly id: string;
  readonly event: string;
  readonly data: string;
}

// A fake provider: streams `greeting` one character at a time (like the real
// partialStream building up), then resolves the validated object carrying both
// fields. No SDK, no network — it satisfies the same `Provider` contract the real
// spine does.
function makeFakeProvider(greeting: string, invitation: string): Provider {
  return {
    generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        let acc = "";
        for (const ch of greeting) {
          acc += ch;
          yield { greeting: acc } as DeepPartial<T>;
        }
        yield { greeting, invitation } as DeepPartial<T>;
      }
      return { partialStream: stream(), object: Promise.resolve({ greeting, invitation } as T) };
    },
  };
}

// A provider factory that throws — stands in for a missing key (createProvider
// throws, naming OMNI_API_KEY) without touching the environment.
function throwingProvider(message: string): () => Provider {
  return () => {
    throw new Error(message);
  };
}

// Drain an SSE response body to a single string.
async function readSse(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) throw new Error("expected a readable SSE body");
  const decoder = new TextDecoder();
  let payload = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    payload += decoder.decode(value, { stream: true });
  }
  return payload + decoder.decode();
}

// Reassemble the text of every `narration` event, in order — the greeting as the
// client would see it typed in.
function collectNarration(payload: string): string {
  return payload
    .split("\n\n")
    .filter((block) => block.includes("event: narration"))
    .map(
      (block) =>
        block
          .split("\n")
          .find((line) => line.startsWith("data:"))
          // Strip the field name and the single optional separator space (SSE drops
          // one leading space from the value), keeping the value — including a value
          // that *is* a space.
          ?.replace(/^data: ?/, "") ?? "",
    )
    .join("");
}

function collectSseEvents(payload: string): SseEvent[] {
  return payload
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const lines = block.split("\n");
      const id = lines.find((line) => line.startsWith("id:"))?.replace(/^id: ?/, "") ?? "";
      const event = lines.find((line) => line.startsWith("event:"))?.replace(/^event: ?/, "") ?? "";
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.replace(/^data: ?/, ""))
        .join("\n");
      return { id, event, data };
    });
}

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

function promptPost(prompt: string): RequestInit {
  return {
    method: "POST",
    body: new URLSearchParams({ prompt }),
  };
}

async function postPrompt(app: ReturnType<typeof createApp>, prompt: string): Promise<Response> {
  return app.request("/prompt", promptPost(prompt));
}

async function responseText(res: Response): Promise<string> {
  return res.text();
}

describe("GET /stream (provider liveness, fake provider)", () => {
  const greeting = "Hi — I'm so glad you're here.";
  const invitation = "Tell me what you'd like to keep <3";

  test("responds with SSE headers", async () => {
    const app = createApp({ getProvider: () => makeFakeProvider(greeting, invitation) });
    const res = await app.request("/stream");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");

    await res.body?.cancel();
  });

  test("streams the greeting as narration, then the invitation fragment, then closes", async () => {
    const app = createApp({ getProvider: () => makeFakeProvider(greeting, invitation) });
    const payload = await readSse(await app.request("/stream"));

    // The greeting arrived incrementally and reassembles to the whole thing.
    expect((payload.match(/event: narration/g) ?? []).length).toBeGreaterThan(1);
    expect(collectNarration(payload)).toBe(greeting);

    // The invitation rides in an HTML fragment, with its dynamic text escaped — the
    // raw "<3" must not reach the page as markup.
    expect(payload).toContain("event: fragment");
    expect(payload).toContain('<p class="intro__invitation">');
    expect(payload).toContain("keep &lt;3");
    expect(payload).not.toContain("keep <3");

    // Terminal event, server closes cleanly.
    expect(payload).toContain("event: done");
  });
});

describe("GET /stream (failure surfaces clearly, not silently)", () => {
  test("a missing key streams a product-voice apology, never a crash", async () => {
    // createProvider would throw "Missing OMNI_API_KEY ..."; the route must turn
    // that into a warm, jargon-free message — and still close cleanly (HTTP 200,
    // an SSE stream, not a 500).
    const app = createApp({ getProvider: throwingProvider("Missing OMNI_API_KEY. ...") });
    const res = await app.request("/stream");
    expect(res.status).toBe(200);

    const payload = await readSse(res);
    expect(payload).toContain("event: narration");
    expect(payload).toMatch(/mind trying again/i);
    expect(payload).toContain("event: done");
    // No internals leak into the UI copy (ARCH §9.7).
    expect(payload).not.toMatch(/OMNI_API_KEY|api key|provider/i);
    // No proposal fragment on the error path.
    expect(payload).not.toContain("event: fragment");
  });
});

describe("POST /prompt and GET /build/:id/stream (build jobs)", () => {
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

  test("a second prompt during an active job gets a transient busy notice and does not disturb the stream", async () => {
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

    const busyRes = await postPrompt(app, "track recipes");
    const busyFragment = await responseText(busyRes);

    expect(busyRes.status).toBe(200);
    expect(busyRes.headers.get("HX-Retarget")).toBe("#prompt-notice");
    expect(busyRes.headers.get("HX-Reswap")).toBe("innerHTML");
    expect(busyFragment).toContain('id="prompt-notice"');
    expect(busyFragment).toContain("Give me a moment");
    expect(busyFragment).not.toContain("job-after");
    expect(providerCalls).toBe(0);

    unblock.resolve();
    const payload = await streamPayload;
    const streamEvents = collectSseEvents(payload);
    expect(streamEvents.map((event) => event.event)).toEqual(["narration", "narration", "done"]);
    expect(streamEvents.map((event) => event.id)).toEqual(["0", "1", "2"]);
    expect(streamEvents.map((event) => event.data).join(" ")).toContain("First line. Last line.");

    const nextFragment = await responseText(await postPrompt(app, "track recipes"));
    expect(nextFragment).toContain('data-build-job-id="job-after"');
    expect(providerCalls).toBe(0);
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
