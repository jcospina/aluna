import { describe, expect, test } from "bun:test";
import type { ZodType } from "zod";
import type { GenerateResult, Provider } from "../../../../../platform/provider/index.ts";
import { deriveCapabilityTableDdl } from "../../../../../runtime/data/index.ts";
import type { HandlerUnitName } from "../../../../units/generation/units.ts";
import {
  CREATE_HANDLER,
  type FullBehavioralTestSuite,
  frozenTierInput,
  fullBehavioralSuiteFor,
  GOOD_HANDLERS,
  gateInput,
  itemRendererFor,
  makeHandlerRepairProvider,
  notesSpec,
} from "../../../gate.test-support.ts";
import { runCapabilityGate } from "../../../gate.ts";
import { FullBehavioralCaseFailure } from "../generation/gate-behavioral-full.ts";
import { BehavioralRungFailure, runBehavioralRepairLoop } from "./gate-behavioral-repair.ts";

const ALL_FIVE: readonly HandlerUnitName[] = ["create", "read", "update", "delete", "search"];
const TRIM_SPEC = notesSpec({ behavior: "Text is trimmed before saving." });
const TRIMMING_CREATE = CREATE_HANDLER.replace(
  "text: input.values.text,",
  'text: String(input.values.text ?? "").trim(),',
);

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
  const { provider, repaired } = makeHandlerRepairProvider(replacements, suite);
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
  return { input, repaired };
}

describe("behavioral repair — adversarial per-Handler bounds", () => {
  test("each Handler keeps an independent repair budget across sequential failures", async () => {
    const suite = passingSuite();
    const createRepair = `${GOOD_HANDLERS.create}\n`;
    const updateRepair = `${GOOD_HANDLERS.update}\n`;
    const { input, repaired } = repairGateInput(
      suite,
      { create: [createRepair], update: [updateRepair] },
      { maxAttempts: 2 },
    );
    const frozen = input.behavioralTier?.frozen;
    if (!frozen) throw new Error("expected a frozen tier input");
    const createCase = frozen.frozenTests.actions.find((entry) => entry.action === "create")
      ?.cases[0];
    const updateCase = frozen.frozenTests.actions.find((entry) => entry.action === "update")
      ?.cases[0];
    if (!createCase || !updateCase) throw new Error("expected create and update cases");
    let turn = 0;

    const run = await runBehavioralRepairLoop({
      input,
      frozen,
      execute: (handlers) => {
        turn += 1;
        if (turn === 1) {
          throw new FullBehavioralCaseFailure(createCase.name, {
            testCase: createCase,
            setupRows: [],
            surface: "row_state",
            failure: "create needs repair",
          });
        }
        expect(handlers.create).toBe(createRepair);
        if (turn === 2) {
          throw new FullBehavioralCaseFailure(updateCase.name, {
            testCase: updateCase,
            setupRows: [],
            surface: "row_state",
            failure: "update independently needs repair",
          });
        }
        expect(handlers.update).toBe(updateRepair);
        return Promise.resolve({ outcome: "passed" as const, durationMs: 0, cases: [] });
      },
    });

    expect(repaired).toEqual(["create", "update"]);
    if (run.result.tier !== "on") throw new Error("expected a tier-on result");
    expect(run.result.repair.attempts).toHaveLength(3);
    expect(
      run.result.repair.attempts.flatMap((attempt) =>
        (attempt.generations ?? []).map((generation) => [generation.action, generation.attempt]),
      ),
    ).toEqual([
      ["create", 1],
      ["update", 1],
    ]);
  });

  test("a structurally rejected rewrite feeds its error back while that Handler has budget", async () => {
    const suite = trimSuite();
    const { input, repaired } = repairGateInput(
      suite,
      { create: ["export default 'not a handler';", TRIMMING_CREATE] },
      { maxAttempts: 3 },
    );

    const gate = await runCapabilityGate(input);

    expect(repaired).toEqual(["create", "create"]);
    if (gate.behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    expect(gate.behavioral.repair.attempts[0]?.generations?.map((entry) => entry.outcome)).toEqual([
      "structural_rejected",
      "repaired",
    ]);
  });
});

describe("behavioral repair — adversarial timing and cancellation", () => {
  test("attempt duration does not add the already-included repair interval twice", async () => {
    const fixture = repairGateInput(trimSuite(), { create: [TRIMMING_CREATE] });
    const provider = fixture.input.provider;
    if (!provider) throw new Error("expected a repair provider");
    const delayedProvider: Provider = {
      generate<T>(prompt: string, schema: ZodType<T>): GenerateResult<T> {
        const generated = provider.generate(prompt, schema);
        return {
          ...generated,
          object: generated.object.then(
            (value) =>
              new Promise<T>((resolve) => {
                setTimeout(() => resolve(value), 50);
              }),
          ),
        };
      },
    };

    const gate = await runCapabilityGate({ ...fixture.input, provider: delayedProvider });

    if (gate.behavioral.tier !== "on") throw new Error("expected a tier-on Gate result");
    const failed = gate.behavioral.repair.attempts[0];
    if (!failed?.repairDurationMs) throw new Error("expected measured repair time");
    // If the repair interval were added twice, the remainder would be at least one
    // complete repair interval. Compare the intervals directly so host load cannot turn
    // this invariant into an accidental wall-clock performance assertion.
    expect(failed.durationMs - failed.repairDurationMs).toBeLessThan(failed.repairDurationMs);
  });

  test("an abort stops a conservative round before another Handler call starts", async () => {
    const fixture = repairGateInput(
      reversedOrderingSuite(),
      {},
      {
        impact: { regeneratedHandlers: [...ALL_FIVE], regeneratedItemRenderer: true },
        maxAttempts: 2,
      },
    );
    const frozen = fixture.input.behavioralTier?.frozen;
    if (!frozen) throw new Error("expected a frozen tier input");
    const searchCase = frozen.frozenTests.actions.find((entry) => entry.action === "search")
      ?.cases[0];
    if (!searchCase) throw new Error("expected a search case");
    const abort = new DOMException("cancelled", "AbortError");
    let calls = 0;
    const provider = {
      generate(): never {
        calls += 1;
        throw abort;
      },
    };

    const run = runBehavioralRepairLoop({
      input: { ...fixture.input, provider },
      frozen,
      execute: () => {
        throw new FullBehavioralCaseFailure(searchCase.name, {
          testCase: searchCase,
          setupRows: [],
          surface: "fragment",
          failure: "ordering differs",
        });
      },
    });

    await expect(run).rejects.toBe(abort);
    expect(calls).toBe(1);
  });

  test("a rejected repair object retains usage that the provider already reported", async () => {
    const suite = passingSuite();
    const fixture = repairGateInput(suite, {}, { maxAttempts: 2 });
    const frozen = fixture.input.behavioralTier?.frozen;
    if (!frozen) throw new Error("expected a frozen tier input");
    const createCase = frozen.frozenTests.actions.find((entry) => entry.action === "create")
      ?.cases[0];
    if (!createCase) throw new Error("expected a create case");
    const provider: Provider = {
      generate<T>(): GenerateResult<T> {
        return {
          object: Promise.reject(new Error("structured output rejected")),
          usage: Promise.resolve({ inputTokens: 3, outputTokens: 5, totalTokens: 8 }),
          partialStream: (async function* empty() {})(),
        };
      },
    };

    try {
      await runBehavioralRepairLoop({
        input: { ...fixture.input, provider },
        frozen,
        execute: () => {
          throw new FullBehavioralCaseFailure(createCase.name, {
            testCase: createCase,
            setupRows: [],
            surface: "row_state",
            failure: "create needs repair",
          });
        },
      });
      throw new Error("expected repair failure");
    } catch (error) {
      expect(error).toBeInstanceOf(BehavioralRungFailure);
      if (!(error instanceof BehavioralRungFailure)) throw error;
      expect(error.measurement.usage.totalTokens).toBe(8);
      expect(error.measurement.generations[0]).toMatchObject({
        action: "create",
        outcome: "provider_error",
        usage: { totalTokens: 8 },
      });
    }
  });
});
