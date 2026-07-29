import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import { createPromptBuildPipeline, type RecordMetrics } from "../pipeline/index.ts";
import { createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import { insertCapability } from "../registry/index.ts";
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
