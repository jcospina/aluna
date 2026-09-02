// Frozen-intent bounded repair, end to end through the evolution engine — Module 4,
// (ADR-0003 bounded per-unit loop; ADR-0006).
//
// The rung's own battery (`builder/gate/behavioral/gate-behavioral-repair.test.ts`) pins
// who gets rewritten and how often. This one pins what that means for a *product*: an
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
} from "../../builder/gate/gate.test-support.ts";
import type { CapabilityGateResult } from "../../builder/index.ts";
import {
  reconcileRunningGenerationLifecycles,
  startGenerationLifecycle,
} from "../../platform/metrics/index.ts";
import { type CapabilitySpec, getCapability } from "../../registry/index.ts";
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
} from "./evolution-run.test-support.ts";
import { hardEvolutionHandlerFixture } from "./hard-evolution-fixture.test-support.ts";

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
 * Swap the committed base for one published **tier-on**, then evolve it. Most cases here
 * only need a tier-on *candidate*, which the global toggle already gives them; these need a
 * tier-on **prior version**, because only a version that froze intent has intent to carry
 * forward. The replacement env is torn down by the shared `afterEach`.
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
 * An `update` Handler that lets a required field be blanked. It type-checks, it clears the
 * platform smoke fixture (which updates with a valid value), and it contradicts exactly one
 * frozen case: the one that says blanking `text` must emit `missing_required_fields`.
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
 * A `create` Handler whose validation fragment names the wrong fields. It writes no bad row
 * and drops no presented item, so it clears the platform smoke fixture; what it contradicts
 * is one frozen case's *fragment* markers — the surface the shared item renderer is also
 * capable of breaking, and therefore the surface attribution cannot always narrow.
 */
function misattributingCreate(candidate: CapabilitySpec): string {
  const good = createHandlerFor(candidate);
  const wrong = good.replace('missing.join(" ")', '"text due_date"');
  if (wrong === good) throw new Error("create fixture did not change its error fields");
  return wrong;
}

/**
 * The same new nullable column, plus the item surfaces that show it, with the behavior text
 * left exactly as it was. `read`, `delete` and `search` project no schema into their test
 * inputs, so their digests do not move and their v1 suites carry forward — which is what
 * puts pre-column rows in front of post-column code.
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
    // The same nine deterministic calls as the exhausted case, counted once apiece. A
    // passing repair must not disappear, and its usage must not be counted both through
    // the reconciled unit and through the Gate.
    expect(lifecycle?.measurement?.usage?.totalTokens).toBe(48 * 9);
    expect(
      lifecycle?.measurement?.unitAttempts?.find((unit) => unit.name === "update")?.attempts,
    ).toBe(2);

    // The repair is in the unit's own history, not just the Gate's. A rewrite that cost a
    // provider call and does not appear in what that unit is recorded as having taken is a
    // build whose provenance understates what wrote it.
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

    // A repair happened, and the artifact the snapshot digest covers still matches the
    // frozen intent the rung executed. Publication verifies that digest, so a test rewritten
    // to fit the code could not have reached disk unnoticed.
    expect(behavioral.repair.fixed).toBe(true);
    expect(JSON.parse(publishedFrozenTests(2))).toEqual(behavioral.frozenTests);
    const frozenEntry = outcome.publication.manifest.files.find(
      (entry) => entry.path === "tests/behavioral.json",
    );
    expect(frozenEntry?.content_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("a fragment failure beside a regenerated renderer rewrites the conservative set", async () => {
    // `dueDateCandidate` moves the free-text behavior *and* the item renderer, so a failing
    // fragment assertion cannot be pinned to one Handler without assuming the frozen
    // assertion is wrong. Decision 22's answer is to widen the code, never the test.
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
      handlers: ["create", "read", "update", "delete", "search"],
    });
    // Every declared Handler was *asked* — that is what conservative means. Only the one
    // whose bytes actually came back different is recorded as repaired: a rewrite that
    // returned the input verbatim is not a rewrite, and must not enter a unit's provenance.
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
    // v1 was built tier-on, so `read`, `delete` and `search` carry their suites forward
    // byte-for-byte — and those cases seed rows written against v1's schema. After the
    // additive migration the new column is `null` in every one of them. A repair that only
    // satisfied this build's own freshly-generated cases would be judging the new code
    // exclusively on rows that could not exist yet.
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
    // The renderer is the unit that most easily forgets: it is written knowing the *new*
    // shape. Here it throws on a row that has no due date — and the only rows like that are
    // the ones the carried frozen intent describes. The renderer runs inside the Handler
    // call, so this is also the case that must not be blamed on the read Handler.
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
    // Exactly what a developer gets from enabling the hard-path control: the fixture writes
    // the first `update.ts`, and nothing else about the run is staged — the failure is a
    // frozen case's verdict, and the rewrite comes from the provider.
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
    // "add a due date and make it stand out" moves the free-text behavior and the item
    // renderer too — a much bigger evolution. The forced failure still lands where the
    // platform mutation port rejects the blank required field, so attribution stays total
    // and the demo does not become a five-Handler rewrite by accident.
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
    // The spec-derived cache owns the copy/regenerate boundary. A guided-repair request
    // whose Diff does not select update leaves those committed bytes untouched and performs
    // no synthetic repair.
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
    // Every fake-provider call costs exactly 48 tokens: candidate authoring, five freshly
    // frozen Action suites, the two units selected by the Diff, and the attempted behavioral
    // repair. A failed Gate must retain that final call rather than reporting the 8-call
    // pre-repair subtotal.
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
    // A real interruption, not a simulated row: the run is stopped *inside* the Gate's
    // repair loop, with the provider mid-rewrite, and never allowed to finalize. That is
    // exactly the state a killed process leaves behind — a durable `running` row, no
    // published candidate, and the previous version still live.
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
