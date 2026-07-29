import { expect } from "bun:test";

/** Shared happy-path Gate contract assertions, extracted to keep the route battery focused. */
export function assertGatePreview(dataFor: (name: string) => string): void {
  const gatePreview = JSON.parse(dataFor("gate-preview")) as {
    kind: string;
    status: string;
    durationMs: number;
    rungs: Array<{ rung: string; status: string; durationMs: number }>;
    structural: {
      units: Array<{ kind: string; name: string; filename: string; status: string }>;
    };
    smoke: {
      tableName: string;
      rowCount: number;
      createFragmentLength: number;
      readFragmentLength: number;
      realDatabaseUnchanged: boolean;
    };
    behavioral: {
      tier: string;
      status: string;
      testGen: { outcome: string; testCount: number; usage: { totalTokens: number } };
      testRun: {
        outcome: string;
        caseCount: number;
        actions: Array<{ action: string; caseCount: number }>;
      };
      repair: { fixed: boolean; repairedHandlers: string[] };
      frozenIntent: { artifact: string; actionCount: number; testCount: number };
    };
  };
  expect(gatePreview.kind).toBe("gate-preview");
  expect(gatePreview.structural.units).toEqual([
    { kind: "spec", name: "spec", filename: "spec.json", status: "passed" },
    { kind: "item-renderer", name: "item", filename: "item.ts", status: "passed" },
    { kind: "handler", name: "create", filename: "create.ts", status: "passed" },
    { kind: "handler", name: "read", filename: "read.ts", status: "passed" },
    { kind: "handler", name: "update", filename: "update.ts", status: "passed" },
    { kind: "handler", name: "delete", filename: "delete.ts", status: "passed" },
    { kind: "handler", name: "search", filename: "search.ts", status: "passed" },
  ]);
  expect(gatePreview.status).toBe("passed");
  expect(gatePreview.durationMs).toBeGreaterThanOrEqual(0);
  expect(gatePreview.rungs.map((rung) => `${rung.rung}:${rung.status}`)).toEqual([
    "structural:passed",
    "smoke:passed",
    "behavioral:passed",
    "design-lint:passed",
  ]);
  expect(gatePreview.rungs.every((rung) => rung.durationMs >= 0)).toBe(true);
  expect(gatePreview.smoke).toMatchObject({
    tableName: "cap_notes",
    rowCount: 1,
    realDatabaseUnchanged: true,
  });
  expect(gatePreview.smoke.createFragmentLength).toBeGreaterThan(0);
  expect(gatePreview.smoke.readFragmentLength).toBeGreaterThan(0);
  expect(gatePreview.behavioral).toMatchObject({
    tier: "on",
    status: "passed",
    testGen: {
      outcome: "passed",
      testCount: 9,
      usage: { totalTokens: 5 * 53 },
      generatedActions: ["create", "read", "update", "delete", "search"],
      carriedActions: [],
    },
  });
  expect(gatePreview.behavioral.testRun.outcome).toBe("passed");
  expect(gatePreview.behavioral.testRun.caseCount).toBe(9);
  expect(gatePreview.behavioral.testRun.actions).toEqual([
    { action: "create", caseCount: 2 },
    { action: "read", caseCount: 1 },
    { action: "update", caseCount: 3 },
    { action: "delete", caseCount: 2 },
    { action: "search", caseCount: 1 },
  ]);
  expect(gatePreview.behavioral.repair).toMatchObject({
    fixed: false,
    repairedHandlers: [],
  });
  expect(gatePreview.behavioral.frozenIntent).toEqual({
    artifact: "tests/behavioral.json",
    actionCount: 5,
    testCount: 9,
  });
}
