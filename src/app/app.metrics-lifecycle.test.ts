// The durable admitted-generation row's ordering guarantees, proved on the one
// production path (`POST /prompt` → `GET /build/:id/stream`). Two of the three cases
// need a subscriber that misbehaves — a `send` that throws, a `send` that cancels
// mid-build — so they drive the queue's `stream` directly rather than through an HTTP
// response, which is the same pipeline the route wires.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { INTENT_RESOLVER_PROMPT_PREFIX } from "../intent-resolver/index.ts";
import { getGenerationLifecycle } from "../metrics/index.ts";
import { createMutationCoordinator } from "../mutation-coordinator/index.ts";
import { createMetricsRecorder, createPromptBuildPipeline } from "../pipeline/index.ts";
import { createBuildJobQueue } from "../pipeline/jobs/build-jobs.ts";
import type { Provider } from "../provider/index.ts";
import {
  createScratchDbEnv,
  makeMetricsRecorder,
  makePromptBuildProvider,
  makeScratchApp,
  NEW_CAPABILITY_INTENT,
  NOTES_SPEC,
  runPromptBuild,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";

describe("admitted generation lifecycle ordering", () => {
  let env: ScratchDbEnv;

  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-metrics-ordering-");
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  // The queue the route builds, wired to a fake provider — so a test can hand `stream`
  // its own `send`/`isAborted` and watch the admitted row from a subscriber's seat.
  function promptQueue(provider: Provider, recordMetrics: ReturnType<typeof makeMetricsRecorder>) {
    return createBuildJobQueue({
      pipeline: createPromptBuildPipeline({
        getProvider: () => provider,
        recordMetrics: recordMetrics.recordMetrics,
        buildDatabases: env.conns,
        artifactsRoot: env.artifactsRoot,
        mutationCoordinator: createMutationCoordinator(),
      }),
    });
  }

  test("the durable running row exists before the first Builder provider call", async () => {
    const generated = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC);
    const metrics = createMetricsRecorder(env.conns.readwrite);
    let builderCalls = 0;
    const provider: Provider = {
      generate(prompt, schema) {
        // The resolver runs before admission by design, so only Builder-owned calls
        // carry the "the running row already exists" guarantee. Matched against the
        // resolver's own exported prefix, so a rewording cannot silently reclassify
        // every call as Builder-owned.
        if (!prompt.includes(INTENT_RESOLVER_PROMPT_PREFIX)) {
          builderCalls += 1;
          const durable = env.conns.readonly
            .query(
              `SELECT build_id, incarnation_id FROM generation_lifecycle_metrics
               WHERE lifecycle_status = 'running' ORDER BY created_at DESC LIMIT 1`,
            )
            .get() as { build_id: string; incarnation_id: string } | null;
          expect(durable).not.toBeNull();
          expect(
            getGenerationLifecycle(
              durable?.build_id ?? "",
              durable?.incarnation_id ?? "",
              env.conns.readonly,
            ),
          ).toMatchObject({
            lifecycleStatus: "running",
            outcome: null,
          });
        }
        return generated.provider.generate(prompt, schema);
      },
    };
    const app = makeScratchApp(env, provider, metrics);

    await runPromptBuild(app, "track my notes");

    expect(builderCalls).toBeGreaterThan(0);
    const terminal = env.conns.readonly
      .query(
        `SELECT build_id, incarnation_id FROM generation_lifecycle_metrics
         WHERE lifecycle_status = 'success' LIMIT 1`,
      )
      .get() as { build_id: string; incarnation_id: string };
    expect(
      getGenerationLifecycle(terminal.build_id, terminal.incarnation_id, env.conns.readonly),
    ).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });
  });

  test("a disconnected initial lifecycle preview closes the admitted row as cancelled", async () => {
    const { provider, prompts } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC);
    const metrics = makeMetricsRecorder();
    const buildJobs = promptQueue(provider, metrics);
    const { job } = buildJobs.create("track my notes");
    const seen: string[] = [];

    // The subscriber survives resolution and then goes away: the admitted row's own
    // opening preview is the first write that cannot land.
    await buildJobs.stream(
      job.id,
      async (event) => {
        seen.push(event);
        if (event === "metrics-preview") throw new Error("stream disconnected");
      },
      () => false,
    );

    // The whole conversation, in order: the resolver's one narration, the `fragment`
    // carrying the tile admission stands on the desk, then the admitted row's opening preview — nothing else may slip
    // in between, which is what makes "closed as cancelled before any Builder work" a
    // statement about admission rather than luck — and then the cancellation terminal's
    // own preview attempt, which the bounded presenter swallows when it fails too. The
    // tile itself needs no undoing here: the same dead subscriber that closed the row is
    // the one that never received it.
    // Two `fragment`s at admission: the tile on the ground, and the window's own name.
    expect(seen).toEqual([
      "narration",
      "fragment",
      "fragment",
      "metrics-preview",
      "metrics-preview",
    ]);
    // Only the resolver call was made — no Builder stage ran behind a dead subscriber.
    expect(prompts).toHaveLength(1);
    expect(metrics.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "cancelled",
    });
  });

  test("an abort after admission is cancelled instead of misclassified as a stage failure", async () => {
    const { provider } = makePromptBuildProvider(NEW_CAPABILITY_INTENT, NOTES_SPEC);
    const metrics = makeMetricsRecorder();
    const buildJobs = promptQueue(provider, metrics);
    const { job } = buildJobs.create("track my notes");
    // The route hands `stream` an AbortController signal alongside `isAborted` (app.ts),
    // and that signal is what `abortableProvider` watches. Pass both, so this covers the
    // real disconnect mechanism and not just the polling half of it.
    const abortController = new AbortController();
    let aborted = false;

    await buildJobs.stream(
      job.id,
      async (event) => {
        if (event === "migration-preview") {
          aborted = true;
          abortController.abort();
        }
      },
      () => aborted,
      abortController.signal,
    );

    expect(metrics.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "cancelled",
    });
    expect(metrics.rows.at(-1)?.failure).toBeUndefined();
  });
});
