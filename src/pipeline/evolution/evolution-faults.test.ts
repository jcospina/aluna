// The engine's fault model around the point of no return (ARCH §6.2
// steps 6–7 and "Cross-store lifecycle recovery"; PLAN decisions 27, 31; ADR-0006).
//
// Publication is a filesystem fact and activation is a SQLite fact, so the two cannot be
// one transaction. What this battery pins is the asymmetry the architecture promises
// instead: before the activation COMMIT, every failure leaves the committed version live
// (plus, at most, a complete never-activated candidate for guarded reconciliation);
// committed history is never treated as an orphan; and the durable lifecycle row always
// names the stage the run actually stopped at.
//
// This is the coverage the deleted 4.5 hand-authored tracer used to carry, now running
// through the real engine — the platform's one evolution path.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { generatedUnitsFor } from "../../builder/gate/gate.test-support.ts";
import { type CapabilityGateResult, publishCapabilitySnapshot } from "../../builder/index.ts";
import {
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
} from "../../platform/metrics/index.ts";
import { getCapability } from "../../registry/index.ts";
import {
  activated,
  behaviorNeutralDueDateCandidate,
  committedGate,
  committedSpec,
  durableLifecycle,
  type EngineEnv,
  evolve,
  handlersFor,
  INCARNATION_ID,
  setUpCommitted,
  tableColumns,
  tearDownCommitted,
  versionDirectory,
} from "./evolution-run.test-support.ts";

let gate: CapabilityGateResult;
let env: EngineEnv;

beforeAll(async () => {
  gate = await committedGate();
});

beforeEach(async () => {
  env = await setUpCommitted(gate);
});

afterEach(() => {
  tearDownCommitted(env);
});

const PRE_COMMIT_FAULTS = [
  "beforeTransaction",
  "afterMigration",
  "afterRegistryCas",
  "afterMetricsFinalized",
] as const;

describe("the point of no return", () => {
  for (const name of PRE_COMMIT_FAULTS) {
    test(`a ${name} fault leaves the committed version live`, async () => {
      await expect(
        evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
          buildId: `fault-${name}`,
          behavioralTierEnabled: false,
          // The lifecycle must ride the real write connection: `finalizeMetrics` runs
          // *inside* the activation transaction, so only SQLite's rollback can show
          // that a faulted run left no success row behind.
          durableMetrics: true,
          faults: {
            [name]: () => {
              throw new Error(`fault:${name}`);
            },
          },
        }),
      ).rejects.toThrow(`fault:${name}`);

      // The whole SQLite transaction — additive DDL, registry CAS, success metrics —
      // rolled back together, so neither the pointer nor the column landed…
      expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
      expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
      // …the durable row names where it stopped rather than claiming a success…
      expect(durableLifecycle(env, `fault-${name}`)).toMatchObject({
        lifecycleStatus: "failed",
        outcome: "activation_failed",
      });
      // …and the complete verified candidate stays on disk as an explicit recovery
      // state, never a live partial snapshot.
      expect(existsSync(versionDirectory(env, 2))).toBe(true);
    });
  }

  test("an afterCommit fault cannot undo or relabel an activation", async () => {
    // Past the point of no return: the pointer, the DDL and the `success/activated` row
    // committed together, so a later throw is observational.
    await expect(
      evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
        buildId: "fault-afterCommit",
        behavioralTierEnabled: false,
        durableMetrics: true,
        faults: {
          afterCommit: () => {
            throw new Error("fault:afterCommit");
          },
        },
      }),
    ).rejects.toThrow("fault:afterCommit");

    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
    expect(tableColumns(env, "cap_notes")).toContain("due_date");
    expect(durableLifecycle(env, "fault-afterCommit")).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });
  });

  test("a staging fault fails before publication and leaves no v2 at all", async () => {
    await expect(
      evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
        buildId: "fault-publish",
        behavioralTierEnabled: false,
        durableMetrics: true,
        beforePublish: () => {
          throw new Error("fault:publish");
        },
      }),
    ).rejects.toThrow("fault:publish");
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
    expect(durableLifecycle(env, "fault-publish")).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "publication_failed",
    });
  });
});

describe("cancellation before the point of no return", () => {
  test("cancellation during the final preview cannot publish or activate", async () => {
    let aborted = false;
    let publicationStarted = false;
    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      buildId: "cancel-final-preview",
      behavioralTierEnabled: false,
      isAborted: () => aborted,
      onSend: async (event, data) => {
        if (
          event === "candidate-preview" &&
          (JSON.parse(data) as { assembly?: { status?: string } }).assembly?.status === "complete"
        ) {
          aborted = true;
        }
      },
      beforePublish: () => {
        publicationStarted = true;
      },
    });

    expect(result.outcome.kind).toBe("cancelled");
    expect(publicationStarted).toBe(false);
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
    expect(result.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "cancelled",
    });
    expect(result.lifecycles.at(-1)?.stages).toEqual(
      expect.arrayContaining([
        { stage: "publication", state: "skipped" },
        { stage: "activation", state: "skipped" },
      ]),
    );
  });

  test("cancellation observed after publication leaves the candidate non-live", async () => {
    let aborted = false;
    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      buildId: "cancel-after-publication",
      behavioralTierEnabled: false,
      isAborted: () => aborted,
      beforePublish: () => {
        aborted = true;
      },
    });

    expect(result.outcome.kind).toBe("cancelled");
    expect(existsSync(versionDirectory(env, 2))).toBe(true);
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
    expect(result.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "cancelled",
    });
  });

  for (const boundary of ["beforeTransaction", "afterMetricsFinalized"] as const) {
    test(`cancellation observed at ${boundary} rolls activation back before COMMIT`, async () => {
      let aborted = false;
      const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
        buildId: `cancel-${boundary}`,
        behavioralTierEnabled: false,
        durableMetrics: true,
        isAborted: () => aborted,
        faults: {
          [boundary]: () => {
            aborted = true;
          },
        },
      });

      expect(result.outcome.kind).toBe("cancelled");
      expect(existsSync(versionDirectory(env, 2))).toBe(true);
      expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
      expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
      expect(durableLifecycle(env, `cancel-${boundary}`)).toMatchObject({
        lifecycleStatus: "failed",
        outcome: "cancelled",
      });
    });
  }
});

// Everything below stops earlier still: the candidate never becomes a snapshot at all.
describe("failing closed before publication", () => {
  test("a failed Gate is durable failure evidence before any publication", async () => {
    // The candidate authors fine; the regenerated create Handler never passes its checks,
    // so its bounded write→check→fix loop exhausts and the run stops at the Gate.
    const result = evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      buildId: "gate-failed",
      behavioralTierEnabled: false,
      durableMetrics: true,
      unitOverrides: { create: "export default 'not a handler';" },
    });
    await expect(result).rejects.toThrow();

    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
    expect(durableLifecycle(env, "gate-failed")).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "unit_generation_failed",
    });
  });

  test("corrupt committed history is authoritative corruption, not an evolution base", async () => {
    writeFileSync(join(versionDirectory(env, 1), "read.ts"), "corrupted\n");
    await expect(
      evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
        buildId: "corrupt",
        behavioralTierEnabled: false,
        durableMetrics: true,
      }),
    ).rejects.toThrow(/corrupt|verification/i);
    // The damaged version is left exactly where it is: recovery may never reclaim
    // committed history, and the pointer never moves off it.
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 1))).toBe(true);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    // The row shows the run stopped while assembling, with publication never attempted —
    // a corrupt base is not a publication fault (the vocabulary has no stage of its own
    // for it, so the failure message carries the reason).
    const lifecycle = durableLifecycle(env, "corrupt");
    expect(lifecycle).toMatchObject({ lifecycleStatus: "failed" });
    expect(lifecycle?.stages).toEqual(
      expect.arrayContaining([{ stage: "publication", state: "skipped" }]),
    );
    expect(lifecycle?.measurement?.failure?.message).toMatch(/verification/i);
  });

  test("an interrupted never-activated candidate is reconciled before the retry publishes", async () => {
    const crashedBuildId = "v2-interrupted";
    publishCapabilitySnapshot({
      buildId: crashedBuildId,
      spec: committedSpec(),
      incarnationId: INCARNATION_ID,
      version: 2,
      units: generatedUnitsFor(committedSpec(), handlersFor(committedSpec())),
      gate,
      artifactsRoot: env.artifactsRoot,
    });
    startGenerationLifecycle(
      { buildId: crashedBuildId, incarnationId: INCARNATION_ID, capabilityId: "notes" },
      env.conns.readwrite,
    );
    expect(reconcileRunningGenerationLifecycles(env.conns.readwrite)).toBe(1);

    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      buildId: "v2-after-interruption",
      behavioralTierEnabled: false,
    });
    const outcome = activated(result);
    expect(outcome.publication.manifest.build_id).toBe("v2-after-interruption");
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
  });

  test("a cancel before assembly stops the run and finalizes the row as cancelled", async () => {
    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      buildId: "cancelled",
      behavioralTierEnabled: false,
      // Already cancelled when the run starts: the candidate is authored (the provider
      // call is in flight before the first check), then the run stops before the Diff's
      // work is assembled.
      isAborted: () => true,
    });
    expect(result.outcome.kind).toBe("cancelled");
    expect(result.generatedUnits).toEqual([]);
    expect(result.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "cancelled",
    });
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
  });
});

/** Every tracked source path under the given roots, with its text. */
async function sourceFiles(
  roots: readonly string[],
  pattern: string,
): Promise<{ path: string; text: string }[]> {
  const files: { path: string; text: string }[] = [];
  for (const root of roots) {
    for await (const file of new Glob(pattern).scan(root)) {
      const path = join(root, file);
      files.push({ path, text: await Bun.file(path).text() });
    }
  }
  return files;
}

describe("the engine is the only evolution path", () => {
  test("the 4.5 hand-authored regenerate-all seam is gone from the tree", async () => {
    const files = await sourceFiles(["src", "public", "scripts"], "**/*.{ts,js,html,css,json}");
    const seam = /hand-authored|handAuthored|hand_authored|v2-tracer|v2Tracer/i;
    const hits = files
      // This file names the seam in order to assert its absence.
      .filter((file) => !file.path.endsWith("evolution-faults.test.ts"))
      .filter((file) => seam.test(file.text))
      .map((file) => file.path);
    expect(hits).toEqual([]);
  });

  test("exactly two non-test modules publish a capability snapshot: v1 and evolution", async () => {
    const files = await sourceFiles(["src"], "**/*.ts");
    const callers = files
      // The definition site and the barrels that re-export it are not call sites.
      .filter((file) => !file.path.includes(".test"))
      .filter((file) => !file.path.startsWith(join("src", "builder", "artifacts")))
      .filter((file) => !file.path.endsWith("index.ts"))
      .filter((file) => file.text.includes("publishCapabilitySnapshot("))
      .map((file) => file.path)
      .sort();
    expect(callers).toEqual([
      join("src", "pipeline", "build", "build-run.ts"),
      join("src", "pipeline", "evolution", "evolution-run.ts"),
    ]);
  });
});
