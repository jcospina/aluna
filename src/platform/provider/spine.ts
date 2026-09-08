// The one concrete implementation of the `Provider` contract: a thin, in-process provider spine.
// The Vercel AI SDK's `streamObject` does the streaming and structured-output validation, behind a
// small registry that picks the wire shape off the configured endpoint. We hand-roll no streaming
// client, no retry or routing, no schema validation.
//
// Three wires, each a baseURL-configurable SDK provider: `openai` for OpenAI's own endpoint
// (Responses API, native structured outputs, tunable reasoning effort); `openai-compatible`
// (Chat Completions) for every other OpenAI-compatible endpoint, which is the path the open
// Chinese coding models take and they are first-class targets; and `anthropic` for the Anthropic
// Messages endpoint. The SDK types live only in this file, so swapping the spine is invisible.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamObject } from "ai";
import type { ZodType } from "zod";

import { type ProviderConfig, resolveProviderConfig } from "./config.ts";
import type { DeepPartial, GenerateResult, Provider } from "./contract.ts";

// The SDK's own input type, the single place its surface touches ours. Derived from `streamObject`
// rather than imported by name, so an SDK rename across versions does not reach this file.
type StreamObjectInput = Parameters<typeof streamObject>[0];

export const DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS = 5 * 60_000;

export interface ProviderSpineOptions {
  /** Test seam; production gives every structured-generation stage five minutes. */
  readonly generationTimeoutMs?: number;
  /** Test seam for proving the SDK call receives the deadline without network I/O. */
  readonly streamObject?: typeof streamObject;
}

export class ProviderStageTimeoutError extends Error {
  override readonly name = "ProviderStageTimeoutError";
}

interface StageDeadline {
  readonly signal: AbortSignal;
  dispose(): void;
}

function openStageDeadline(
  timeoutMs: number,
  onTimeout: (error: ProviderStageTimeoutError) => void,
): StageDeadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    const error = new ProviderStageTimeoutError(
      `Provider generation exceeded its ${timeoutMs}ms stage deadline.`,
    );
    onTimeout(error);
    controller.abort(error);
  }, timeoutMs);
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

/**
 * The wire shapes the coding-model ecosystem has converged on. The generic compatible provider,
 * where the Chinese models live, speaks Chat Completions rather than the Responses API.
 */
export type Wire = "openai" | "openai-compatible" | "anthropic";

// A registry entry: how to build the SDK model for a wire, plus that wire's provider options. Every
// factory is baseURL-configurable, so one `OMNI_BASE_URL` reaches any compatible endpoint.
interface WireAdapter {
  // The AI SDK language model for `config`, fed straight to `streamObject`.
  readonly model: (config: ProviderConfig) => StreamObjectInput["model"];
  // Per-wire request tuning (reasoning effort), forwarded to `streamObject`. Undefined for a wire
  // with no universal knob — the compatible wire spans many vendors.
  readonly providerOptions?: StreamObjectInput["providerOptions"];
}

// The registry, keyed by wire shape. Adding a provider is adding an endpoint, not code: the open
// Chinese models reach `openai-compatible` by `OMNI_BASE_URL` alone (ADR-0003).
const REGISTRY: Record<Wire, WireAdapter> = {
  openai: {
    model: ({ apiKey, baseURL, model }) => createOpenAI({ apiKey, baseURL })(model),
    // `medium` trades latency for reasoning quality on gpt-5.6-terra. Keyed `openai`, so it is
    // OpenAI-specific and lives only on the first-party wire.
    providerOptions: { openai: { reasoningEffort: "medium" } },
  },
  "openai-compatible": {
    // Chat Completions, the wire the open Chinese models actually implement. `name` only labels
    // the provider in telemetry, and no reasoning knob is common across these vendors.
    model: ({ apiKey, baseURL, model }) =>
      createOpenAICompatible({ name: "openai-compatible", apiKey, baseURL })(model),
  },
  anthropic: {
    model: ({ apiKey, baseURL, model }) => createAnthropic({ apiKey, baseURL })(model),
    // Claude's fast path is its default (no extended thinking), so no extra tuning.
  },
};

/**
 * Pick the wire shape off the endpoint — the registry "keyed by baseURL". Every host that is
 * neither Anthropic's nor OpenAI's is treated as a generic OpenAI-compatible endpoint.
 */
export function selectWire(baseURL: string): Wire {
  if (/(^|\.)anthropic\.com/i.test(baseURL)) return "anthropic";
  if (/(^|\.)openai\.com/i.test(baseURL)) return "openai";
  return "openai-compatible";
}

function nextBeforeAbort<U>(
  next: Promise<IteratorResult<U>>,
  signal?: AbortSignal,
): Promise<IteratorResult<U>> {
  if (!signal) return next;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    next.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * `streamObject` is pull-based: awaiting `object` without reading the partial stream hangs for
 * ever. This pump drains it so `object`/`usage` resolve with no consumer. Single consumer.
 */
export function pumpStream<U>(
  source: AsyncIterable<U>,
  abortSignal?: AbortSignal,
): AsyncIterable<U> {
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
    const iterator = source[Symbol.asyncIterator]();
    try {
      for (;;) {
        const next = await nextBeforeAbort(iterator.next(), abortSignal);
        if (next.done) break;
        buffer.push(next.value);
        signal();
      }
    } catch (err) {
      failure = err;
      hasFailure = true;
    } finally {
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
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

/**
 * `streamObject` reports a transport fault — a rejected key, a rate limit, a dropped connection —
 * to `onError` alone, leaving `object` and `usage` pending for ever (spine.test.ts measures it).
 */
export function providerFault() {
  let report: (fault: unknown) => void = () => undefined;
  let fault: unknown;
  let faulted = false;
  const raised = new Promise<never>((_, reject) => {
    report = reject;
  });
  // A fault raised with nothing racing it — a caller that only iterates the stream — is
  // still a rejection, and an unhandled one is a crash rather than a failed build.
  void raised.catch(() => undefined);

  return {
    onError: ({ error }: { error: unknown }) => {
      fault = error;
      faulted = true;
      report(error);
    },

    /**
     * Raced rather than replaced: a fault settles a handle the SDK left open, and never overrides
     * one the SDK settled itself.
     */
    settle: <T>(handle: Promise<T>): Promise<T> => Promise.race([handle, raised]),

    /**
     * The stream with the fault put back where the SDK dropped it. A caller that only iterates
     * would otherwise read a clean, empty stream and conclude the model said nothing at all.
     */
    async *surface<U>(source: AsyncIterable<U>): AsyncGenerator<U> {
      const iterator = source[Symbol.asyncIterator]();
      try {
        for (;;) {
          const next = await Promise.race([iterator.next(), raised]);
          if (next.done) break;
          yield next.value;
        }
        if (faulted) throw fault;
      } finally {
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
      }
    },
  };
}

/**
 * Build the one real provider behind the contract. The config trio resolves eagerly, so a missing
 * key fails here with `requireApiKey`'s message rather than as a confusing mid-stream error.
 */
export function createProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: ProviderSpineOptions = {},
): Provider {
  const config = resolveProviderConfig(env);
  const adapter = REGISTRY[selectWire(config.baseURL)];
  const model = adapter.model(config);
  const generationTimeoutMs = options.generationTimeoutMs ?? DEFAULT_PROVIDER_GENERATION_TIMEOUT_MS;
  const runStreamObject = options.streamObject ?? streamObject;

  return {
    generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
      // `streamObject` validates the final value against `schema` and rejects `object` when the
      // model's output never conforms, so the non-conformance guarantee is the SDK's, not ours.
      const fault = providerFault();
      const deadline = openStageDeadline(generationTimeoutMs, (error) => fault.onError({ error }));

      let result: ReturnType<typeof streamObject>;
      try {
        result = runStreamObject({
          model,
          schema,
          prompt,
          providerOptions: adapter.providerOptions,
          abortSignal: deadline.signal,
          onError: fault.onError,
        });
      } catch (error) {
        deadline.dispose();
        throw error;
      }

      // The casts cross the one seam where the SDK's structurally identical `DeepPartial`/object
      // types meet ours. `usage` narrows to `TokenUsage`, dropping SDK-only reasoning counts.
      const object = fault.settle(result.object as Promise<T>);
      const usage = fault.settle(
        result.usage.then(({ inputTokens, outputTokens, totalTokens }) => ({
          inputTokens,
          outputTokens,
          totalTokens,
        })),
      );
      void Promise.allSettled([object, usage]).then(() => deadline.dispose());
      return {
        partialStream: fault.surface(
          pumpStream(result.partialObjectStream, deadline.signal) as AsyncIterable<DeepPartial<T>>,
        ),
        object,
        usage,
      };
    },
  };
}
