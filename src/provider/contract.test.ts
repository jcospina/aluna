// Tests for the provider contract (Epic 1.5). The contract carries no
// implementation, so these tests prove its *shape* holds the guarantees the issue
// asks for: it is implementable by more than one provider (two independent fakes,
// driven through one consumer that depends only on the `Provider` interface — no
// SDK in sight), it streams the object as it builds, and its `object` is validated
// against the schema (a non-conforming fake surfaces the failure rather than
// returning garbage). The real provider call arrives in issue 02.

import { describe, expect, test } from "bun:test";
import { type ZodType, z } from "zod";

import type { DeepPartial, GenerateResult, Provider, TokenUsage } from "./contract.ts";

// The schema a caller hands to `generate` — a tiny stand-in for the structured
// output the orchestrator will ask for later.
const ProposalSchema = z.object({
  title: z.string(),
  fields: z.array(z.string()),
  ready: z.boolean(),
});
type Proposal = z.infer<typeof ProposalSchema>;

// A fixed usage both fakes report — the contract requires the handle, and a real
// provider fills it from the SDK's `usage` (the spine). Tests that don't care about
// counts ignore it; the usage test below asserts it threads through unchanged.
const STUB_USAGE: TokenUsage = { inputTokens: 7, outputTokens: 11, totalTokens: 18 };

// A consumer written against the contract and nothing else: drain the stream,
// then take the validated object. This is the shape the orchestrator depends on —
// it never knows which provider is behind it.
async function collect<T>(provider: Provider, prompt: string, schema: ZodType<T>) {
  const result = provider.generate(prompt, schema);
  const snapshots: DeepPartial<T>[] = [];
  for await (const partial of result.partialStream) {
    snapshots.push(partial);
  }
  return { snapshots, object: await result.object };
}

// Fake #1 — streams the object key by key, validating the final value against the
// schema. Genuinely incremental, like `streamObject`'s partial stream.
function makeEchoProvider(raw: unknown): Provider {
  return {
    generate<T>(_prompt: string, schema: ZodType<T>): GenerateResult<T> {
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
          const acc: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(raw)) {
            acc[key] = value;
            yield { ...acc } as DeepPartial<T>;
          }
        } else {
          yield raw as DeepPartial<T>;
        }
      }
      return {
        partialStream: stream(),
        object: Promise.resolve().then(() => schema.parse(raw)),
        usage: Promise.resolve(STUB_USAGE),
      };
    },
  };
}

// Fake #2 — a different implementation: emits the whole object in one snapshot.
// Same interface, same validation guarantee, no shared code with Fake #1.
function makeImmediateProvider(raw: unknown): Provider {
  return {
    generate<T>(_prompt: string, schema: ZodType<T>): GenerateResult<T> {
      async function* stream(): AsyncGenerator<DeepPartial<T>> {
        yield raw as DeepPartial<T>;
      }
      return {
        partialStream: stream(),
        object: Promise.resolve().then(() => schema.parse(raw)),
        usage: Promise.resolve(STUB_USAGE),
      };
    },
  };
}

describe("Provider contract", () => {
  const proposal: Proposal = { title: "Photos", fields: ["caption", "url"], ready: true };

  test("is implementable by more than one provider behind the same interface", async () => {
    for (const provider of [makeEchoProvider(proposal), makeImmediateProvider(proposal)]) {
      const { object } = await collect(provider, "help me keep my photos", ProposalSchema);
      // The same consumer drives both — neither knows which is behind it.
      expect(object).toEqual(proposal);
      expect(ProposalSchema.safeParse(object).success).toBe(true);
    }
  });

  test("resolves a structured object validated against the provided schema", async () => {
    const { object } = await collect(makeImmediateProvider(proposal), "p", ProposalSchema);
    // Typed as Proposal at compile time; conformant at runtime.
    expect(object.title).toBe("Photos");
    expect(object.fields).toEqual(["caption", "url"]);
    expect(object.ready).toBe(true);
  });

  test("streams the object as it builds, ending on the complete value", async () => {
    const { snapshots } = await collect(makeEchoProvider(proposal), "p", ProposalSchema);
    // More than one snapshot proves the object arrived incrementally, not in one blob.
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots.at(-1)).toEqual(proposal);
  });

  test("exposes token usage for the call alongside the object", async () => {
    // The measurement handle the metrics row records (ARCH §6.2). A required part of
    // the contract: every consumer of `generate` can read what the call cost.
    const result = makeImmediateProvider(proposal).generate("p", ProposalSchema);
    await expect(result.usage).resolves.toEqual(STUB_USAGE);
  });

  test("surfaces non-conforming output as a rejection on .object", async () => {
    // `fields` should be an array of strings; this provider emits a string.
    const bad = makeImmediateProvider({ title: "x", fields: "nope", ready: true });
    const result = bad.generate("p", ProposalSchema);
    await expect(result.object).rejects.toThrow();
  });
});
