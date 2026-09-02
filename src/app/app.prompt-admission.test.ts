import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ZodType } from "zod";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import { createPromptBuildPipeline, type RecordMetrics } from "../pipeline/index.ts";
import { createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import type { PlatformDatabase } from "../platform/persistence/db.ts";
import type { DeepPartial, GenerateResult, Provider } from "../platform/provider/index.ts";
import { insertCapability } from "../registry/index.ts";
import { BLANK_PROMPT_NOTICE, renderPromptNotice } from "../web/index.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  makeMetricsRecorder,
  notesCapabilityRow,
  postPrompt,
  readSse,
  responseText,
  teardownScratchDbEnv,
  wait,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";

function rejectingProvider(prompts: string[]): Provider {
  const response = {
    type: "reject",
    confidence: 0.4,
    target_capability: null,
    resolution: "none",
    proposed_identity: null,
    proposed_action: "Do not build.",
    user_facing_label: "I'm not quite sure what to make from that yet.",
    requires_confirmation: false,
  } as const;
  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      prompts.push(prompt);
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield schema.parse(response) as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(schema.parse(response)),
        usage: Promise.resolve({ inputTokens: 8, outputTokens: 2, totalTokens: 10 }),
      };
    },
  };
}

async function expectCancelledBeforeAdmission(
  conns: PlatformDatabase,
  artifactsRoot: string,
): Promise<void> {
  insertCapability(notesCapabilityRow(), conns.readwrite);
  const mutationCoordinator = createMutationCoordinator();
  const { resolutionRows, recordMetrics } = makeMetricsRecorder();
  const buildJobs = createBuildJobQueue({
    createId: () => "prompt-cancelled",
    pipeline: createPromptBuildPipeline({
      getProvider: () => rejectingProvider([]),
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      mutationCoordinator,
    }),
  });
  const { job } = buildJobs.create("track my notes");
  expect(buildJobs.cancel(job.id)).toBe(true);

  await buildJobs.stream(
    job.id,
    async () => undefined,
    () => false,
  );

  expect(resolutionRows).toHaveLength(1);
  expect(resolutionRows[0]).toMatchObject({
    promptJobId: job.id,
    outcome: "cancelled",
    resolver: { intent: { type: "extend_capability", targetCapability: "notes" } },
  });
  expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
}

async function expectConsistentLateCancellation(
  conns: PlatformDatabase,
  artifactsRoot: string,
): Promise<void> {
  insertCapability(notesCapabilityRow(), conns.readwrite);
  const mutationCoordinator = createMutationCoordinator();
  const { resolutionRows, recordMetrics } = makeMetricsRecorder();
  const buildJobs = createBuildJobQueue({
    createId: () => "prompt-late-cancel",
    pipeline: createPromptBuildPipeline({
      getProvider: () => rejectingProvider([]),
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      mutationCoordinator,
    }),
  });
  const { job } = buildJobs.create("track my notes");
  const sent: { event: string; data: string }[] = [];

  await buildJobs.stream(
    job.id,
    async (event, data) => {
      sent.push({ event, data });
      if (event === "metrics-preview") buildJobs.cancel(job.id);
    },
    () => false,
  );

  expect(resolutionRows[0]?.outcome).toBe("completed");
  expect(sent.at(-1)).toEqual({ event: "done", data: "ok" });
  expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
}

async function expectCompletionBeforeMetricsLease(
  conns: PlatformDatabase,
  artifactsRoot: string,
): Promise<void> {
  const mutationCoordinator = createMutationCoordinator();
  const recordLease = mutationCoordinator.tryAcquireRecordWrite();
  expect(recordLease).toBeDefined();
  const { resolutionRows, recordMetrics } = makeMetricsRecorder();
  const buildJobs = createBuildJobQueue({
    createId: () => "prompt-contended-metrics",
    pipeline: createPromptBuildPipeline({
      getProvider: () => rejectingProvider([]),
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      mutationCoordinator,
    }),
  });
  const { job } = buildJobs.create("purple semaphore");
  const sent: { event: string; data: string }[] = [];
  const stream = buildJobs.stream(
    job.id,
    async (event, data) => void sent.push({ event, data }),
    () => false,
  );

  const completion = await Promise.race([
    stream.then(() => "done" as const),
    wait(100).then(() => "blocked" as const),
  ]);

  expect(completion).toBe("done");
  expect(sent.at(-1)).toEqual({ event: "done", data: "ok" });
  expect(resolutionRows).toEqual([]);
  expect(mutationCoordinator.snapshot()).toMatchObject({
    activeLease: { kind: "record" },
    queuedTickets: [{ kind: "platform" }],
  });
  expect(recordLease && mutationCoordinator.release(recordLease)).toBe(true);
  for (let attempt = 0; attempt < 20 && resolutionRows.length === 0; attempt += 1) {
    await wait(1);
  }
  expect(resolutionRows).toHaveLength(1);
  expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
}

// A provider that fails loudly if anything reaches it. A blank prompt must be refused
// before classification, so the interesting assertion is the call count, not a status.
function forbiddenProvider(calls: { count: number }): Provider {
  return {
    generate<T>(): GenerateResult<T> {
      calls.count += 1;
      throw new Error("a blank prompt must never reach the provider");
    },
  };
}

// One blank submission per body encoding `readPromptSubmission` accepts — the guard
// must sit above the parser's content-type branch, not inside one of them. Every body
// here is whitespace-only or absent: whitespace passes the shell field's HTML5
// `required`, so the browser guard alone cannot cover it.
function blankSubmissions(): ReadonlyArray<{ name: string; init: RequestInit }> {
  const multipart = new FormData();
  multipart.set("prompt", "\t\n  ");
  return [
    {
      name: "JSON whitespace",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "   " }),
      },
    },
    {
      name: "JSON with no prompt field",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    },
    {
      name: "urlencoded form",
      init: { method: "POST", body: new URLSearchParams({ prompt: " " }) },
    },
    { name: "multipart form", init: { method: "POST", body: multipart } },
    {
      name: "raw text",
      init: { method: "POST", headers: { "content-type": "text/plain" }, body: "  \n " },
    },
    {
      name: "JSON default-ignorable/control characters",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "\u200b\u2060\u0000\ufe0f" }),
      },
    },
    {
      name: "malformed multipart form",
      init: {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=broken" },
        body: '--broken\r\nContent-Disposition: form-data; name="prompt"\r\n\r\nhello',
      },
    },
  ];
}

describe("blank-prompt refusal", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-blank-prompt-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  for (const { name, init } of blankSubmissions()) {
    test(`a blank ${name} body creates no job and spends no provider call`, async () => {
      const calls = { count: 0 };
      let issuedJobIds = 0;
      const mutationCoordinator = createMutationCoordinator();
      const { resolutionRows, recordMetrics } = makeMetricsRecorder();
      const app = createApp({
        getProvider: () => forbiddenProvider(calls),
        recordMetrics,
        buildDatabases: conns,
        artifactsRoot,
        capabilityRouter: { databases: conns },
        mutationCoordinator,
        buildJobs: createBuildJobQueue({
          createId: () => {
            issuedJobIds += 1;
            return `blank-job-${issuedJobIds}`;
          },
          pipeline: createPromptBuildPipeline({
            getProvider: () => forbiddenProvider(calls),
            recordMetrics,
            buildDatabases: conns,
            artifactsRoot,
            mutationCoordinator,
          }),
        }),
      });

      const response = await app.request("/prompt", init);
      const body = await responseText(response);

      // 200 with only the out-of-band notice: HTMX does not swap a non-2xx by default,
      // so a 422 here would make a blank submit look like nothing happened at all.
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      // A refusal, so it carries the marker the prompt bar flashes on (PLAN decision 24).
      expect(body).toBe(renderPromptNotice(BLANK_PROMPT_NOTICE, "refusal"));
      expect(body).toContain("<span data-prompt-refusal>");
      // The signed-off line itself, pinned as a literal: comparing the body to the
      // renderer alone would compare the implementation to itself and let a silent
      // copy edit ship green past the sign-off gate.
      expect(body).toContain("What would you like me to make?");
      // No subscriber fragment means no SSE stream opens, so `promptBusy` never flips
      // and the prompt bar stays live for the next attempt.
      expect(body).not.toContain("data-build-job-id");
      expect(body).not.toContain("sse-connect");
      expect(issuedJobIds).toBe(0);
      expect(resolutionRows).toEqual([]);
      expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });

      // The provider lives behind `/build/:id/stream`, so a call count taken after the
      // POST alone would read zero with or without the guard. Open the stream for the id
      // the queue *would* have issued: an unknown job answers `done: missing` and runs no
      // pipeline, which is what makes the zero call count load-bearing.
      const stream = collectSseEvents(
        await readSse(await app.request("/build/blank-job-1/stream")),
      );
      expect(stream.map((event) => `${event.event}:${event.data}`)).toEqual(["done:missing"]);
      expect(calls.count).toBe(0);
      expect(issuedJobIds).toBe(0);
    });
  }

  test("the bar's own guard is in front of the server's, and says the same thing", async () => {
    // Defence in depth, and one answer: the bar refuses a blank submission before it can
    // become a request — an empty field and one holding only spaces alike, because the
    // browser's own `required` could tell those apart and would answer only the first,
    // in its own voice, after a window had already been stood up for it. The server
    // refuses every submission that did not come from that bar.
    const html = await responseText(
      await createApp({ capabilityRouter: { databases: conns } }).request("/"),
    );
    const fieldStart = html.lastIndexOf("<input", html.indexOf('id="spec-build-prompt"'));
    const field = html.slice(fieldStart, html.indexOf(">", fieldStart) + 1);
    const bar = readFileSync(resolve("public/prompt-bar.js"), "utf8");

    expect(field).toContain('id="spec-build-prompt"');
    expect(field).toContain('name="prompt"');
    expect(field).not.toContain("required");
    expect(bar).toContain(`const BLANK_PROMPT_NOTICE = "${BLANK_PROMPT_NOTICE}";`);
    expect(bar).toContain("/[\\p{White_Space}\\p{Default_Ignorable_Code_Point}\\p{Cc}]/gu");
  });

  test("a typed prompt still enters the build-job lifecycle unchanged", async () => {
    const calls = { count: 0 };
    const { recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: () => forbiddenProvider(calls),
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      buildJobs: createBuildJobQueue({ createId: () => "typed-job" }),
    });

    const body = await responseText(await postPrompt(app, "track my notes"));

    expect(body).toContain('data-build-job-id="typed-job"');
    expect(body).toContain('sse-connect="/build/typed-job/stream"');
    expect(calls.count).toBe(0);
  });
});

describe("prompt submission parsing", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-parsing-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("content-type matching is case-insensitive, exact, and preserves parsed text", async () => {
    const capturedPrompts: string[] = [];
    const buildJobs = createBuildJobQueue({
      createId: () => "mixed-case-json-job",
      pipeline: async ({ job }) => {
        capturedPrompts.push(job.prompt);
      },
    });
    const app = createApp({
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      buildJobs,
    });

    const response = await app.request("/prompt", {
      method: "POST",
      headers: { "content-type": "Application/JSON; Charset=UTF-8" },
      body: JSON.stringify({ prompt: "track my telescopes" }),
    });
    expect(buildJobIdFromSubscriber(await responseText(response))).toBe("mixed-case-json-job");
    await buildJobs.stream(
      "mixed-case-json-job",
      async () => undefined,
      () => false,
    );

    const rawResponse = await app.request("/prompt", {
      method: "POST",
      headers: { "content-type": "text/plain; note=application/json" },
      body: "keep this as literal text",
    });
    expect(buildJobIdFromSubscriber(await responseText(rawResponse))).toBe("mixed-case-json-job");
    await buildJobs.stream(
      "mixed-case-json-job",
      async () => undefined,
      () => false,
    );

    expect(capturedPrompts).toEqual(["track my telescopes", "keep this as literal text"]);
  });

  test("format characters inside a visible prompt do not rewrite or refuse it", async () => {
    let capturedPrompt = "";
    const prompt = "track my family 👨‍👩‍👧‍👦 photos";
    const buildJobs = createBuildJobQueue({
      createId: () => "joined-emoji-job",
      pipeline: async ({ job }) => {
        capturedPrompt = job.prompt;
      },
    });
    const app = createApp({
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      buildJobs,
    });

    const response = await app.request("/prompt", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: prompt,
    });
    expect(buildJobIdFromSubscriber(await responseText(response))).toBe("joined-emoji-job");
    await buildJobs.stream(
      "joined-emoji-job",
      async () => undefined,
      () => false,
    );

    expect(capturedPrompt).toBe(prompt);
  });
});

describe("prompt-job admission separation", () => {
  let dir: string;
  let conns: PlatformDatabase;
  let artifactsRoot: string;

  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-admission-"));
  });

  afterEach(() => {
    teardownScratchDbEnv({ dir, conns, artifactsRoot });
  });

  test("an abandoned prompt job owns no mutation ticket or lease", async () => {
    const mutationCoordinator = createMutationCoordinator();
    let providerRequested = false;
    const { recordMetrics } = makeMetricsRecorder();
    const app = createApp({
      getProvider: () => {
        providerRequested = true;
        return rejectingProvider([]);
      },
      recordMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      mutationCoordinator,
    });

    const response = await postPrompt(app, "track my notes");

    expect(response.status).toBe(200);
    expect(providerRequested).toBe(false);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("losing the best-effort resolution write cannot delay or fail warm completion", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const prompts: string[] = [];
    const { resolutionRows, recordMetrics } = makeMetricsRecorder();
    const lossyMetrics = Object.assign(recordMetrics, {
      resolve() {
        throw new Error("simulated process loss before resolver metrics persistence");
      },
    }) satisfies RecordMetrics;
    const app = createApp({
      getProvider: () => rejectingProvider(prompts),
      recordMetrics: lossyMetrics,
      buildDatabases: conns,
      artifactsRoot,
      capabilityRouter: { databases: conns },
      mutationCoordinator,
    });
    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "purple semaphore")),
    );

    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(prompts).toHaveLength(1);
    expect(events.map((event) => event.event)).toEqual([
      "narration",
      "metrics-preview",
      "fragment",
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({ event: "done", data: "ok" });
    expect(resolutionRows).toEqual([]);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("the prompt job retains the content-free resolver outcome and timing in memory", async () => {
    const mutationCoordinator = createMutationCoordinator();
    const prompts: string[] = [];
    const { resolutionRows, recordMetrics } = makeMetricsRecorder();
    const buildJobs = createBuildJobQueue({
      createId: () => "prompt-memory",
      pipeline: createPromptBuildPipeline({
        getProvider: () => rejectingProvider(prompts),
        recordMetrics,
        buildDatabases: conns,
        artifactsRoot,
        mutationCoordinator,
      }),
    });
    const { job } = buildJobs.create("purple semaphore");

    await buildJobs.stream(
      job.id,
      async () => undefined,
      () => false,
    );

    expect(job.resolution).toMatchObject({
      outcome: "non_build",
      intent: { type: "reject" },
      catalogFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      resolver: {
        durationMs: expect.any(Number),
        catalogFingerprint: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(job.resolution?.buildRequest).toBeUndefined();
    expect(resolutionRows).toHaveLength(1);
    expect(mutationCoordinator.snapshot()).toEqual({ queuedTickets: [], activeLease: null });
  });

  test("cancellation before admission records cancelled, never completed", async () => {
    await expectCancelledBeforeAdmission(conns, artifactsRoot);
  });

  test("cancellation during preview cannot disagree with the captured terminal outcome", async () => {
    await expectConsistentLateCancellation(conns, artifactsRoot);
  });

  test("warm completion never waits for the queued resolution-metrics lease", async () => {
    await expectCompletionBeforeMetricsLease(conns, artifactsRoot);
  });
});
