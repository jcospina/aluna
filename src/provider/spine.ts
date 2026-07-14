// The real provider — Module 1, Epic 1.5, issue 02 (ARCH §4, ADR-0003).
//
// This is the one concrete implementation of the `Provider` contract (./contract.ts).
// It is the "thin, in-process provider spine" ADR-0003 settled on: the Vercel AI
// SDK's `streamObject` does the streaming + structured-output validation, behind a
// small registry that picks the wire shape off the configured endpoint. We hand-roll
// none of that — no streaming client, no retry/routing, no schema validation. What
// stays ours is exactly this seam: mapping the SDK's result onto the contract the
// orchestrator depends on.
//
// Three wires (ADR-0003), each a baseURL-configurable SDK provider:
//   - `openai`            — first-party `@ai-sdk/openai` for OpenAI's own endpoint
//                           (Responses API, native structured outputs, tunable
//                           reasoning effort).
//   - `openai-compatible` — `@ai-sdk/openai-compatible` (Chat Completions) for every
//                           *other* OpenAI-compatible endpoint — this is the path the
//                           open Chinese coding models take (Qwen, GLM/Zhipu,
//                           Kimi/Moonshot, MiniMax, DeepSeek). They are first-class
//                           targets, identical to GPT/Claude (ADR-0003).
//   - `anthropic`         — `@ai-sdk/anthropic` for the Anthropic Messages endpoint.
//
// The SDK types live *only* in this file. Everything upstream imports the `Provider`
// contract, never the SDK — swapping the spine (or the whole provider) is invisible
// to every caller. The default is `gpt-5.6-terra` at medium reasoning effort;
// the configured trio (key + model + endpoint, ./config.ts) makes any provider a
// one-env swap (ADR-0003).

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamObject } from "ai";
import type { ZodType } from "zod";

import { type ProviderConfig, resolveProviderConfig } from "./config.ts";
import type { DeepPartial, GenerateResult, Provider } from "./contract.ts";

// The SDK's own input type, the single place its surface touches ours. Deriving
// from `streamObject` rather than importing named types keeps this resilient to the
// SDK renaming internals across versions, and keeps those types from leaking past
// this file.
type StreamObjectInput = Parameters<typeof streamObject>[0];

// The wire shapes the de-facto coding-model ecosystem has converged on (ADR-0003).
// Every provider the registry targets — GPT, Claude, Gemini, and the open Chinese
// models (Qwen3-Coder, GLM, Kimi, MiniMax, DeepSeek) — speaks one of these. OpenAI's
// own endpoint gets the first-party provider; every *other* OpenAI-compatible
// endpoint (where the Chinese models live) gets the generic compatible provider,
// which speaks Chat Completions rather than OpenAI's proprietary Responses API.
export type Wire = "openai" | "openai-compatible" | "anthropic";

// A registry entry: how to build the SDK model for a wire, plus that wire's
// provider options (reasoning tuning). Every factory is baseURL-configurable, so a
// single `OMNI_BASE_URL` reaches any compatible endpoint without an adapter we own.
interface WireAdapter {
  // The AI SDK language model for `config`, fed straight to `streamObject`.
  readonly model: (config: ProviderConfig) => StreamObjectInput["model"];
  // Per-wire request tuning (reasoning effort), forwarded to `streamObject`.
  // Undefined for wires with no universal knob (the compatible wire spans many
  // vendors) or whose default serving already fits.
  readonly providerOptions?: StreamObjectInput["providerOptions"];
}

// The registry, keyed by wire shape. Adding a provider is adding an endpoint, not
// code: the open Chinese models reach the `openai-compatible` entry by `OMNI_BASE_URL`
// alone (ADR-0003: "the registry treats them identically to Claude/GPT/Gemini").
const REGISTRY: Record<Wire, WireAdapter> = {
  openai: {
    model: ({ apiKey, baseURL, model }) => createOpenAI({ apiKey, baseURL })(model),
    // Reasoning effort for the OpenAI wire (ARCH §4): `medium` trades some latency
    // for reasoning quality on gpt-5.6-terra — the serving-tier knob the config
    // comment defers to the call site. OpenAI-specific (keyed `openai`), which is
    // exactly why it lives only on the first-party wire.
    providerOptions: { openai: { reasoningEffort: "medium" } },
  },
  "openai-compatible": {
    // Chat Completions, the wire the open Chinese models (and most other
    // OpenAI-compatible endpoints) actually implement. `name` only labels the
    // provider in error/telemetry; `baseURL` + key + model are the swap trio. No
    // reasoning option: there is no knob common across these vendors, and assuming
    // an OpenAI-only one would be presumptuous — per-endpoint tuning lands if needed.
    model: ({ apiKey, baseURL, model }) =>
      createOpenAICompatible({ name: "openai-compatible", apiKey, baseURL })(model),
  },
  anthropic: {
    model: ({ apiKey, baseURL, model }) => createAnthropic({ apiKey, baseURL })(model),
    // Claude's fast path is its default (no extended thinking), so no extra tuning.
  },
};

// Pick the wire shape off the endpoint — the registry "keyed by baseURL" (ADR-0003).
// Anthropic Messages hosts get the Anthropic wire; OpenAI's own host gets the
// first-party OpenAI wire; everything else is treated as a generic OpenAI-compatible
// endpoint (the path for the open Chinese models). A pure function so the routing is
// unit-testable without a network call.
export function selectWire(baseURL: string): Wire {
  if (/(^|\.)anthropic\.com/i.test(baseURL)) return "anthropic";
  if (/(^|\.)openai\.com/i.test(baseURL)) return "openai";
  return "openai-compatible";
}

// `streamObject` is **pull-based**: its `object` and `usage` promises only settle
// once the partial stream is consumed (verified against a live provider — awaiting
// `object` without reading the stream hangs indefinitely). The contract promises the
// opposite: a caller may iterate `partialStream`, await `object` directly, or both
// (./contract.ts). This bridges the two with a single background pump that drains the
// SDK stream as fast as it arrives — which drives `object`/`usage` to resolve even
// with no consumer — while replaying each snapshot to a caller that *does* iterate,
// preserving the live timing build narration depends on. The pump never applies
// backpressure, so a slow or absent consumer can't starve it; snapshots buffer (a
// spec is ~100 small objects), and the buffer is drained or dropped with the result.
// Exported for a network-free unit test (spine.test.ts), like `selectWire`. Single
// consumer by construction — the contract's `partialStream` is read at most once.
export function pumpStream<U>(source: AsyncIterable<U>): AsyncIterable<U> {
  const buffer: U[] = [];
  let finished = false;
  let failure: unknown;
  let hasFailure = false;
  let wake: (() => void) | undefined;
  const signal = () => {
    wake?.();
    wake = undefined;
  };

  void (async () => {
    try {
      for await (const item of source) {
        buffer.push(item);
        signal();
      }
    } catch (err) {
      failure = err;
      hasFailure = true;
    } finally {
      finished = true;
      signal();
    }
  })();

  const waitForNext = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });

  async function* drain(): AsyncGenerator<U> {
    for (;;) {
      if (buffer.length > 0) {
        yield buffer.shift() as U;
      } else if (finished) {
        break;
      } else {
        await waitForNext();
      }
    }
    if (hasFailure) {
      throw failure;
    }
  }

  return { [Symbol.asyncIterator]: drain };
}

// Build the one real provider behind the contract. Resolves the config trio eagerly
// (key + model + endpoint), so a missing key fails *here*, loudly, with the
// actionable message from `requireApiKey` — never as a confusing mid-stream error
// (issue 02: "missing key surfaces clearly"). The returned `Provider` is reusable
// across calls; the network round-trip happens lazily inside each `generate`.
export function createProvider(env: NodeJS.ProcessEnv = process.env): Provider {
  const config = resolveProviderConfig(env);
  const adapter = REGISTRY[selectWire(config.baseURL)];
  const model = adapter.model(config);

  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      // `streamObject` returns synchronously; the request streams lazily as the
      // caller drains `partialObjectStream` or awaits `object`. It validates the
      // final value against `schema` and *rejects* `object` if the model's output
      // never conforms — so the contract's "non-conformance surfaces on .object"
      // guarantee (issue 02) is the SDK's, realized, not re-implemented here.
      const result = streamObject({
        model,
        schema,
        prompt,
        providerOptions: adapter.providerOptions,
      });

      // The SDK's partial-object stream, final-object promise, and usage promise *are*
      // the contract's three handles. `partialStream` goes through `pumpStream` so the
      // request self-drives: `object`/`usage` resolve even when the caller only awaits
      // them (the SDK won't otherwise — it is pull-based). The casts cross the one seam
      // where the SDK's structurally identical `DeepPartial`/object types meet ours;
      // nothing else in the codebase sees them. `usage` is narrowed to our three-count
      // `TokenUsage`, dropping SDK-only figures (reasoning/cached tokens) M2 omits.
      return {
        partialStream: pumpStream(result.partialObjectStream) as AsyncIterable<DeepPartial<T>>,
        object: result.object as Promise<T>,
        usage: result.usage.then(({ inputTokens, outputTokens, totalTokens }) => ({
          inputTokens,
          outputTokens,
          totalTokens,
        })),
      };
    },
  };
}
