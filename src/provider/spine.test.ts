// Tests for the real provider spine (Epic 1.5, issue 02). Deterministic and
// network-free on purpose: the wire is selected off the endpoint, and a missing
// key fails loudly at construction.
//
// There is deliberately **no test here that calls a real AI provider** — that
// would spend money on every `bun test` run. The real streamed, structured
// round-trip is proven by *running the app*: the shell's "Meet Aluna" trigger
// streams a live provider greeting into the content area (src/app.ts `/stream`,
// the Module-1 finalized place). The route's own wiring is covered without spend
// in app.test.ts, which drives it through a fake `Provider` — the same fakeability
// the contract was built for (contract.test.ts). Non-conforming output surfacing
// on `.object` is the contract's guarantee (contract.test.ts), inherited here
// because `generate` maps straight onto `streamObject`.

import { describe, expect, test } from "bun:test";

import { API_KEY_ENV_VAR } from "./config.ts";
import { createProvider, pumpStream, selectWire } from "./spine.ts";

describe("selectWire (the registry, keyed by baseURL)", () => {
  test("routes Anthropic Messages hosts to the Anthropic wire", () => {
    expect(selectWire("https://api.anthropic.com/v1")).toBe("anthropic");
  });

  test("routes OpenAI's own host to the first-party OpenAI wire", () => {
    expect(selectWire("https://api.openai.com/v1")).toBe("openai");
  });

  test("routes every other endpoint to the generic OpenAI-compatible wire", () => {
    // The open Chinese coding models are first-class targets (ADR-0003): they reach
    // the compatible wire — Chat Completions, not OpenAI's Responses API — by
    // endpoint alone, no code path of their own.
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
    // Building the provider is pure wiring; nothing is sent until `generate` runs.
    expect(() => createProvider({ [API_KEY_ENV_VAR]: "sk-test-not-used" })).not.toThrow();
  });
});

describe("pumpStream (self-driving partial stream)", () => {
  // `streamObject` is pull-based: its `object`/`usage` only settle once the partial
  // stream is consumed. `pumpStream` is what makes the contract's "await `object`
  // directly" promise true — it drains the source itself. These guard that, without a
  // live provider: the regression (awaiting object hangs) would resurface silently
  // otherwise, since every fake provider's `object` resolves eagerly.
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
