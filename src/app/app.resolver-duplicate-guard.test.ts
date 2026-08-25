import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import type { ZodType } from "zod";
import type { IntentClassification } from "../intent-resolver/index.ts";
import type { PlatformDatabase } from "../persistence/db.ts";
import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import { insertCapability, listCapabilities } from "../registry/index.ts";
import {
  buildJobIdFromSubscriber,
  collectSseEvents,
  createScratchDbEnv,
  eventData,
  makeMetricsRecorder,
  makeScratchApp,
  notesCapabilityRow,
  postPrompt,
  readSse,
  responseText,
  teardownScratchDbEnv,
} from "./app.test-support.ts";

let dir: string;
let conns: PlatformDatabase;
let artifactsRoot: string;

function recordingProvider(intent: IntentClassification): {
  readonly provider: Provider;
  readonly prompts: string[];
} {
  const prompts: string[] = [];
  return {
    prompts,
    provider: {
      generate<T>(prompt: string, _schema: ZodType<T>): GenerateResult<T> {
        prompts.push(prompt);
        async function* stream(): AsyncGenerator<DeepPartial<T>> {
          yield intent as DeepPartial<T>;
        }
        return {
          partialStream: stream(),
          object: Promise.resolve(intent as T),
          usage: Promise.resolve({ inputTokens: 2, outputTokens: 1, totalTokens: 3 }),
        };
      },
    },
  };
}

describe("resolver duplicate guard", () => {
  beforeEach(() => {
    ({ dir, conns, artifactsRoot } = createScratchDbEnv("omni-crud-prompt-duplicate-"));
  });

  afterEach(() => teardownScratchDbEnv({ dir, conns, artifactsRoot }));

  test("an exact existing identity deflects before provider or Builder work", async () => {
    insertCapability(
      notesCapabilityRow({
        id: "personal_notes",
        label: '<img src=x onerror="alert(1)">',
        incarnation_id: "22222222-2222-4222-8222-222222222222",
        artifacts_path: "capabilities/personal_notes/22222222-2222-4222-8222-222222222222/v1/",
        seed: 184206,
        logo: { status: "absent", attempts: 0 },
      }),
      conns.readwrite,
    );
    const fallback: IntentClassification = {
      type: "new_capability",
      confidence: 0.9,
      target_capability: null,
      resolution: "new",
      proposed_identity: null,
      proposed_action: "Create another Notes capability.",
      user_facing_label: "I'll make another place for notes.",
      requires_confirmation: false,
    };
    const { provider, prompts } = recordingProvider(fallback);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp({ dir, conns, artifactsRoot }, provider, metrics.recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "I want to keep track of my personal notes")),
    );
    const events = collectSseEvents(await readSse(await app.request(`/build/${jobId}/stream`)));

    expect(events.map((event) => event.event)).toEqual(["metrics-preview", "fragment", "done"]);
    expect(eventData(events, "fragment")).toContain("&lt;img");
    expect(eventData(events, "fragment")).not.toContain("<img");
    expect(prompts).toEqual([]);
    expect(metrics.rows).toEqual([]);
    expect(metrics.resolutionRows[0]?.resolver.intent).toMatchObject({
      type: "extend_capability",
      targetCapability: "personal_notes",
    });
    expect(listCapabilities(conns.readonly)).toHaveLength(1);
    expect(existsSync(artifactsRoot)).toBe(false);
  });

  test("a distinct recipe prompt reaches the full-catalog resolver", async () => {
    insertCapability(notesCapabilityRow(), conns.readwrite);
    const reject: IntentClassification = {
      type: "reject",
      confidence: 0.51,
      target_capability: null,
      resolution: "none",
      proposed_identity: null,
      proposed_action: "Do not build during this guard test.",
      user_facing_label: "I'm not quite sure what to make from that yet.",
      requires_confirmation: false,
    };
    const { provider, prompts } = recordingProvider(reject);
    const metrics = makeMetricsRecorder();
    const app = makeScratchApp({ dir, conns, artifactsRoot }, provider, metrics.recordMetrics);

    const jobId = buildJobIdFromSubscriber(
      await responseText(await postPrompt(app, "I want to keep track of my recipes")),
    );
    await readSse(await app.request(`/build/${jobId}/stream`));

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("I want to keep track of my recipes");
    expect(metrics.rows).toEqual([]);
    expect(metrics.resolutionRows[0]?.resolver.intent.type).toBe("reject");
    expect(existsSync(artifactsRoot)).toBe(false);
  });
});
