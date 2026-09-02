import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ZodType } from "zod";

import {
  createScratchDbEnv,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "../../app/app.test-support.ts";
import { listGenerationLifecycles } from "../../platform/metrics/index.ts";
import type { GenerateResult, Provider } from "../../platform/provider/index.ts";
import { readActiveRegistryCatalog } from "../../registry/index.ts";
import { MutationCoordinator } from "../../runtime/concurrency/mutation-coordinator.ts";
import type { BuildPipelineCompletion } from "../jobs/build-jobs.ts";
import { createMetricsRecorder } from "../metrics-recorder.ts";
import { resolvedNewCapabilityRequest } from "./admission/resolved-request.ts";
import { type CoreBuildTerminal, runCoreBuild } from "./core-builder.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("omni-crud-expired-build-lease-");
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

test("lease expiry cancels a stalled stage send before the next owner starts", async () => {
  const coordinator = new MutationCoordinator({ buildLeaseTtlMs: 30 });
  const terminals: CoreBuildTerminal[] = [];
  let sendStarted!: () => void;
  const stalledSendStarted = new Promise<void>((resolve) => {
    sendStarted = resolve;
  });
  const stalled = new Promise<never>(() => undefined);
  let providerCalls = 0;
  let nextStarted = false;
  let terminalStarted!: () => void;
  const terminalPresentationStarted = new Promise<void>((resolve) => {
    terminalStarted = resolve;
  });
  let finishTerminal!: () => void;
  const terminalFinished = new Promise<void>((resolve) => {
    finishTerminal = resolve;
  });
  const provider: Provider = {
    generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
      providerCalls += 1;
      throw new Error("lease expiry should stop before provider work");
    },
  };

  const attempt = runCoreBuild({
    buildId: "stalled-stage-send",
    request: resolvedNewCapabilityRequest({
      prompt: "track my reading list",
      intent: {
        type: "new_capability",
        confidence: 0.9,
        target_capability: null,
        resolution: "new",
        proposed_identity: null,
        proposed_action: "Create a reading list.",
        user_facing_label: "Setting that up.",
        requires_confirmation: false,
      },
      catalogFingerprint: readActiveRegistryCatalog(env.conns.readonly).fingerprint,
      resolver: {
        intent: { type: "new_capability", confidence: 0.9, targetCapability: null },
        model: "test-model",
        durationMs: 1,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        catalogFingerprint: "sha256:test",
      },
    }),
    presenter: {
      send: () => {
        sendStarted();
        return stalled;
      },
      canPresent: () => true,
      isAborted: () => false,
      async present(terminal): Promise<BuildPipelineCompletion> {
        terminals.push(terminal);
        terminalStarted();
        await terminalFinished;
        return "terminal-sent";
      },
    },
    provider,
    recordMetrics: createMetricsRecorder(env.conns.readwrite),
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    mutationCoordinator: coordinator,
    builtAt: performance.now(),
  });

  await stalledSendStarted;
  const nextTicket = coordinator.reserveBuild();
  const nextLeasePromise = coordinator.acquireBuild(nextTicket);
  void nextLeasePromise.then(() => {
    nextStarted = true;
  });

  await terminalPresentationStarted;
  expect(nextStarted).toBe(false);
  finishTerminal();
  await attempt;
  expect(terminals).toMatchObject([{ kind: "cancelled" }]);
  expect(providerCalls).toBe(0);
  expect(listGenerationLifecycles(env.conns.readonly)).toMatchObject([
    { buildId: "stalled-stage-send", lifecycleStatus: "failed", outcome: "cancelled" },
  ]);
  expect(readActiveRegistryCatalog(env.conns.readonly).capabilities).toEqual([]);

  const nextLease = await nextLeasePromise;
  expect(coordinator.release(nextLease)).toBe(true);
});
