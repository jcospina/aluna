// The spec-preview decorator's drain contract — Module 2, hardened in 4.6/03.
//
// Callers drain previews in a `finally` so every `spec-preview` is on the wire before the
// terminal presentation. That makes the drain a liveness hazard: a stage that throws
// before it ever calls the provider must not leave the caller awaiting a promise nothing
// will ever settle — that would strand the exclusive build lease and the SSE connection.

import { describe, expect, test } from "bun:test";
import { z } from "zod";

import type { DeepPartial, GenerateResult, Provider } from "../provider/index.ts";
import { previewingProvider } from "./build-run.ts";

const schema = z.object({ id: z.string() });

function fakeProvider(partials: readonly unknown[]): Provider {
  return {
    generate<T>(_prompt: string, _schema: z.ZodType<T>): GenerateResult<T> {
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        for (const partial of partials) yield partial as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve(partials.at(-1) as T),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }),
      };
    },
  };
}

describe("the previewing provider", () => {
  test("drains every partial as a spec-preview before resolving", async () => {
    const sent: string[] = [];
    const { provider, flushPreviews } = previewingProvider(
      fakeProvider([{ id: "no" }, { id: "notes" }]),
      async (event, data) => void sent.push(`${event}:${data}`),
    );

    const result = provider.generate("prompt", schema);
    expect(await result.object).toEqual({ id: "notes" });
    await flushPreviews();

    expect(sent).toEqual(['spec-preview:{"id":"no"}', 'spec-preview:{"id":"notes"}']);
  });

  // The hazard: a stage can reject its input before reaching the provider at all.
  test("resolves immediately when the stage never reached the provider", async () => {
    const { flushPreviews } = previewingProvider(fakeProvider([]), async () => undefined);

    const raced = await Promise.race([
      flushPreviews().then(() => "drained"),
      Bun.sleep(250).then(() => "hung"),
    ]);
    expect(raced).toBe("drained");
  });

  test("resolves when the provider call itself throws", async () => {
    const exploding: Provider = {
      generate() {
        throw new Error("provider is unavailable");
      },
    };
    const { provider, flushPreviews } = previewingProvider(exploding, async () => undefined);

    expect(() => provider.generate("prompt", schema)).toThrow("provider is unavailable");
    const raced = await Promise.race([
      flushPreviews().then(() => "drained"),
      Bun.sleep(250).then(() => "hung"),
    ]);
    expect(raced).toBe("drained");
  });
});
