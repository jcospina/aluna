// The behavioral-tier transition table, end to end (PLAN decision 24;
// ADR-0006). Every one of decision 24's six rows, driven through the real engine over real
// snapshots on disk, asserting the two durable things a row is a claim about: what the
// published version *carries* (its tier, its inventory, its per-Action tier metadata) and
// what the metrics stage vector *says it did* (the aggregate pair plus the per-Action test
// rows). The table's rules themselves are pinned in `behavioral-tier-transition.test.ts`.
//
// The committed v1 every case starts from is tier-off (`committedGate` builds it that way),
// so the off→ rows evolve straight off it and the on→ rows publish a tier-on v2 first.
// Providers are fake: no network, no spend.

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type CapabilityGateResult, verifyCapabilitySnapshot } from "../../../builder/index.ts";
import type { StoredGenerationLifecycle } from "../../../platform/metrics/index.ts";
import type { CapabilitySpec } from "../../../registry/index.ts";
import { getCapability } from "../../../registry/index.ts";
import {
  activated,
  behaviorNeutralDueDateCandidate,
  committedGate,
  committedSpec,
  durableLifecycle,
  type EngineEnv,
  type EvolveResult,
  evolve,
  setUpCommitted,
  tearDownCommitted,
  versionDirectory,
} from "../run/evolution-run.test-support.ts";
import type { BehavioralTierTransitionRow } from "./behavioral-tier-transition.ts";

let gate: CapabilityGateResult;
let env: EngineEnv;

const FROZEN_TESTS_FILE = "tests/behavioral.json";
const ACTIONS = ["create", "read", "update", "delete", "search"] as const;

/**
 * The tier-on base the on→ rows evolve from: the additive due-date candidate, published
 * with the tier on, showing both fields in the list so a later case has a field it can take
 * *away*. Publishing it is itself decision 24's off→on row, since the committed v1 carries
 * no frozen tests at all.
 */
function tierOnBaseSpec(): CapabilitySpec {
  const neutral = behaviorNeutralDueDateCandidate();
  return {
    ...neutral,
    ui_intent: {
      ...neutral.ui_intent,
      item: { ...neutral.ui_intent.item, shows: ["text", "due_date"] },
    },
  };
}

/** One more optional, non-searchable field: the additive change the write Actions see. */
function withRemindedAt(base: CapabilitySpec): CapabilitySpec {
  return {
    ...base,
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "reminded_at",
          label: "Reminded at",
          type: "date",
          required: false,
          lifecycle: "active",
        },
      ],
    },
  };
}

async function publishTierOnBase(buildId: string): Promise<CapabilitySpec> {
  const base = tierOnBaseSpec();
  activated(await evolve(env, base, "add a due date", { behavioralTierEnabled: true, buildId }));
  return base;
}

/** The rows the transition named, as `action:row` (or bare `row` for the tier-off rows). */
function transitionRows(result: EvolveResult): string[] {
  return activated(result).assembly.behavioralTierTransition.rows.map((entry) =>
    entry.action ? `${entry.action}:${entry.row}` : entry.row,
  );
}

/**
 * What the published version carries. A tier-off row's whole claim is an absence, so it is
 * asserted three ways — the manifest's tier, its verified inventory, and the directory
 * itself — because any one of them alone could be true while a stale artifact sat on disk.
 */
function expectSnapshotArtifacts(
  directory: string,
  expected: "present" | "absent",
): ReturnType<typeof verifyCapabilitySnapshot>["manifest"] {
  const verified = verifyCapabilitySnapshot(directory);
  expect(verified.manifest.behavioral_tier).toBe(expected === "present" ? "on" : "off");
  expect(verified.files.includes(FROZEN_TESTS_FILE)).toBe(expected === "present");
  expect(existsSync(join(directory, FROZEN_TESTS_FILE))).toBe(expected === "present");
  expect(verified.manifest.behavioral_tests !== undefined).toBe(expected === "present");
  return verified.manifest;
}

function stages(result: EvolveResult): StoredGenerationLifecycle["stages"] {
  const recorded = result.lifecycles.at(-1)?.stages;
  if (!recorded) throw new Error("the run recorded no lifecycle stages");
  return recorded;
}

/** The two aggregate behavioral stage rows — the ones carrying no `test` subject. */
function aggregateTestStages(result: EvolveResult): string[] {
  return stages(result)
    .filter(
      (stage) =>
        !stage.test &&
        (stage.stage === "behavioral_test_generation" ||
          stage.stage === "behavioral_test_execution"),
    )
    .map((stage) => `${stage.stage}:${stage.state}`);
}

/** The per-Action behavioral stage rows, as `action:generation/execution`. */
function actionTestStages(result: EvolveResult): string[] {
  const byAction = new Map<string, { generation?: string; execution?: string }>();
  for (const stage of stages(result)) {
    if (!stage.test) continue;
    const entry = byAction.get(stage.test.name) ?? {};
    if (stage.stage === "behavioral_test_generation") entry.generation = stage.state;
    if (stage.stage === "behavioral_test_execution") entry.execution = stage.state;
    byAction.set(stage.test.name, entry);
  }
  return [...byAction].map(([action, entry]) => `${action}:${entry.generation}/${entry.execution}`);
}

/** Every `action:row` the table should have named, for a row that applies to all five. */
function everyAction(row: BehavioralTierTransitionRow): string[] {
  return ACTIONS.map((action) => `${action}:${row}`);
}

describe("decision 24's transition table — the tier-off rows", () => {
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });

  afterEach(() => {
    tearDownCommitted(env);
  });

  test("off → off publishes a version with no behavioral artifacts and no test metrics", async () => {
    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      behavioralTierEnabled: false,
      buildId: "off-to-off",
    });
    const outcome = activated(result);

    expect(transitionRows(result)).toEqual(["tier_off"]);
    expect(outcome.assembly.behavioralTierTransition.artifacts).toBe("absent");
    expect(outcome.assembly.behavioralTests).toEqual([]);
    expect(outcome.assembly.behavioralExecution).toBeUndefined();
    expectSnapshotArtifacts(versionDirectory(env, 2), "absent");

    // No generation, no execution, and — the half a bare `skipped` would blur — no per-Action
    // rows at all. `absent` is the tier saying there was nothing here to measure, which is a
    // different reading from `skipped`, the state a run that never reached the Gate records.
    expect(aggregateTestStages(result)).toEqual([
      "behavioral_test_generation:absent",
      "behavioral_test_execution:absent",
    ]);
    expect(actionTestStages(result)).toEqual([]);
    // The tier-off Gate rung is the reason, and it is on the same row.
    expect(stages(result)).toContainEqual({ stage: "gate_behavioral", state: "skipped" });
  });

  test("on → off leaves the prior frozen intent behind: no copy, no execution", async () => {
    await publishTierOnBase("disable-base");
    const priorFrozen = join(versionDirectory(env, 2), FROZEN_TESTS_FILE);
    expect(existsSync(priorFrozen)).toBe(true);

    const result = await evolve(env, withRemindedAt(tierOnBaseSpec()), "add a reminder date", {
      behavioralTierEnabled: false,
      buildId: "on-to-off",
    });
    activated(result);

    expect(transitionRows(result)).toEqual(["tier_disabled"]);
    // The tier went off, so the suites the prior version froze are neither carried into the
    // new snapshot nor run against its bytes — the row's "no copy or execution", as bytes.
    expectSnapshotArtifacts(versionDirectory(env, 3), "absent");
    expect(aggregateTestStages(result)).toEqual([
      "behavioral_test_generation:absent",
      "behavioral_test_execution:absent",
    ]);
    expect(actionTestStages(result)).toEqual([]);
    // Immutable history is untouched: v2 still holds the frozen intent it was published on.
    expect(existsSync(priorFrozen)).toBe(true);
    expectSnapshotArtifacts(versionDirectory(env, 2), "present");
  });

  test("the candidate preview carries the row a tier-off evolution landed on", async () => {
    // The living demo's surface. A tier-off version's `behavioralTests` and
    // `behavioralExecution` are both empty by design, so the transition row is the only
    // thing on the panel that says *why* the artifacts are absent.
    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      behavioralTierEnabled: false,
      buildId: "off-preview",
    });
    activated(result);

    const preview = JSON.parse(
      result.events.filter((event) => event.event === "candidate-preview").at(-1)?.data ?? "null",
    ) as {
      assembly?: {
        status?: string;
        behavioralTierTransition?: { prior: string; candidate: string; artifacts: string };
      };
    };
    expect(preview.assembly?.status).toBe("complete");
    expect(preview.assembly?.behavioralTierTransition).toMatchObject({
      prior: "off",
      candidate: "off",
      artifacts: "absent",
    });
  });
});

describe("decision 24's transition table — the tier-on rows", () => {
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });

  afterEach(() => {
    tearDownCommitted(env);
  });

  test("off → on generates, freezes, and runs every suite from current candidate inputs", async () => {
    const result = await evolve(env, tierOnBaseSpec(), "add a due date", {
      behavioralTierEnabled: true,
      buildId: "off-to-on",
    });
    const outcome = activated(result);

    expect(transitionRows(result)).toEqual(everyAction("tier_enabled"));
    // Nothing was carried, because there was nothing to carry: the committed v1 is tier-off.
    expect(outcome.assembly.behavioralTests.every((entry) => entry.status === "generated")).toBe(
      true,
    );
    const manifest = expectSnapshotArtifacts(versionDirectory(env, 2), "present");
    expect(manifest.behavioral_tests).toEqual({
      full_suite: false,
      actions: ACTIONS.map((action) => ({
        action,
        source: "generated",
        execution: "executed",
        reason: "generated_this_build",
      })),
    });
    expect(aggregateTestStages(result)).toEqual([
      "behavioral_test_generation:generated",
      "behavioral_test_execution:executed",
    ]);
    expect(actionTestStages(result)).toEqual(
      ACTIONS.map((action) => `${action}:generated/executed`),
    );
  });

  test("on → on with unchanged inputs and no Handler impact copies every suite and runs none", async () => {
    const base = await publishTierOnBase("carry-base");
    // Only user-facing wording moves. No field name, type, requiredness, lifecycle,
    // behavior, error, or dependency identity changes — so no Action's test-input digest
    // moves, and the one unit that regenerates (`item.ts`) covers no Action.
    const relabelled: CapabilitySpec = {
      ...base,
      label: "Reminders",
      noun: "note",
      schema: {
        fields: base.schema.fields.map((field) => ({ ...field, label: `${field.label} ` })),
      },
    };
    const result = await evolve(env, relabelled, "rename the labels", {
      behavioralTierEnabled: true,
      buildId: "carry-unrun",
    });
    const outcome = activated(result);

    expect(outcome.assembly.regeneratedUnits).toEqual(["item"]);
    expect(transitionRows(result)).toEqual(everyAction("carried_unrun"));
    const manifest = expectSnapshotArtifacts(versionDirectory(env, 3), "present");
    expect(manifest.behavioral_tests).toEqual({
      full_suite: false,
      actions: ACTIONS.map((action) => ({
        action,
        source: "copied",
        execution: "skipped",
        reason: "no_covered_handler_change",
      })),
    });
    // The aggregate pair reads the copy and the skip rather than claiming work that did not
    // happen, and every per-Action row says the same.
    expect(aggregateTestStages(result)).toEqual([
      "behavioral_test_generation:copied",
      "behavioral_test_execution:skipped",
    ]);
    expect(actionTestStages(result)).toEqual(ACTIONS.map((action) => `${action}:copied/skipped`));
  });
});

describe("decision 24's transition table — the on → on rows over one version", () => {
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });

  afterEach(() => {
    tearDownCommitted(env);
  });

  test("on → on mixes the changed-input and impacted rows in one version", async () => {
    // Two facts at once: a new non-searchable field, and the list dropping a field it used
    // to show. `create`/`update` see changed inputs and are authored fresh (row five);
    // `read`/`delete`/`search` see identical inputs but a build that moved Handler bytes and
    // narrowed the renderer, so their frozen bytes carry and are re-proven (row four).
    const base = await publishTierOnBase("mixed-base");
    const candidate: CapabilitySpec = {
      ...withRemindedAt(base),
      ui_intent: { ...base.ui_intent, item: { ...base.ui_intent.item, shows: ["text"] } },
    };
    const result = await evolve(env, candidate, "add a reminder date and simplify the list", {
      behavioralTierEnabled: true,
      buildId: "mixed-rows",
    });
    const outcome = activated(result);

    expect(outcome.assembly.regeneratedUnits).toEqual(["create", "update", "item"]);
    expect(transitionRows(result)).toEqual([
      "create:regenerated",
      "read:carried_rerun",
      "update:regenerated",
      "delete:carried_rerun",
      "search:carried_rerun",
    ]);
    const manifest = expectSnapshotArtifacts(versionDirectory(env, 3), "present");
    expect(manifest.behavioral_tests?.full_suite).toBe(true);
    expect(
      manifest.behavioral_tests?.actions.map(
        (entry) => `${entry.action}:${entry.source}:${entry.execution}`,
      ),
    ).toEqual([
      "create:generated:executed",
      "read:copied:executed",
      "update:generated:executed",
      "delete:copied:executed",
      "search:copied:executed",
    ]);
    expect(aggregateTestStages(result)).toEqual([
      "behavioral_test_generation:generated",
      "behavioral_test_execution:executed",
    ]);
    expect(actionTestStages(result)).toEqual([
      "create:generated/executed",
      "read:copied/executed",
      "update:generated/executed",
      "delete:copied/executed",
      "search:copied/executed",
    ]);
  });

  test("on → on with changed inputs regenerates only the Actions whose inputs moved", async () => {
    // The narrow version of the row above, with nothing else moving: the additive field
    // changes the two writing Actions' inputs and leaves the other three byte-identical and
    // unexecuted. Row five and row three, in one version, with no fallback in sight.
    const base = await publishTierOnBase("regen-base");
    const result = await evolve(env, withRemindedAt(base), "add a reminder date", {
      behavioralTierEnabled: true,
      buildId: "regen-rows",
    });
    activated(result);

    expect(transitionRows(result)).toEqual([
      "create:regenerated",
      "read:carried_unrun",
      "update:regenerated",
      "delete:carried_unrun",
      "search:carried_unrun",
    ]);
    const manifest = expectSnapshotArtifacts(versionDirectory(env, 3), "present");
    expect(manifest.behavioral_tests?.full_suite).toBe(false);
    expect(actionTestStages(result)).toEqual([
      "create:generated/executed",
      "read:copied/skipped",
      "update:generated/executed",
      "delete:copied/skipped",
      "search:copied/skipped",
    ]);
  });
});

describe("toggling the tier is not, by itself, a transition", () => {
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });

  afterEach(() => {
    tearDownCommitted(env);
  });

  test("a semantic no-op under a flipped tier stays a no-op and materializes nothing", async () => {
    // Decision 24: toggling the global tier alone does not create a version. The toggle is
    // not a change fact and has no matrix row, so the run reaches the Diff, finds zero facts,
    // and stops — before the freeze stage, the only place the tier is read at all. That
    // ordering is the claim: the flipped tier here is inert not because it is ignored, but
    // because nothing downstream of the Diff ever runs to consult it.
    const base = await publishTierOnBase("toggle-base");
    const before = verifyCapabilitySnapshot(versionDirectory(env, 2));

    const toggled = await evolve(env, base, "same thing, tier off now", {
      behavioralTierEnabled: false,
      buildId: "toggle-only",
    });

    expect(toggled.outcome.kind).toBe("no_change");
    expect(toggled.lifecycles.at(-1)).toMatchObject({
      lifecycleStatus: "success",
      outcome: "no_change",
    });
    // No version, no build, no snapshot — and the tier-on v2 is untouched, still holding the
    // frozen intent a materialized on→off transition would have dropped.
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
    expect(existsSync(versionDirectory(env, 3))).toBe(false);
    expect(verifyCapabilitySnapshot(versionDirectory(env, 2)).manifest).toEqual(before.manifest);
    expectSnapshotArtifacts(versionDirectory(env, 2), "present");
    // Nothing ran and nothing was absent-because-tier-off either: the stage vector reports
    // the whole post-Diff half as skipped, which is what "no transition materialized" means
    // in the metrics vocabulary.
    expect(aggregateTestStages(toggled)).toEqual([
      "behavioral_test_generation:skipped",
      "behavioral_test_execution:skipped",
    ]);
    expect(actionTestStages(toggled)).toEqual([]);
  });

  test("the next real spec change is what applies the transition", async () => {
    const base = await publishTierOnBase("deferred-base");
    await evolve(env, base, "same thing, tier off now", {
      behavioralTierEnabled: false,
      buildId: "deferred-noop",
    });

    // Same toggle, now carried by a spec change: this is the build the table applies to.
    const relabelled: CapabilitySpec = { ...base, label: "Reminders" };
    const applied = await evolve(env, relabelled, "call them reminders", {
      behavioralTierEnabled: false,
      buildId: "deferred-applied",
    });
    activated(applied);

    expect(transitionRows(applied)).toEqual(["tier_disabled"]);
    expectSnapshotArtifacts(versionDirectory(env, 3), "absent");
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(3);
  });

  test("a no-op under an unflipped tier is equally inert", async () => {
    // The control: the same measured no-op with the tier left where it was. A transition
    // needs both a spec change *and* a tier pair; neither half alone writes a version.
    const result = await evolve(env, committedSpec(), "keep it exactly as it is", {
      behavioralTierEnabled: true,
      buildId: "noop-tier-on",
    });

    expect(result.outcome.kind).toBe("no_change");
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(actionTestStages(result)).toEqual([]);
    // The tier-on toggle never reached the freeze stage, so no test was authored either.
    expect(result.prompts.filter((prompt) => prompt.includes("Action under test:"))).toEqual([]);
  });
});

describe("a build that froze intent and then failed still reports it", () => {
  beforeEach(async () => {
    env = await setUpCommitted(gate);
  });

  afterEach(() => {
    tearDownCommitted(env);
  });

  test("a tier-on run that dies after the freeze is not a tier-off row in the metrics", async () => {
    // The freeze happens before the first Handler byte, so a run can pay for five suites and
    // then fail. If that generation were recorded only on a successful Gate, its stage vector
    // would be indistinguishable from a tier-off build's — and the tokens it spent would be
    // attributed to nothing, which is exactly the comparison the tier exists to support.
    await publishTierOnBase("failed-freeze-base");
    await expect(
      evolve(env, withRemindedAt(tierOnBaseSpec()), "add a reminder date", {
        behavioralTierEnabled: true,
        buildId: "failed-after-freeze",
        durableMetrics: true,
        unitOverrides: { create: "export default 'not a handler';" },
      }),
    ).rejects.toThrow();

    const row = durableLifecycle(env, "failed-after-freeze");
    expect(row?.lifecycleStatus).toBe("failed");
    // Generation says what it did; execution says it never happened. Neither reads `absent`,
    // which decision 24 reserves for a version whose tier was off.
    expect(row?.stages).toContainEqual({
      stage: "behavioral_test_generation",
      state: "generated",
    });
    expect(row?.stages).toContainEqual({ stage: "behavioral_test_execution", state: "skipped" });
    expect(row?.measurement?.timings?.testGenMs).toBeDefined();
    // And the freeze's tokens are all on the row. The fake provider answers every call with
    // the same 48 tokens, and only `create`/`update` see changed inputs, so the exact total
    // is the spec authoring plus two per-Action freeze calls — pinned rather than bounded,
    // because a loose `> 48` would still pass with half the freeze usage dropped.
    expect(row?.measurement?.usage?.totalTokens).toBe(48 * 3);
    // Nothing was published, so no snapshot claims a tier either way.
    expect(existsSync(versionDirectory(env, 3))).toBe(false);
  });
});

beforeAll(async () => {
  gate = await committedGate();
});
