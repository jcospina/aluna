// The foreground story of a refused build (PLAN decisions 28, 29, 31;
// ADR-0002).
//
// The living demo, driven through the real HTTP + SSE surface: a prompt is classified
// against the registry as it stands, another writer commits a new version of the same
// capability while that classification is in flight, and the build reaches the head of its
// lease holding a target that no longer exists.
//
// What the person sees is a warm line and their own View back. What the developer panel
// sees is one direct `failed/stale` row with every generation stage skipped. What never
// happens is a second provider call: the refusal costs nothing beyond the resolution that
// was already paid for, and no product state moves.

import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ZodType } from "zod";
import type { IntentClassification } from "../intent-resolver/index.ts";
import { listGenerationLifecycles } from "../metrics/index.ts";
import { createMetricsRecorder } from "../pipeline/index.ts";
import { STALE_BUILD_NOTICE } from "../pipeline/streaming/terminal-presentation.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import { getCapability, insertCapability } from "../registry/index.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  NOTES_INCARNATION_ID,
  notesCapabilityRow,
  readSse,
  responseText,
  type ScratchDbEnv,
  teardownScratchDbEnv,
} from "./app.test-support.ts";
import { createApp } from "./app.ts";

let env: ScratchDbEnv;

beforeEach(() => {
  env = createScratchDbEnv("aluna-stale-refusal-");
  insertCapability(notesCapabilityRow(), env.conns.readwrite);
});

afterEach(() => {
  teardownScratchDbEnv(env);
});

const EXTEND_INTENT: IntentClassification = {
  type: "extend_capability",
  confidence: 0.96,
  target_capability: "notes",
  resolution: "extend",
  proposed_identity: null,
  proposed_action: "Add a due date to notes.",
  user_facing_label: "I'll add a due date.",
  requires_confirmation: false,
};

/**
 * Classify the prompt, and — in the same moment, before the request can reach the head of
 * the mutation queue — let another writer take Notes to v2. This is the two-tab race with
 * its timing made deterministic: the resolver has already read the v1 catalog, and the
 * registry moves underneath it while its answer is still being produced.
 */
function racingResolver(onClassify: () => void): { provider: Provider; calls: number } {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    provider: {
      generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
        state.calls += 1;
        onClassify();
        async function* stream(): AsyncGenerator<DeepPartial<T>> {
          yield EXTEND_INTENT as DeepPartial<T>;
        }
        return {
          partialStream: stream(),
          object: Promise.resolve(EXTEND_INTENT as T),
          usage: Promise.resolve({ inputTokens: 30, outputTokens: 8, totalTokens: 38 }),
        };
      },
    },
  };
}

function commitCompetingVersion(): void {
  env.conns.readwrite.run(
    'UPDATE "capability_registry" SET "version" = 2 WHERE "id" = ? AND "incarnation_id" = ?',
    ["notes", NOTES_INCARNATION_ID],
  );
}

function promptBody(prompt: string): URLSearchParams {
  return new URLSearchParams({
    prompt,
    __aluna_restore_capability_id: "notes",
    __aluna_restore_incarnation_id: NOTES_INCARNATION_ID,
  });
}

test("a registry change between resolution and the lease head refuses stale and restores the View", async () => {
  const resolver = racingResolver(commitCompetingVersion);
  const app = createApp({
    getProvider: () => resolver.provider,
    recordMetrics: createMetricsRecorder(env.conns.readwrite),
    buildDatabases: env.conns,
    artifactsRoot: env.artifactsRoot,
    capabilityRouter: { databases: env.conns },
  });

  const fragment = await responseText(
    await app.request("/prompt", {
      method: "POST",
      body: promptBody("add a due date and make it stand out"),
    }),
  );
  const jobId = buildJobIdFromSubscriber(fragment);
  const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));
  const names = events.map((event) => event.event);

  // The warm foreground story: a product-voice line with no internals in it, the canonical
  // committed View restored beneath it, and a terminal `done`.
  expect(eventData(events, "narration")).toContain(STALE_BUILD_NOTICE);
  expect(eventData(events, "fragment")).toContain('data-build-restoration="capability"');
  expect(eventData(events, "fragment")).toContain('id="prompt-notice"');
  expect(eventData(events, "done")).toBe("error");
  // `commit` stays reserved for a real pointer activation, and there was none.
  expect(names).not.toContain("commit");
  // Nothing about the refusal leaks the machinery that produced it.
  expect(eventData(events, "narration")).not.toContain("fingerprint");
  expect(eventData(events, "narration")).not.toContain("catalog");
  expect(eventData(events, "narration")).not.toContain("stale");

  // One provider call: the resolution that was already paid for. The Builder never ran.
  expect(resolver.calls).toBe(1);
  // The competing version is still the live one — a refusal changes no product state.
  expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);

  const rows = listGenerationLifecycles(env.conns.readonly);
  expect(rows).toHaveLength(1);
  const refused = rows[0];
  expect(refused).toMatchObject({
    buildId: jobId,
    lifecycleStatus: "failed",
    outcome: "stale",
    // Evolution files its refusal under the incarnation it expected.
    incarnationId: NOTES_INCARNATION_ID,
    capabilityId: "notes",
  });
  expect(refused?.stages.every((stage) => stage.state === "skipped")).toBe(true);
  expect(refused?.resolver?.intent).toMatchObject({
    type: "extend_capability",
    targetCapability: "notes",
  });

  // …and the same row is what the dev metrics preview carried to the panel: the living
  // demo's claim is that a developer can see the refusal *and* see that nothing ran.
  const preview = JSON.parse(eventData(events, "metrics-preview"));
  expect(preview).toMatchObject({ lifecycleStatus: "failed", outcome: "stale" });
  expect(preview.stages.length).toBeGreaterThan(0);
  expect((preview.stages as { state: string }[]).every((stage) => stage.state === "skipped")).toBe(
    true,
  );
});
