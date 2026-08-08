// Bounded per-Handler repair against frozen behavioral intent
// (PLAN decisions 22 and 23; ADR-0003 bounded per-unit loop; ADR-0006 frozen tests).
//
// The claim under test is one sentence: **repair answers to the frozen suite, never the
// other way around.** Everything here is a way of trying to break that — repairing more
// units than the evidence licenses, spending more turns than the budget allows, letting a
// rewritten Handler go unjudged, or moving a single frozen byte.

import { describe, expect, test } from "bun:test";

import { deriveCapabilityTableDdl } from "../../../capability-data/index.ts";
import type { HandlerUnitName } from "../../units/units.ts";
import {
  CREATE_HANDLER,
  expectGateFailure,
  type FullBehavioralTestSuite,
  frozenTierInput,
  fullBehavioralSuiteFor,
  GOOD_HANDLERS,
  gateInput,
  itemRendererFor,
  makeHandlerRepairProvider,
  notesSpec,
} from "../gate.test-support.ts";
import { CapabilityGateError, runCapabilityGate } from "../gate.ts";
import { FullBehavioralCaseFailure } from "./gate-behavioral-full.ts";
import {
  BehavioralRungFailure,
  FrozenIntentMutatedError,
  runBehavioralRepairLoop,
} from "./gate-behavioral-repair.ts";

const ALL_FIVE: readonly HandlerUnitName[] = ["create", "read", "update", "delete", "search"];

const TRIM_SPEC = notesSpec({ behavior: "Text is trimmed before saving." });
const TRIMMING_CREATE = CREATE_HANDLER.replace(
  "text: input.values.text,",
  'text: String(input.values.text ?? "").trim(),',
);
// Two rewrites that are genuinely new bytes and still do not trim — a repair loop that
// actually lands work and still cannot satisfy the frozen case.
const STILL_UNTRIMMED_CREATE = CREATE_HANDLER.replace(
  "text: input.values.text,",
  'text: String(input.values.text ?? ""),',
);
const ALSO_UNTRIMMED_CREATE = CREATE_HANDLER.replace(
  "text: input.values.text,",
  'text: String(input.values.text ?? "").slice(0),',
);

/**
 * A conforming renderer that throws on exactly one row the frozen `read` case seeds. The
 * platform smoke fixture never produces that value, so the defect first surfaces inside a
 * frozen case — which is precisely the situation where it could be mistaken for the read
 * Handler's own failure.
 */
const THROWING_ITEM_RENDERER = [
  "export default function renderItem(record: Record<string, unknown>): string {",
  '  if (String(record.text) === "Read note") throw new Error("this row has no due date");',
  '  return `<div class="stack">$' + "{escapeHtml(record.text)}</div>`;",
  "}",
  "",
  "function escapeHtml(value: unknown): string {",
  '  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");',
  "}",
].join("\n");

/** A suite `GOOD_HANDLERS` satisfies outright — the baseline each fixture below breaks once. */
function passingSuite(): FullBehavioralTestSuite {
  return fullBehavioralSuiteFor(TRIM_SPEC, {
    createValues: { text: "Trim me", pinned: false },
    updateValues: { text: "Updated note", pinned: false },
    readValues: { text: "Read note", pinned: false },
    searchMatchValues: { text: "Matching note newest", pinned: false },
    searchOlderMatchValues: { text: "Matching note older", pinned: false },
    searchMissValues: { text: "Other entry", pinned: false },
    markerField: "text",
    searchQuery: "matching",
  });
}

/**
 * A suite whose create case demands trimming. `GOOD_HANDLERS.create` stores the untrimmed
 * value, so the case fails on the *scratch rows it left behind* — the item renderer is not
 * involved, and attribution is total.
 */
function trimSuite(): FullBehavioralTestSuite {
  const suite = passingSuite();
  const create = suite.cases.find((entry) => entry.action === "create" && !entry.expectedError);
  if (!create) throw new Error("trim suite is missing normal create coverage");
  create.name = "trims note text before saving";
  create.input = [
    { field: "text", value: "  Trim me  " },
    { field: "pinned", value: "false" },
  ];
  return suite;
}

/**
 * A suite whose search case froze the opposite ordering, and whose every other case passes.
 * Each row the case requires is stored and returned, so the only assertion that fails is the
 * *ordered fragment* — the one surface the shared item renderer can be responsible for. The
 * suite stays admissible: the platform contract governs which rows an ordering assertion may
 * name, not which direction the intent chose.
 */
function reversedOrderingSuite(): FullBehavioralTestSuite {
  const suite = passingSuite();
  const search = suite.cases.find((entry) => entry.action === "search");
  if (!search) throw new Error("suite is missing search coverage");
  search.expectFragmentIncludesInOrder = [...search.expectFragmentIncludesInOrder].reverse();
  return suite;
}

function repairGateInput(
  suite: FullBehavioralTestSuite,
  replacements: Readonly<Partial<Record<HandlerUnitName, readonly string[]>>>,
  tier: Partial<ReturnType<typeof frozenTierInput>> = {},
) {
  const { provider, repaired, prompts } = makeHandlerRepairProvider(replacements, suite);
  const input = gateInput(
    {
      spec: TRIM_SPEC,
      ddl: deriveCapabilityTableDdl(TRIM_SPEC),
      handlers: GOOD_HANDLERS,
      itemRenderer: itemRendererFor(TRIM_SPEC),
      provider,
      behavioralTier: { ...frozenTierInput(TRIM_SPEC, suite), ...tier },
    },
    suite,
  );
  return { input, repaired, prompts };
}

describe("behavioral repair — total attribution", () => {
  test("repairs exactly the implicated Handler and reruns the same frozen bytes", async () => {
    const suite = trimSuite();
    const { input, repaired } = repairGateInput(suite, { create: [TRIMMING_CREATE] });
    const frozenBefore = JSON.stringify(input.behavioralTier?.frozen?.frozenTests);

    const gate = await runCapabilityGate(input);

    // One Handler was rewritten, and it was the one the failing case invoked.
    expect(repaired).toEqual(["create"]);
    if (gate.behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(gate.behavioral.repair.fixed).toBe(true);
    expect(gate.behavioral.repair.repairedHandlers).toEqual(["create"]);

    const [failed, passed] = gate.behavioral.repair.attempts;
    expect(failed?.attribution).toEqual({
      total: true,
      reason: "single_handler_execution",
      handlers: ["create"],
    });
    expect(failed?.failure).toMatchObject({
      action: "create",
      testName: "trims note text before saving",
      surface: "row_state",
    });
    expect(failed?.repairs?.map((entry) => entry.action)).toEqual(["create"]);
    expect(passed?.failure).toBeUndefined();
    expect(gate.behavioral.repair.attempts).toHaveLength(2);

    // The rerun judged the *same* frozen bytes, and the case that failed then passed.
    expect(JSON.stringify(gate.behavioral.frozenTests)).toBe(frozenBefore);
    expect(gate.behavioral.testRun.cases.map((entry) => entry.name)).toContain(
      "trims note text before saving",
    );

    // The repaired bytes are the ones the pipeline commits.
    expect(gate.handlers.create).toBe(TRIMMING_CREATE);
    expect(gate.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });

  test("a fragment failure stays total while the item renderer is proven unmoved", async () => {
    const suite = reversedOrderingSuite();
    // The rewrite hands back the same (correct-by-platform) bytes, so the case fails again:
    // the point is *who* got rewritten, not whether the rewrite worked.
    const { input, repaired } = repairGateInput(
      suite,
      { search: [GOOD_HANDLERS.search] },
      { impact: { regeneratedHandlers: ["search"], regeneratedItemRenderer: false } },
    );

    const error = await expectGateFailure(input);

    expect(repaired).toEqual(["search"]);
    const diagnostic = error.diagnostic as { repair: { attempts: { attribution?: unknown }[] } };
    expect(diagnostic.repair.attempts[0]?.attribution).toEqual({
      total: true,
      reason: "single_handler_execution",
      handlers: ["search"],
    });
  });
});

describe("behavioral repair — conservative attribution", () => {
  test("a renderer that throws inside the Handler call is not blamed on the Handler", async () => {
    // `item.ts` executes *during* the Handler call, so without care its defect would look
    // like the Handler's own and be attributed totally — licensing a rewrite of a unit that
    // could not possibly fix it. A moved renderer makes that attribution unsound.
    const suite = passingSuite();
    const { input, repaired } = repairGateInput(
      suite,
      Object.fromEntries(ALL_FIVE.map((action) => [action, [`${GOOD_HANDLERS[action]}\n`]])),
      { impact: { regeneratedHandlers: [...ALL_FIVE], regeneratedItemRenderer: true } },
    );
    const error = await expectGateFailure({ ...input, itemRenderer: THROWING_ITEM_RENDERER });

    expect(error.failedRung).toBe("behavioral");
    const diagnostic = error.diagnostic as {
      repair: { attempts: { failure?: { surface: string }; attribution?: unknown }[] };
    };
    expect(diagnostic.repair.attempts[0]?.failure?.surface).toBe("fragment");
    expect(diagnostic.repair.attempts[0]?.attribution).toEqual({
      total: false,
      reason: "fragment_with_regenerated_item_renderer",
      handlers: [...ALL_FIVE],
    });
    expect([...repaired].sort()).toEqual([...ALL_FIVE].sort());
  });

  test("a fragment failure beside a moved renderer rewrites the whole declared set", async () => {
    const suite = reversedOrderingSuite();
    const { input, repaired } = repairGateInput(
      suite,
      Object.fromEntries(ALL_FIVE.map((action) => [action, [GOOD_HANDLERS[action]]])),
      { impact: { regeneratedHandlers: [...ALL_FIVE], regeneratedItemRenderer: true } },
    );

    const error = await expectGateFailure(input);

    expect(error.failedRung).toBe("behavioral");
    expect([...repaired].sort()).toEqual([...ALL_FIVE].sort());
    const diagnostic = error.diagnostic as { repair: { attempts: { attribution?: unknown }[] } };
    expect(diagnostic.repair.attempts[0]?.attribution).toEqual({
      total: false,
      reason: "fragment_with_regenerated_item_renderer",
      handlers: [...ALL_FIVE],
    });
  });

  test("an unstated impact is itself grounds for the conservative set", async () => {
    const suite = reversedOrderingSuite();
    const { input, repaired } = repairGateInput(
      suite,
      Object.fromEntries(ALL_FIVE.map((action) => [action, [GOOD_HANDLERS[action]]])),
    );

    const error = await expectGateFailure(input);

    expect([...repaired].sort()).toEqual([...ALL_FIVE].sort());
    const diagnostic = error.diagnostic as {
      repair: { attempts: { attribution?: { reason: string } }[] };
    };
    expect(diagnostic.repair.attempts[0]?.attribution?.reason).toBe(
      "fragment_with_unstated_impact",
    );
  });
});

describe("behavioral repair — the bound", () => {
  test("a one-attempt budget executes once and never calls the provider", async () => {
    const suite = trimSuite();
    const { input, repaired, prompts } = repairGateInput(
      suite,
      { create: [TRIMMING_CREATE] },
      { maxAttempts: 1 },
    );

    const error = await expectGateFailure(input);

    expect(error.failedRung).toBe("behavioral");
    expect(repaired).toEqual([]);
    expect(prompts.filter((prompt) => prompt.includes("Generate the"))).toEqual([]);
    const diagnostic = error.diagnostic as { repair: { attempts: unknown[] } };
    expect(diagnostic.repair.attempts).toHaveLength(1);
  });

  test("exhaustion after the budget fails the Gate rather than trying once more", async () => {
    const suite = trimSuite();
    // Three turns of budget and two genuinely new — but still wrong — rewrites: the loop
    // spends the whole budget and stops, rather than taking a fourth turn.
    const { input, repaired } = repairGateInput(
      suite,
      { create: [STILL_UNTRIMMED_CREATE, ALSO_UNTRIMMED_CREATE] },
      { maxAttempts: 3 },
    );

    const error = await expectGateFailure(input);

    expect(repaired).toEqual(["create", "create"]);
    const diagnostic = error.diagnostic as { repair: { attempts: unknown[] } };
    expect(diagnostic.repair.attempts).toHaveLength(3);
    expect(error.message).toContain("trims note text before saving");
  });

  test("a byte-identical rewrite is not a repair and is not retried", async () => {
    const suite = trimSuite();
    // The model handed back exactly what it was given. Recording that as a repair would put
    // a rewrite in the unit's provenance that never happened, and re-running identical bytes
    // against identical tests cannot change the verdict — so the budget stops here.
    const { input, repaired } = repairGateInput(
      suite,
      { create: [GOOD_HANDLERS.create] },
      { maxAttempts: 3 },
    );

    const error = await expectGateFailure(input);

    expect(repaired).toEqual(["create"]);
    expect(error.message).toContain("regenerated byte-identically");
    const diagnostic = error.diagnostic as {
      repair: { attempts: { repairs?: unknown[] }[] };
    };
    expect(diagnostic.repair.attempts).toHaveLength(1);
    expect(diagnostic.repair.attempts[0]?.repairs).toEqual([]);
  });

  test("an inadmissible repair is not retried against identical bytes", async () => {
    const suite = trimSuite();
    // The regenerated Handler fails the static unit check, so nothing lands. Re-running
    // byte-identical code against byte-identical tests cannot change the verdict.
    const { input, repaired } = repairGateInput(
      suite,
      { create: ["export default 'not a handler';"] },
      { maxAttempts: 3 },
    );

    const error = await expectGateFailure(input);

    expect(repaired).toEqual(["create"]);
    expect(error.message).toContain("No Handler repair was admissible");
    const diagnostic = error.diagnostic as { repair: { attempts: unknown[] } };
    expect(diagnostic.repair.attempts).toHaveLength(1);
  });
});

describe("behavioral repair — what may never happen", () => {
  test("frozen bytes are identical before and after a repair round", async () => {
    const suite = trimSuite();
    const { input } = repairGateInput(suite, { create: [TRIMMING_CREATE] });
    const before = JSON.stringify(input.behavioralTier?.frozen?.frozenTests);

    const gate = await runCapabilityGate(input);

    expect(JSON.stringify(input.behavioralTier?.frozen?.frozenTests)).toBe(before);
    expect(JSON.stringify(gate.behavioral.tier === "on" && gate.behavioral.frozenTests)).toBe(
      before,
    );
  });

  test("a suite mutated mid-Gate fails the rung instead of being judged", async () => {
    // Nothing in the shipped path does this. The guard exists so that if anything ever
    // does, the Gate says so out loud rather than clearing a build against tests that
    // moved to fit the code — the one failure mode frozen intent exists to prevent.
    const suite = trimSuite();
    const frozen = frozenTierInput(TRIM_SPEC, suite).frozen;
    if (!frozen) throw new Error("expected a frozen tier input");
    const { input } = repairGateInput(suite, {});

    const run = runBehavioralRepairLoop({
      input,
      frozen,
      execute: (_handlers, _plan) => {
        const first = frozen.frozenTests.actions[0]?.cases[0];
        if (first) (first as { name: string }).name = "quietly reworded to fit the code";
        return Promise.resolve({ outcome: "passed" as const, durationMs: 0, cases: [] });
      },
    });

    await expect(run).rejects.toBeInstanceOf(FrozenIntentMutatedError);
  });

  test("a suite mutated while a failing case is being judged fails the rung", async () => {
    // The seal is checked on the failure path too, and for a sharper reason than on the
    // passing one: if executing the suite moved it, the *verdict that just failed* was
    // reached against tests nobody can vouch for, so attributing it would be theatre.
    const suite = trimSuite();
    const frozen = frozenTierInput(TRIM_SPEC, suite).frozen;
    if (!frozen) throw new Error("expected a frozen tier input");
    const { input } = repairGateInput(suite, { create: [TRIMMING_CREATE] });
    const testCase = frozen.frozenTests.actions[0]?.cases[0];
    if (!testCase) throw new Error("expected a frozen case");

    const run = runBehavioralRepairLoop({
      input,
      frozen,
      execute: () => {
        (testCase as { name: string }).name = "quietly reworded to fit the code";
        return Promise.reject(
          new FullBehavioralCaseFailure(testCase.name, {
            testCase,
            setupRows: [],
            surface: "row_state",
            failure: "the row was wrong",
          }),
        );
      },
    });

    await expect(run).rejects.toBeInstanceOf(FrozenIntentMutatedError);
  });

  test("an error that is not a case verdict fails closed but keeps the repair spend on record", async () => {
    // A repaired Handler that loads badly, the real-database guard, a scratch fault: none of
    // them is a Handler's verdict, so none may spend another turn. The tokens already spent
    // are evidence, though, and must not vanish with the raw throw.
    const suite = trimSuite();
    const frozen = frozenTierInput(TRIM_SPEC, suite).frozen;
    if (!frozen) throw new Error("expected a frozen tier input");
    const { input } = repairGateInput(suite, { create: [TRIMMING_CREATE] }, { maxAttempts: 3 });
    const testCase = frozen.frozenTests.actions[0]?.cases[0];
    if (!testCase) throw new Error("expected a frozen case");
    let turn = 0;

    const run = runBehavioralRepairLoop({
      input,
      frozen,
      execute: () => {
        turn += 1;
        return Promise.reject(
          turn === 1
            ? new FullBehavioralCaseFailure(testCase.name, {
                testCase,
                setupRows: [],
                surface: "row_state",
                failure: "the row was wrong",
              })
            : new Error("Behavioral gate execution changed real capability data tables."),
        );
      },
    });

    const error = (await run.catch((thrown: unknown) => thrown)) as BehavioralRungFailure;
    expect(error).toBeInstanceOf(BehavioralRungFailure);
    expect(error.message).toContain("changed real capability data tables");
    expect(error.diagnostic.repair.attempts).toHaveLength(2);
    expect(error.diagnostic.repair.attempts[0]?.repairs?.map((entry) => entry.action)).toEqual([
      "create",
    ]);
  });

  test("an inadmissible suite fails closed and never reaches a repair", async () => {
    const suite = trimSuite();
    // A case naming a field the spec does not declare: the suite is not admissible, so it
    // may neither judge a Handler nor license rewriting one.
    const create = suite.cases.find((entry) => entry.action === "create" && !entry.expectedError);
    if (!create) throw new Error("suite is missing normal create coverage");
    create.input = [{ field: "not_a_field", value: "x" }];
    const { input, repaired } = repairGateInput(suite, { create: [TRIMMING_CREATE] });

    const error = await expectGateFailure(input);

    expect(error.failedRung).toBe("behavioral");
    expect(repaired).toEqual([]);
  });

  test("a repaired Handler re-enters the always-on rungs before it may be called cleared", async () => {
    const suite = trimSuite();
    // Bytes that trim (so the frozen suite passes) but break the platform CRUD round-trip.
    const { input } = repairGateInput(suite, { create: [TRIMMING_CREATE] });

    const gate = await runCapabilityGate(input);

    if (gate.behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(gate.behavioral.repair.fixed).toBe(true);
    // Smoke carries a second execution: the repaired snapshot re-entered it. Its attempts
    // are cumulative across both runs, so a repaired build records strictly more than one.
    expect(gate.outcomes.find((outcome) => outcome.rung === "smoke")?.status).toBe("passed");
    expect(gate.smoke.attempts.length).toBeGreaterThanOrEqual(2);
    expect(gate.outcomes.find((outcome) => outcome.rung === "structural")?.status).toBe("passed");
  });

  test("a repair that satisfies the frozen suite but breaks the platform contract fails closed", async () => {
    const suite = reversedOrderingSuite();
    // The frozen intent asks for oldest-first; the platform's own search contract is
    // newest-first. A repair that satisfies the former violates the latter — and the Gate
    // must reject it at smoke rather than commit bytes that only one judge approved.
    const oldestFirstSearch = GOOD_HANDLERS.search.replaceAll("DESC", "ASC");
    const { input, repaired } = repairGateInput(suite, { search: [oldestFirstSearch] });

    const error = await expectGateFailure(input);

    expect(repaired).toEqual(["search"]);
    expect(error).toBeInstanceOf(CapabilityGateError);
    expect(error.failedRung).toBe("smoke");
  });
});
