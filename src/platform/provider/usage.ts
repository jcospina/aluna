// Token-usage arithmetic, beside the counter it adds up.
//
// Every figure is `number | undefined`, and the whole point of these functions is that absence
// survives addition: a total stays absent unless some call actually reported it. Folding from a
// zero seed loses that — the row then says a stage cost nothing where it should say nobody
// counted, and a cost query reads unmeasured work as free.

import type { TokenUsage } from "./contract.ts";

/**
 * Anything shaped like a usage. The metrics row spells its counters as optional properties rather
 * than required-and-possibly-undefined, and both mean the same thing to arithmetic that reads them.
 */
type TokenUsageLike = { readonly [K in keyof TokenUsage]?: number | undefined };

/** Nobody reported anything. Absence, not zero — see the note above and `contract.ts`. */
export const NO_TOKEN_USAGE: TokenUsage = {
  inputTokens: undefined,
  outputTokens: undefined,
  totalTokens: undefined,
};

/**
 * A stage that provably made no provider call. Distinct from {@link NO_TOKEN_USAGE}: this one
 * says the work cost nothing, that one says nobody counted. Both were spelled out four times
 * before they lived here, and a cost query reads them differently.
 */
export const ZERO_TOKEN_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
};

/** Sum a run of usages. A figure stays absent unless at least one usage carried it. */
export function sumTokenUsages(usages: readonly TokenUsageLike[]): TokenUsage {
  const total = new TokenUsageAccumulator();
  for (const usage of usages) total.add(usage);
  return total.total();
}

/** {@link sumTokenUsages} for the two-value case, which reads better as a `reduce` step. */
export function addTokenUsage(left: TokenUsageLike, right: TokenUsageLike): TokenUsage {
  return sumTokenUsages([left, right]);
}

/** The same sum, accumulated as stages report rather than collected first. */
export class TokenUsageAccumulator {
  private input: number | undefined;
  private output: number | undefined;
  private totalTokens: number | undefined;

  add(usage: TokenUsageLike): void {
    this.input = addOptional(this.input, usage.inputTokens);
    this.output = addOptional(this.output, usage.outputTokens);
    this.totalTokens = addOptional(this.totalTokens, usage.totalTokens);
  }

  total(): TokenUsage {
    return { inputTokens: this.input, outputTokens: this.output, totalTokens: this.totalTokens };
  }
}

function addOptional(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  return (current ?? 0) + next;
}
