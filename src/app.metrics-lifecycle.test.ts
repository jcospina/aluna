import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createScratchDbEnv,
  makeMetricsRecorder,
  makeScratchApp,
  makeSpecProvider,
  NOTES_SPEC,
  readSse,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import { getGenerationLifecycle } from "./metrics/index.ts";
import { createMutationCoordinator } from "./mutation-coordinator/index.ts";
import { createMetricsRecorder } from "./pipeline/index.ts";
import { streamSpecBuildDemo } from "./pipeline/spec-build-demo.ts";
import type { Provider } from "./provider/index.ts";

describe("admitted generation lifecycle ordering", () => {
  let env: ScratchDbEnv;

  beforeEach(() => {
    env = createScratchDbEnv("omni-crud-metrics-ordering-");
  });

  afterEach(() => {
    teardownScratchDbEnv(env);
  });

  test("the durable running row exists before the first Builder provider call", async () => {
    const generated = makeSpecProvider(NOTES_SPEC);
    const metrics = createMetricsRecorder(env.conns.readwrite);
    let providerCalls = 0;
    const provider: Provider = {
      generate(prompt, schema) {
        providerCalls += 1;
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
        return generated.provider.generate(prompt, schema);
      },
    };
    const app = makeScratchApp(env, provider, metrics);

    await readSse(await app.request("/demo/spec-build?prompt=track%20my%20notes"));

    expect(providerCalls).toBeGreaterThan(0);
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
    const generated = makeSpecProvider(NOTES_SPEC);
    const metrics = makeMetricsRecorder();
    let providerCalls = 0;
    const provider: Provider = {
      generate(prompt, schema) {
        providerCalls += 1;
        return generated.provider.generate(prompt, schema);
      },
    };

    await streamSpecBuildDemo(
      async () => {
        throw new Error("stream disconnected");
      },
      () => false,
      () => provider,
      "track my notes",
      metrics.recordMetrics,
      env.conns,
      env.artifactsRoot,
      createMutationCoordinator(),
    );

    expect(providerCalls).toBe(0);
    expect(metrics.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "cancelled",
    });
  });

  test("an abort after admission is cancelled instead of misclassified as a stage failure", async () => {
    const { provider } = makeSpecProvider(NOTES_SPEC);
    const metrics = makeMetricsRecorder();
    let aborted = false;

    await streamSpecBuildDemo(
      async (event) => {
        if (event === "migration-preview") aborted = true;
      },
      () => aborted,
      () => provider,
      "track my notes",
      metrics.recordMetrics,
      env.conns,
      env.artifactsRoot,
      createMutationCoordinator(),
    );

    expect(metrics.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "cancelled",
    });
    expect(metrics.rows.at(-1)?.failure).toBeUndefined();
  });
});
