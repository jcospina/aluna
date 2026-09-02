import type { TokenUsage } from "../../platform/provider/index.ts";

export class TokenUsageAccumulator {
  private input: number | undefined;
  private output: number | undefined;
  private totalTokens: number | undefined;

  add(usage: TokenUsage): void {
    this.input = addOptional(this.input, usage.inputTokens);
    this.output = addOptional(this.output, usage.outputTokens);
    this.totalTokens = addOptional(this.totalTokens, usage.totalTokens);
  }

  total(): TokenUsage {
    return { inputTokens: this.input, outputTokens: this.output, totalTokens: this.totalTokens };
  }
}

export function sumTokenUsages(usages: readonly TokenUsage[]): TokenUsage {
  const total = new TokenUsageAccumulator();
  for (const usage of usages) total.add(usage);
  return total.total();
}

function addOptional(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  return (current ?? 0) + next;
}
