import { describe, expect, test } from "bun:test";

import {
  frozenTestsInput,
  fullHandlersFor,
  itemRendererFor,
  notesSpec,
} from "../../builder/gate/gate.test-support.ts";
import {
  runCapabilityGate,
  type UnitGenerationAttempt,
  UnitGenerationError,
} from "../../builder/index.ts";
import { deriveCapabilityTableDdl } from "../../capability-data/index.ts";
import { buildDemoErrorPreview, buildGatePreview } from "./previews.ts";

describe("build developer error preview", () => {
  test("preserves the unit and every strict-TypeScript attempt after generation exhausts", () => {
    const attempts: UnitGenerationAttempt[] = [1, 2].map((attempt) => ({
      attempt,
      durationMs: attempt,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      error: `/tmp/unit.ts:94:39 - 'candidate.fields' is of type 'unknown'.`,
    }));
    const error = new UnitGenerationError({ kind: "handler", name: "update" }, attempts);

    expect(buildDemoErrorPreview(error)).toEqual({
      kind: "build-error-preview",
      status: "failed",
      errorName: "UnitGenerationError",
      message: expect.stringContaining("'candidate.fields' is of type 'unknown'"),
      diagnostic: {
        unit: { kind: "handler", name: "update" },
        attempts,
      },
    });
  });
});

describe("build Gate preview", () => {
  test("leads with compact repair/execution evidence and keeps frozen bytes out of the panel", async () => {
    const spec = notesSpec();
    const gate = await runCapabilityGate({
      spec,
      ddl: deriveCapabilityTableDdl(spec),
      handlers: fullHandlersFor(spec, {}),
      itemRenderer: itemRendererFor(spec),
      behavioralTier: { enabled: true, frozen: frozenTestsInput(spec) },
    });

    const preview = buildGatePreview(
      gate.durationMs,
      gate.outcomes,
      gate.structural,
      gate.smoke,
      gate.behavioral,
    );
    if (preview.behavioral.tier !== "on") throw new Error("expected tier-on preview");

    expect(preview.behavioral.testRun).toMatchObject({
      outcome: "passed",
      caseCount: 9,
    });
    expect(preview.behavioral.repair).toMatchObject({ fixed: false, repairedHandlers: [] });
    expect(preview.behavioral.frozenIntent).toEqual({
      artifact: "tests/behavioral.json",
      actionCount: 5,
      testCount: 9,
    });
    expect(preview.behavioral).not.toHaveProperty("frozenTests");
    expect(preview.behavioral.testRun).not.toHaveProperty("cases");
    expect(JSON.stringify(preview)).not.toContain("setupRows");
    expect(JSON.stringify(preview).length).toBeLessThan(JSON.stringify(gate).length / 2);
  });
});
