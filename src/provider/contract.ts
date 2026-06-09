// The pluggable AI provider contract — Module 1, Epic 1.5 (ARCH §4 "Model
// strategy", ADR-0003).
//
// This is the single seam the orchestrator depends on. It does NOT depend on any
// specific SDK: the spine that realizes this contract is the Vercel AI SDK behind
// a baseURL-keyed registry (ADR-0003), but that lives behind `generate` and never
// leaks through it. Swapping the spine — or the whole provider — is invisible to
// every caller of this interface. The only third-party type that appears here is
// the Zod schema, which is a schema/validation library, not a provider SDK: it is
// what makes "structured object validated against the schema" both a compile-time
// type (`z.infer`) and a runtime guarantee (`schema.parse`).
//
// The concrete provider call lands in issue 02 and must be implementable behind
// this exact shape. This file ships the shape and nothing else — no network, no
// SDK, no domain logic (Module 1's "zero domain logic" line, modules.md §1).

import type { ZodType } from "zod";

// A recursive partial: every field optional, all the way down, arrays included.
// This mirrors the shape an object takes *mid-stream*, before the model has
// emitted every field — exactly what `streamObject`'s partial stream yields
// (ADR-0003). Defined locally rather than imported so no SDK type leaks into the
// contract.
export type DeepPartial<T> =
  T extends Array<infer U>
    ? Array<DeepPartial<U>>
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

// The result of a single `generate` call. Streaming is first-class: `partialStream`
// exposes the object as it is built (for build narration → Hono SSE, ADR-0002/0003),
// and `object` resolves to the final value once it is complete *and* validated
// against the schema. Returned synchronously — the stream is available immediately
// and the network round-trip happens lazily behind these handles (the `streamObject`
// shape, ADR-0003).
export interface GenerateResult<T> {
  // Successive deep-partial snapshots of the object as it streams in. Iterating to
  // completion is optional; a caller that only wants the final value can await
  // `object` directly.
  readonly partialStream: AsyncIterable<DeepPartial<T>>;
  // The final object, parsed and validated against the schema passed to `generate`.
  // Rejects if the model's output never conforms — non-conformance surfaces here
  // rather than silently returning a malformed object (issue 02 leans on this).
  readonly object: Promise<T>;
}

// The contract. One method: stream a structured object that conforms to `schema`
// in response to `prompt`. There is deliberately **no model parameter** — the
// model is configured globally in exactly one place (see ./config.ts, ARCH §4);
// callers never select a model per call.
export interface Provider {
  generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T>;
}
