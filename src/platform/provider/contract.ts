// The pluggable AI provider contract (ARCH §4, ADR-0003).
//
// The single seam the orchestrator depends on, and it depends on no specific SDK: the spine that
// realizes this contract is the Vercel AI SDK behind a baseURL-keyed registry, but that lives
// behind `generate` and never leaks through it. Swapping the spine, or the whole provider, is
// invisible to every caller. The only third-party type here is the Zod schema, which is what
// makes *a structured object validated against the schema* both a compile-time type and a runtime
// guarantee.
//
// This file ships the shape and nothing else — no network, no SDK, no domain logic.

import type { ZodType } from "zod";

/**
 * A recursive partial: every field optional, all the way down, arrays included — the shape an
 * object takes mid-stream. Defined locally so no SDK type leaks into the contract.
 */
export type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/**
 * Token counts for a single `generate` call, the measurement the metrics row records (ARCH §6.2).
 * A count is `number | undefined`: not every provider reports every figure, and absence is honest.
 */
export interface TokenUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly totalTokens: number | undefined;
}

/**
 * The result of a single `generate` call, returned synchronously: the stream is available at once
 * and the network round-trip happens lazily behind these handles (ADR-0002/0003).
 */
export interface GenerateResult<T> {
  // Successive deep-partial snapshots as the object streams in. Iterating to completion is
  // optional; a caller that only wants the final value can await `object` directly.
  readonly partialStream: AsyncIterable<DeepPartial<T>>;
  // The final object, validated against the schema passed to `generate`. Rejects when the model's
  // output never conforms, rather than silently returning a malformed object.
  readonly object: Promise<T>;
  // Token usage, resolved once the response is finished (same lifetime as `object`). Required,
  // not optional: measurement is part of the contract, so every stage can record what it cost.
  readonly usage: Promise<TokenUsage>;
}

/**
 * One method: stream a structured object conforming to `schema`. There is no model parameter — the
 * model is configured globally in exactly one place (./config.ts, ARCH §4).
 */
export interface Provider {
  generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T>;
}
