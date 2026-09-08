// Frozen-intent bounded repair, end to end through the evolution engine — Module 4,
// (ADR-0003 bounded per-unit loop; ADR-0006).
//
// The rung's own battery (`builder/gate/rungs/behavioral/repair/gate-behavioral-repair.test.ts`)
// pins who gets rewritten and how often. This one pins what that means for a *product*: an
// evolution whose regenerated Handler contradicts the frozen suite either repairs itself
// and ships, or fails closed with the previous version still live, still holding every
// record, and still routable — and in neither case does a single frozen byte move.

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createHandlerFor,
  itemRendererFor,
  notesSpec,
  updateHandlerFor,
} from "../../../builder/gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../../builder/index.ts";
import {
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
} from "../../../platform/metrics/index.ts";
import {
  type CapabilitySpec,
  FULL_CAPABILITY_TOOLS,
  getCapability,
} from "../../../registry/index.ts";
import { hardEvolutionHandlerFixture } from "../matrix/hard-evolution-fixture.test-support.ts";
import {
  activated,
  behaviorNeutralDueDateCandidate,
  committedGate,
  committedSpec,
  committedTierOnGate,
  DUE_DATE_FIELD,
  dueDateCandidate,
  durableLifecycle,
  type EngineEnv,
  evolve,
  HISTORICAL_TEXT,
  INCARNATION_ID,
  setUpCommitted,
  tableColumns,
  tearDownCommitted,
  versionDirectory,
} from "../run/evolution-run.test-support.ts";

let gate: CapabilityGateResult;
let tierOnGate: CapabilityGateResult;
let env: EngineEnv;

setDefaultTimeout(30_000);

beforeAll(async () => {
  [gate, tierOnGate] = await Promise.all([committedGate(), committedTierOnGate()]);
});

beforeEach(async () => {
  env = await setUpCommitted(gate);
});

afterEach(() => {
  tearDownCommitted(env);
});

/**
 * Swaps the committed base for one published tier-on, then evolves it. Most cases need only a
 * tier-on candidate; these need a tier-on prior, since only a frozen version has intent to carry.
 */
async function evolveTierOn(
  candidate: CapabilitySpec,
  options: Parameters<typeof evolve>[3],
): ReturnType<typeof evolve> {
  tearDownCommitted(env);
  env = await setUpCommitted(tierOnGate);
  return evolve(env, candidate, "show the due date", options);
}

/**
 * An `update` Handler that lets a required field be blanked. It clears the platform smoke fixture
 * and contradicts one frozen case: blanking `text` must emit `missing_required_fields`.
 */
function permissiveUpdate(candidate: CapabilitySpec): string {
  const good = updateHandlerFor(candidate);
  const permissive = good.replace(
    '  if (input.submittedFields.has("text") && String(input.values.text ?? "").trim().length === 0) missing.push("text");\n',
    "",
  );
  if (permissive === good) throw new Error("update fixture did not drop its required check");
  return permissive;
}

/**
 * A `create` Handler whose validation fragment names the wrong fields: it clears smoke but breaks
 * a frozen case's fragment markers, a surface the shared renderer breaks too, so it cannot narrow.
 */
function misattributingCreate(candidate: CapabilitySpec): string {
  const good = createHandlerFor(candidate);
  const wrong = good.replace('missing.join(" ")', '"text due_date"');
  if (wrong === good) throw new Error("create fixture did not change its error fields");
  return wrong;
}

/**
 * The same new nullable column and the item surfaces showing it, behavior text untouched. `read`,
 * `delete` and `search` digests do not move, so their v1 suites carry pre-column rows forward.
 */
function showsDueDateCandidate(): CapabilitySpec {
  const base = committedSpec();
  return notesSpec({
    schema: { fields: [...base.schema.fields, DUE_DATE_FIELD] },
    ui_intent: {
      ...base.ui_intent,
      item: { direction: base.ui_intent.item.direction, shows: ["text", "due_date"] },
    },
  });
}

/** A renderer written as if every row had always had a due date. */
const NULL_HOSTILE_ITEM_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  '  if (record.due_date === null || record.due_date === undefined) throw new Error("this note predates the due date");',
  '  return `<div class="stack">$' +
    "{escapeHtml(record.text)} $" +
    "{escapeHtml(record.due_date)}</div>`;",
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
  "}",
].join("\n");

/** The frozen suite as it was actually published for a version. */
function publishedFrozenTests(version: number): string {
  return readFileSync(join(versionDirectory(env, version), "tests", "behavioral.json"), "utf8");
}

describe("a repairable evolution ships", () => {
  test("total attribution rewrites one Handler, reruns the same frozen case, and activates", async () => {
    const candidate = behaviorNeutralDueDateCandidate();
    const result = await evolve(env, candidate, "add a due date", {
      buildId: "repaired",
      durableMetrics: true,
      unitOverrides: { update: [permissiveUpdate(candidate)] },
    });
    const outcome = activated(result);

    const behavioral = outcome.assembly.gate.behavioral;
    if (behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(behavioral.repair.fixed).toBe(true);
    expect(behavioral.repair.repairedHandlers).toEqual(["update"]);
    const [failed] = behavioral.repair.attempts;
    expect(failed?.attribution).toEqual({
      total: true,
      reason: "single_handler_execution",
      handlers: ["update"],
    });
    expect(failed?.failure?.testName).toBe("update emits missing_required_fields");

    // The same frozen case ran again and passed — the suite was never narrowed to fit.
    expect(behavioral.testRun.cases.map((entry) => entry.name)).toContain(
      "update emits missing_required_fields",
    );

    // The build shipped: v2 is live, the historical record survived the migration, and the
    // repaired bytes — not the bytes that failed — are what the snapshot carries.
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
    expect(tableColumns(env, "cap_notes")).toContain("due_date");
    expect(env.conns.readonly.query('SELECT "text" FROM "cap_notes"').all()).toEqual([
      { text: HISTORICAL_TEXT },
    ]);
    expect(readFileSync(join(versionDirectory(env, 2), "update.ts"), "utf8")).toBe(
      updateHandlerFor(candidate),
    );
    expect(durableLifecycle(env, "repaired")).toMatchObject({
      lifecycleStatus: "success",
      outcome: "activated",
    });
    const lifecycle = durableLifecycle(env, "repaired");
    // The same nine deterministic calls as the exhausted case, counted once apiece: a passing
    // repair must not disappear, nor be counted through both the reconciled unit and the Gate.
    expect(lifecycle?.measurement?.usage?.totalTokens).toBe(48 * 9);
    expect(
      lifecycle?.measurement?.unitAttempts?.find((unit) => unit.name === "update")?.attempts,
    ).toBe(2);

    // The repair is in the unit's own history, not just the Gate's: a rewrite that cost a provider
    // call and is missing from the unit's record understates what wrote the build.
    const update = outcome.assembly.units.find((unit) => unit.name === "update");
    const repairAttempt = update?.attempts.at(-1);
    expect(repairAttempt?.error).toContain("update emits missing_required_fields");
    expect(repairAttempt?.usage.totalTokens).toBeGreaterThan(0);
    expect(update?.usage.totalTokens).toBeGreaterThan(
      outcome.assembly.units.find((unit) => unit.name === "delete")?.usage.totalTokens ?? 0,
    );
    expect(outcome.assembly.regeneratedUnits).toContain("update");
  });

  test("the published frozen suite is the suite the Gate was handed, byte for byte", async () => {
    const candidate = behaviorNeutralDueDateCandidate();
    const result = await evolve(env, candidate, "add a due date", {
      buildId: "frozen-bytes",
      unitOverrides: { update: [permissiveUpdate(candidate)] },
    });
    const outcome = activated(result);
    const behavioral = outcome.assembly.gate.behavioral;
    if (behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");

    // A repair happened, and the digested artifact still matches the frozen intent the rung ran.
    // Publication verifies that digest, so a test rewritten to fit the code cannot reach disk.
    expect(behavioral.repair.fixed).toBe(true);
    expect(JSON.parse(publishedFrozenTests(2))).toEqual(behavioral.frozenTests);
    const frozenEntry = outcome.publication.manifest.files.find(
      (entry) => entry.path === "tests/behavioral.json",
    );
    expect(frozenEntry?.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("a fragment failure beside a regenerated renderer rewrites the conservative set", async () => {
    // `dueDateCandidate` moves the free-text behavior *and* the item renderer, so a failing
    // fragment assertion pins to no one Handler. Decision 22 widens the code, never the test.
    const candidate = dueDateCandidate();
    const result = await evolve(env, candidate, "add a due date and make it stand out", {
      buildId: "conservative",
      unitOverrides: { create: [misattributingCreate(candidate)] },
    });
    const outcome = activated(result);

    const behavioral = outcome.assembly.gate.behavioral;
    if (behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(behavioral.repair.attempts[0]?.attribution).toEqual({
      total: false,
      reason: "fragment_with_regenerated_item_renderer",
      handlers: [...FULL_CAPABILITY_TOOLS],
    });
    // Every declared Handler was asked — that is what conservative means — but only the one whose
    // bytes came back different is recorded: a verbatim return is not a rewrite.
    expect(behavioral.repair.repairedHandlers).toEqual(["create"]);
    // Widening the repair does not widen what proves it: every rewritten Handler was
    // judged by its own frozen suite on the run that passed.
    for (const action of behavioral.repair.repairedHandlers) {
      expect(behavioral.execution.actions.find((entry) => entry.action === action)?.execution).toBe(
        "executed",
      );
    }
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
    expect(itemRendererFor(candidate)).toContain("due_date");
  });
});

describe("behavior over existing records", () => {
  test("a repair is re-proven over frozen cases whose rows predate the new column", async () => {
    // The carried `read`/`delete`/`search` cases seed rows written against v1's schema, so after
    // the migration the new column is `null` in each — rows this build's fresh cases never make.
    const candidate = showsDueDateCandidate();
    const result = await evolveTierOn(candidate, {
      buildId: "existing-records",
      unitOverrides: { update: [permissiveUpdate(candidate)] },
    });
    const outcome = activated(result);
    const behavioral = outcome.assembly.gate.behavioral;
    if (behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");

    expect(behavioral.repair.repairedHandlers).toEqual(["update"]);
    const carried = behavioral.execution.actions.filter((entry) => entry.source === "copied");
    expect(carried.map((entry) => entry.action)).toEqual(["read", "delete", "search"]);
    expect(carried.every((entry) => entry.execution === "executed")).toBe(true);

    // Those carried cases really do predate the column, and they really did run again.
    const readCase = behavioral.frozenTests.actions.find((entry) => entry.action === "read")
      ?.cases[0];
    expect(readCase?.setupRows[0]?.values.map((value) => value.field).sort()).toEqual([
      "pinned",
      "text",
    ]);
    expect(behavioral.testRun.cases.map((entry) => `${entry.action}:${entry.name}`)).toContain(
      "read:reads stored rows",
    );
  });

  test("code that assumes every row has the new column fails closed against historical nulls", async () => {
    // The renderer is written knowing the *new* shape and throws on a row with no due date — the
    // only such rows are the carried ones. It runs inside the Handler call, so `read` is not it.
    const candidate = showsDueDateCandidate();
    const run = evolveTierOn(candidate, {
      buildId: "null-hostile",
      durableMetrics: true,
      unitOverrides: { item: NULL_HOSTILE_ITEM_RENDERER },
    });

    await expect(run).rejects.toThrow(/reads stored rows/);

    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(durableLifecycle(env, "null-hostile")).toMatchObject({
      lifecycleStatus: "failed",
      outcome: "gate_failed",
    });
  });
});

describe("the living demo", () => {
  test("the hard-path fixture forces a real first-pass failure and a real repair", async () => {
    // What enabling the hard-path control gets a developer: the fixture writes the first
    // `update.ts` and nothing else is staged — the failure is a verdict, the rewrite a provider's.
    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      buildId: "hard-demo",
      firstPassHandlerFixture: hardEvolutionHandlerFixture,
    });
    const outcome = activated(result);

    const behavioral = outcome.assembly.gate.behavioral;
    if (behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(behavioral.repair.fixed).toBe(true);
    expect(behavioral.repair.repairedHandlers).toEqual(["update"]);
    // The story the foreground stream carries: the failing rung, whose fault it was, the
    // bounded repair, and then the View swap.
    const preview = JSON.parse(
      result.events.find((entry) => entry.event === "gate-preview")?.data ?? "{}",
    ) as { behavioral?: { repair?: { repairedHandlers?: string[] } } };
    expect(preview.behavioral?.repair?.repairedHandlers).toEqual(["update"]);
    // …and then the version the route swaps the View to is live.
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
  });

  test("the hard-path fixture forces the same story on a realistic request", async () => {
    // A much bigger evolution: the free-text behavior and the item renderer move too. The forced
    // failure still lands on the mutation port's rejection, so attribution stays total.
    const result = await evolve(env, dueDateCandidate(), "add a due date and make it stand out", {
      buildId: "hard-demo-realistic",
      firstPassHandlerFixture: hardEvolutionHandlerFixture,
    });
    const outcome = activated(result);

    const behavioral = outcome.assembly.gate.behavioral;
    if (behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(behavioral.repair.fixed).toBe(true);
    expect(behavioral.repair.attempts[0]?.attribution).toEqual({
      total: true,
      reason: "single_handler_execution",
      handlers: ["update"],
    });
    expect(behavioral.repair.repairedHandlers).toEqual(["update"]);
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
  });

  test("the fixture cannot widen the Diff plan to displace a copied Handler", async () => {
    // The spec-derived cache owns the copy/regenerate boundary: a guided-repair request whose Diff
    // does not select `update` leaves those committed bytes untouched and repairs nothing.
    const candidate = structuredClone(committedSpec());
    candidate.ui_intent.item.direction = "A text-forward card with a little more breathing room.";
    const result = await evolveTierOn(candidate, {
      buildId: "hard-demo-copied",
      firstPassHandlerFixture: hardEvolutionHandlerFixture,
    });
    const outcome = activated(result);

    expect(outcome.assembly.copiedUnits).toContain("update");
    expect(outcome.assembly.regeneratedUnits).not.toContain("update");
    const behavioral = outcome.assembly.gate.behavioral;
    if (behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(behavioral.repair.fixed).toBe(false);
    expect(behavioral.repair.repairedHandlers).toEqual([]);
  });

  test("tier-off never invokes the fixture even through the engine seam", async () => {
    let fixtureCalls = 0;
    const result = await evolve(env, behaviorNeutralDueDateCandidate(), "add a due date", {
      buildId: "hard-demo-tier-off",
      behavioralTierEnabled: false,
      firstPassHandlerFixture: (spec, unit) => {
        fixtureCalls += 1;
        return hardEvolutionHandlerFixture(spec, unit);
      },
    });
    const outcome = activated(result);

    expect(fixtureCalls).toBe(0);
    expect(outcome.assembly.gate.behavioral.tier).toBe("off");
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(2);
    expect(outcome.assembly.handlers.update).toContain("missing_required_fields");
  });

  test("synthetic bytes cannot activate unless frozen intent first fails and repairs them", async () => {
    const candidate = behaviorNeutralDueDateCandidate();
    const run = evolve(env, candidate, "add a due date", {
      buildId: "hard-demo-no-failure",
      firstPassHandlerFixture: (spec, unit) =>
        unit === "update" ? updateHandlerFor(spec) : undefined,
    });

    await expect(run).rejects.toThrow(
      "Guided repair bytes did not produce a proven frozen behavioral failure and repair.",
    );
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
  });
});

describe("an unrepairable evolution fails closed", () => {
  test("exhaustion rolls back, finalizes gate_failed, and leaves v1 live with its records", async () => {
    const candidate = behaviorNeutralDueDateCandidate();
    const permissive = permissiveUpdate(candidate);
    // Every regeneration hands back the same contradiction, so the bounded budget runs out.
    const run = evolve(env, candidate, "add a due date", {
      buildId: "exhausted",
      durableMetrics: true,
      unitOverrides: { update: [permissive, permissive, permissive] },
    });

    await expect(run).rejects.toThrow(/update emits missing_required_fields/);

    // Nothing the build touched survives: no version, no column, no pointer move.
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
    expect(tableColumns(env, "cap_notes")).not.toContain("due_date");
    // The prior version is still routable, still holding every record it held before.
    expect(env.conns.readonly.query('SELECT "text" FROM "cap_notes"').all()).toEqual([
      { text: HISTORICAL_TEXT },
    ]);
    const lifecycle = durableLifecycle(env, "exhausted");
    expect(lifecycle).toMatchObject({ lifecycleStatus: "failed", outcome: "gate_failed" });
    expect(lifecycle?.measurement?.failure).toMatchObject({ stage: "gate", rung: "behavioral" });
    // Every fake-provider call costs 48 tokens: authoring, five frozen suites, the two selected
    // units, and the attempted repair. A failed Gate keeps the ninth call, not an 8-call subtotal.
    expect(lifecycle?.measurement?.usage?.totalTokens).toBe(48 * 9);
    expect(
      lifecycle?.measurement?.unitAttempts?.find((unit) => unit.name === "update")?.attempts,
    ).toBe(2);
    expect(
      lifecycle?.stages
        .filter((stage) => stage.stage === "unit_generation")
        .map((stage) => `${stage.unit?.name}:${stage.state}`),
    ).toEqual([
      "item:copied",
      "create:generated",
      "read:copied",
      "update:generated",
      "delete:copied",
      "search:copied",
    ]);
    expect(lifecycle?.stages).toContainEqual({
      stage: "behavioral_test_execution",
      state: "executed",
    });
    expect(lifecycle?.stages).toContainEqual({
      stage: "behavioral_test_execution",
      state: "executed",
      test: { kind: "behavioral-suite", name: "update" },
    });
  });

  test("a build interrupted mid-repair reconciles to interrupted at boot", async () => {
    // A real interruption, not a simulated row: the run stops inside the Gate's repair loop with
    // the provider mid-rewrite, leaving a `running` row, no candidate, and the old version live.
    const candidate = behaviorNeutralDueDateCandidate();
    const permissive = permissiveUpdate(candidate);
    let repairing: (() => void) | undefined;
    const reachedRepair = new Promise<void>((resolve) => {
      repairing = resolve;
    });
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const run = evolve(env, candidate, "add a due date", {
      buildId: "killed-mid-repair",
      durableMetrics: true,
      unitOverrides: { update: [permissive] },
      onRepairGeneration: async () => {
        repairing?.();
        await held;
      },
    }).catch(() => undefined);

    await reachedRepair;
    // The process would die here. Everything durable is as the crash left it.
    expect(durableLifecycle(env, "killed-mid-repair")).toMatchObject({
      lifecycleStatus: "running",
      outcome: null,
    });
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
    expect(existsSync(versionDirectory(env, 2))).toBe(false);

    // Boot: startup reconciliation closes the row it can prove never committed.
    expect(reconcileRunningGenerationLifecycles(env.conns.readwrite)).toBe(1);
    expect(durableLifecycle(env, "killed-mid-repair")).toMatchObject({
      lifecycleStatus: "interrupted",
      outcome: "interrupted",
    });

    // The abandoned in-flight run cannot come back and overwrite the recovered verdict.
    release?.();
    await run;
    expect(durableLifecycle(env, "killed-mid-repair")).toMatchObject({
      lifecycleStatus: "interrupted",
      outcome: "interrupted",
    });
    expect(getCapability("notes", env.conns.readonly)?.version).toBe(1);
  });

  test("the generic reconciliation is what closes it, with no candidate left behind", () => {
    startGenerationLifecycle(
      { buildId: "never-started-work", incarnationId: INCARNATION_ID, capabilityId: "notes" },
      env.conns.readwrite,
    );

    expect(reconcileRunningGenerationLifecycles(env.conns.readwrite)).toBe(1);

    expect(durableLifecycle(env, "never-started-work")).toMatchObject({
      lifecycleStatus: "interrupted",
      outcome: "interrupted",
    });
    expect(existsSync(versionDirectory(env, 2))).toBe(false);
  });
});
