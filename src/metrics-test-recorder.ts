import type {
  GenerationLifecycle,
  GenerationMetrics,
  StartGenerationLifecycleInput,
  StoredGenerationLifecycle,
} from "./metrics/index.ts";
import type { RecordMetrics } from "./pipeline/index.ts";

type TerminalInput = Parameters<RecordMetrics["succeed"]>[0] | Parameters<RecordMetrics["fail"]>[0];

const STORED_AT = "2026-07-21T00:00:00Z";

function keyFor(buildId: string, incarnationId: string): string {
  return `${buildId}/${incarnationId}`;
}

function requireLifecycle(
  rows: Map<string, GenerationLifecycle>,
  buildId: string,
  incarnationId: string,
): GenerationLifecycle {
  const key = keyFor(buildId, incarnationId);
  const current = rows.get(key);
  if (!current) throw new Error(`missing lifecycle ${key}`);
  return current;
}

function legacyTerminalRow(
  current: GenerationLifecycle,
  input: TerminalInput,
  lifecycleStatus: "success" | "failed",
): GenerationMetrics {
  const intent = current.resolver?.intent ?? {
    type: "new_capability" as const,
    confidence: 1,
    targetCapability: null,
  };
  const base: GenerationMetrics = {
    id: input.buildId,
    outcome: lifecycleStatus === "success" ? "success" : "failure",
    model: input.measurement.model,
    intent,
    capabilityId: current.capabilityId,
    incarnationId: input.incarnationId,
  };
  return Object.assign(
    base,
    input.measurement.usage && { usage: input.measurement.usage },
    input.measurement.timings && { timings: input.measurement.timings },
    input.measurement.gateRungs && { gateRungs: input.measurement.gateRungs },
    input.measurement.unitAttempts && { unitAttempts: input.measurement.unitAttempts },
    input.measurement.failure && { failure: input.measurement.failure },
  );
}

// Test-only in-memory lifecycle. The legacy `rows` projection keeps older pipeline
// assertions readable while `lifecycles` exposes every running/identity/terminal transition.
export function makeMetricsRecorder(): {
  rows: GenerationMetrics[];
  lifecycles: GenerationLifecycle[];
  recordMetrics: RecordMetrics;
} {
  const rows: GenerationMetrics[] = [];
  const lifecycleByKey = new Map<string, GenerationLifecycle>();
  const lifecycles: GenerationLifecycle[] = [];
  const legacy = (metrics: GenerationMetrics) => void rows.push(metrics);

  const finish = (
    input: TerminalInput,
    lifecycleStatus: "success" | "failed",
    outcome: NonNullable<GenerationLifecycle["outcome"]>,
  ) => {
    const current = requireLifecycle(lifecycleByKey, input.buildId, input.incarnationId);
    const next: GenerationLifecycle = {
      ...current,
      lifecycleStatus,
      outcome,
      stages: input.stages,
      measurement: input.measurement,
    };
    lifecycleByKey.set(keyFor(input.buildId, input.incarnationId), next);
    lifecycles.push(next);
    rows.push(legacyTerminalRow(current, input, lifecycleStatus));
  };

  const recordMetrics = Object.assign(legacy, {
    start(input: StartGenerationLifecycleInput): GenerationLifecycle {
      const lifecycle: GenerationLifecycle = {
        buildId: input.buildId,
        incarnationId: input.incarnationId,
        capabilityId: input.capabilityId ?? null,
        lifecycleStatus: "running",
        outcome: null,
        resolver: input.resolver ?? null,
        measurement: input.measurement ?? null,
        stages: input.stages ?? [],
      };
      lifecycleByKey.set(keyFor(input.buildId, input.incarnationId), lifecycle);
      lifecycles.push(lifecycle);
      return lifecycle;
    },
    identify(buildId: string, incarnationId: string, capabilityId: string): void {
      const current = requireLifecycle(lifecycleByKey, buildId, incarnationId);
      const next = { ...current, capabilityId };
      lifecycleByKey.set(keyFor(buildId, incarnationId), next);
      lifecycles.push(next);
    },
    succeed(input: Parameters<RecordMetrics["succeed"]>[0]): void {
      finish(input, "success", input.outcome);
    },
    fail(input: Parameters<RecordMetrics["fail"]>[0]): void {
      finish(input, "failed", input.outcome);
    },
    get(buildId: string, incarnationId: string): StoredGenerationLifecycle | null {
      const current = lifecycleByKey.get(keyFor(buildId, incarnationId));
      return current ? { ...current, createdAt: STORED_AT, updatedAt: STORED_AT } : null;
    },
  }) satisfies RecordMetrics;

  return { rows, lifecycles, recordMetrics };
}
