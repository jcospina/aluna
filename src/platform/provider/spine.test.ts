// Tests for the real provider spine (Epic 1.5, issue 02). Deterministic and network-free on
// purpose: the wire is selected off the endpoint, and a missing key fails loudly at construction.
//
// No test here calls a real AI provider — that would spend money on every `bun test` run. The
// real streamed, structured round-trip is proven by running the app: type a prompt into the
// prompt bar and watch the spec stream in (`POST /prompt` → `GET /build/:id/stream`). That path's
// wiring is covered without spend in src/app/app.*.test.ts, through a fake `Provider`.
// Non-conforming output on `.object` is the contract's guarantee (contract.test.ts), inherited
// here because `generate` maps straight onto `streamObject`.

import { describe, expect, test } from "bun:test";
import type { streamObject as aiStreamObject } from "ai";
import { z } from "zod";

import { API_KEY_ENV_VAR, BASE_URL_ENV_VAR, MODEL_ENV_VAR } from "./config.ts";
import { createProvider, providerFault, pumpStream, selectWire } from "./spine.ts";

describe("selectWire (the registry, keyed by baseURL)", () => {
  test("routes Anthropic Messages hosts to the Anthropic wire", () => {
    expect(selectWire("https://api.anthropic.com/v1")).toBe("anthropic");
  });

  test("routes OpenAI's own host to the first-party OpenAI wire", () => {
    expect(selectWire("https://api.openai.com/v1")).toBe("openai");
  });

  test("routes every other endpoint to the generic OpenAI-compatible wire", () => {
    // The open Chinese coding models reach the compatible wire — Chat Completions, not OpenAI's
    // Responses API — by endpoint alone, with no code path of their own.
    expect(selectWire("https://api.moonshot.cn/v1")).toBe("openai-compatible"); // Kimi
    expect(selectWire("https://open.bigmodel.cn/api/paas/v4")).toBe("openai-compatible"); // GLM
    expect(selectWire("https://api.deepseek.com/v1")).toBe("openai-compatible"); // DeepSeek
    expect(selectWire("https://dashscope.aliyuncs.com/compatible-mode/v1")).toBe(
      "openai-compatible",
    ); // Qwen
  });

  test("keys on the host, not stray path text", () => {
    // 'anthropic' in the path must not hijack the Anthropic wire; OpenAI's host wins.
    expect(selectWire("https://api.openai.com/v1/anthropic-proxy")).toBe("openai");
  });
});

describe("createProvider (failure modes surface clearly)", () => {
  test("throws a clear, actionable error at construction when the key is missing", () => {
    // Fail fast and loud, with the variable named — never a confusing mid-stream
    // failure later (issue 02 acceptance).
    expect(() => createProvider({})).toThrow(API_KEY_ENV_VAR);
    expect(() => createProvider({})).toThrow(/bring-your-own-key/i);
  });

  test("constructs without a network call once a key is present", () => {
    // `not.toThrow` alone would not notice a request going out, and this test stands between a
    // refactor and a billed call on every suite run, so count the requests instead.
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = ((...args: Parameters<typeof originalFetch>) => {
      requests += 1;
      return originalFetch(...args);
    }) as typeof fetch;

    try {
      expect(() => createProvider({ [API_KEY_ENV_VAR]: "sk-test-not-used" })).not.toThrow();
      expect(requests).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("createProvider (stage deadlines)", () => {
  test("gives every SDK call a deadline signal that settles hung handles", async () => {
    type StreamObject = typeof aiStreamObject;
    type StreamObjectInput = Parameters<StreamObject>[0];
    const never = new Promise<never>(() => undefined);
    let callSignal: AbortSignal | undefined;
    let sourceReturned = false;
    let result:
      | {
          readonly object: Promise<unknown>;
          readonly usage: Promise<unknown>;
          readonly partialStream: AsyncIterable<unknown>;
        }
      | undefined;
    const callAborted = new Promise<void>((resolve) => {
      const stalledStreamObject = ((input: StreamObjectInput) => {
        callSignal = input.abortSignal;
        input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
        return {
          partialObjectStream: {
            [Symbol.asyncIterator]() {
              return {
                next: () => never,
                return: () => {
                  sourceReturned = true;
                  return Promise.resolve({ done: true as const, value: undefined });
                },
              };
            },
          },
          object: never,
          usage: never,
        };
      }) as unknown as StreamObject;
      const provider = createProvider(
        {
          [API_KEY_ENV_VAR]: "sk-test-not-used",
          [BASE_URL_ENV_VAR]: "https://example.test/v1",
          [MODEL_ENV_VAR]: "test-model",
        },
        { generationTimeoutMs: 20, streamObject: stalledStreamObject },
      );
      result = provider.generate("wait forever", z.object({ answer: z.string() }));
    });

    if (!result) throw new Error("The test provider did not expose its result handles.");
    const streamRead = result.partialStream[Symbol.asyncIterator]().next();
    await callAborted;
    await expect(result.object).rejects.toHaveProperty("name", "ProviderStageTimeoutError");
    await expect(result.usage).rejects.toHaveProperty("name", "ProviderStageTimeoutError");
    await expect(streamRead).rejects.toHaveProperty("name", "ProviderStageTimeoutError");
    expect(callSignal?.aborted).toBe(true);
    await Bun.sleep(0);
    expect(sourceReturned).toBe(true);
  });

  test("disposes a successful call's deadline before it can abort later", async () => {
    type StreamObject = typeof aiStreamObject;
    type StreamObjectInput = Parameters<StreamObject>[0];
    let callSignal: AbortSignal | undefined;
    const cleanStreamObject = ((input: StreamObjectInput) => {
      callSignal = input.abortSignal;
      return {
        partialObjectStream: {
          [Symbol.asyncIterator]: () => ({
            next: () => Promise.resolve({ done: true as const, value: undefined }),
          }),
        },
        object: Promise.resolve({ answer: "ready" }),
        usage: Promise.resolve({ inputTokens: 1, outputTokens: 1, totalTokens: 2 }),
      };
    }) as unknown as StreamObject;
    const provider = createProvider(
      {
        [API_KEY_ENV_VAR]: "sk-test-not-used",
        [BASE_URL_ENV_VAR]: "https://example.test/v1",
        [MODEL_ENV_VAR]: "test-model",
      },
      { generationTimeoutMs: 20, streamObject: cleanStreamObject },
    );
    const result = provider.generate("finish", z.object({ answer: z.string() }));

    expect(await result.object).toEqual({ answer: "ready" });
    expect(await result.usage).toMatchObject({ totalTokens: 2 });
    await Bun.sleep(30);
    expect(callSignal?.aborted).toBe(false);
  });
});

describe("pumpStream (self-driving partial stream)", () => {
  // `pumpStream` makes the contract's "await `object` directly" promise true by draining the
  // source itself. Every fake provider's `object` resolves eagerly, so the hang hides otherwise.
  test("drives the source to completion even when nothing iterates the result", async () => {
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const source = (async function* () {
      yield 1;
      yield 2;
      resolveDone(); // reached only if the source is fully consumed
    })();

    pumpStream(source); // deliberately not iterated — the pump must drain it anyway

    const outcome = await Promise.race([
      done.then(() => "driven"),
      new Promise((resolve) => setTimeout(() => resolve("hung"), 1000)),
    ]);
    expect(outcome).toBe("driven");
  });

  test("replays every snapshot in order to a consumer that does iterate", async () => {
    const source = (async function* () {
      yield "a";
      yield "b";
      yield "c";
    })();

    const seen: string[] = [];
    for await (const item of pumpStream(source)) {
      seen.push(item);
    }
    expect(seen).toEqual(["a", "b", "c"]);
  });

  test("surfaces a source failure to the consumer, after the items that preceded it", async () => {
    const source = (async function* () {
      yield "first";
      throw new Error("stream blew up");
    })();

    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const item of pumpStream(source)) {
          seen.push(item);
        }
      })(),
    ).rejects.toThrow("stream blew up");
    expect(seen).toEqual(["first"]);
  });
});

/**
 * Verified against a live 401: `partialObjectStream` ended cleanly at 915ms while `object`/`usage`
 * were still pending at 45s. Model non-conformance is the only thing the SDK rejects `object` for.
 */
describe("providerFault (the fault the SDK swallows)", () => {
  const pending = () => new Promise<never>(() => undefined);

  test("settles a handle the SDK would have left pending for ever", async () => {
    const fault = providerFault();
    const object = fault.settle(pending());

    fault.onError({ error: new Error("Incorrect API key provided. (status 401)") });

    await expect(object).rejects.toThrow("Incorrect API key provided");
  });

  test("never overrides a handle the SDK settled itself", async () => {
    const fault = providerFault();
    const object = fault.settle(Promise.resolve({ ok: true }));

    fault.onError({ error: new Error("arrived after the object did") });

    expect(await object).toEqual({ ok: true });
  });

  test("puts the fault back on a stream that ended as though nothing was wrong", async () => {
    const fault = providerFault();
    async function* clean() {
      yield { partial: 1 };
      fault.onError({ error: new Error("rate limited") });
    }

    const read = async () => {
      const seen = [];
      for await (const item of fault.surface(clean())) seen.push(item);
      return seen;
    };

    await expect(read()).rejects.toThrow("rate limited");
  });

  test("a stream that really did end cleanly still ends cleanly", async () => {
    const fault = providerFault();
    async function* clean() {
      yield { partial: 1 };
    }

    const seen = [];
    for await (const item of fault.surface(clean())) seen.push(item);

    expect(seen).toEqual([{ partial: 1 }]);
  });

  test("a fault nothing is racing is not an unhandled rejection", async () => {
    // A caller that only iterates never touches `settle`'s promise. An unhandled
    // rejection here is a crashed process rather than a failed build.
    const fault = providerFault();
    fault.onError({ error: new Error("nobody is listening") });

    await Bun.sleep(1);
    expect(true).toBe(true);
  });
});
