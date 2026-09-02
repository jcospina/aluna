import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import { lifecycleMeasurement, recordGateFailureMetrics } from "../../pipeline/metrics-recorder.ts";
import type { GenerateResult, Provider } from "../../platform/provider/index.ts";
import { deriveCapabilityTableDdl } from "../../runtime/data/index.ts";
import { GOOD_HANDLERS, itemRendererFor, notesSpec } from "./gate.test-support.ts";
import { CapabilityGateError, runCapabilityGate } from "./gate.ts";

const USAGE = { inputTokens: 3, outputTokens: 5, totalTokens: 8 } as const;

describe("failed Gate provider accounting", () => {
  test("a failed smoke repair retains its provider usage exactly once", async () => {
    const spec = notesSpec();
    const badCreate = GOOD_HANDLERS.create.replace("text: input.values.text,", 'text: "wrong",');
    const { provider, calls } = fixedUnitProvider(badCreate);
    const error = await failedGate({
      spec,
      ddl: deriveCapabilityTableDdl(spec),
      handlers: { ...GOOD_HANDLERS, create: badCreate },
      itemRenderer: itemRendererFor(spec),
      provider,
      behavioralTier: { enabled: false },
    });

    const acc = { usages: [], timings: {} };
    recordGateFailureMetrics(acc, error);
    expect(calls()).toBe(1);
    expect(lifecycleMeasurement(acc, performance.now()).usage?.totalTokens).toBe(8);
  });

  test("passed smoke plus a failed design repair retain the failed rung usage once", async () => {
    const spec = notesSpec();
    const dirty =
      'export default function item(record: Record<string, unknown>): string { return `<article style="color:red">$' +
      "{String(record.text)}</article>`; }";
    const { provider, calls } = fixedUnitProvider(dirty);
    const error = await failedGate({
      spec,
      ddl: deriveCapabilityTableDdl(spec),
      handlers: GOOD_HANDLERS,
      itemRenderer: dirty,
      provider,
      behavioralTier: { enabled: false },
    });

    const acc = { usages: [], timings: {} };
    recordGateFailureMetrics(acc, error);
    expect(calls()).toBe(1);
    expect(lifecycleMeasurement(acc, performance.now()).usage?.totalTokens).toBe(8);
  });
});

function fixedUnitProvider(content: string): { provider: Provider; calls: () => number } {
  let count = 0;
  return {
    calls: () => count,
    provider: {
      generate<T>(_prompt: string, _schema: ZodType<T>): GenerateResult<T> {
        count += 1;
        return {
          object: Promise.resolve({ content } as T),
          usage: Promise.resolve(USAGE),
          partialStream: (async function* empty() {})(),
        };
      },
    },
  };
}

async function failedGate(
  input: Parameters<typeof runCapabilityGate>[0],
): Promise<CapabilityGateError> {
  try {
    await runCapabilityGate(input);
  } catch (error) {
    if (error instanceof CapabilityGateError) return error;
    throw error;
  }
  throw new Error("Expected the Gate to fail.");
}
