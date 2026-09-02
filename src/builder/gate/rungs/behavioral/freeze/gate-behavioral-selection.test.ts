// Behavioral execution *selection* — PLAN decision 23's execution clause.
//
// Generation follows total per-Action inputs; execution follows executable impact.
// The selection rules themselves are pinned in `behavioral-execution-plan.test.ts`. These
// are the facts only the running rung can prove: that a skip really executes nothing, that
// coverage is one Handler because of how a case runs, and that the Gate's own bounded
// repairs count as regeneration even though the caller could not have known about them.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import type { CapabilitySpec } from "../../../../../registry/index.ts";
import { deriveCapabilityTableDdl } from "../../../../../runtime/data/index.ts";
import {
  BEHAVIORAL_SUITE as FULL_BEHAVIORAL_SUITE,
  CREATE_HANDLER as FULL_CREATE_HANDLER,
  DELETE_HANDLER as FULL_DELETE_HANDLER,
  ITEM_RENDERER as FULL_ITEM_RENDERER,
  NOTES_SPEC as FULL_NOTES_SPEC,
  READ_HANDLER as FULL_READ_HANDLER,
  SEARCH_HANDLER as FULL_SEARCH_HANDLER,
  UPDATE_HANDLER as FULL_UPDATE_HANDLER,
} from "../../../../../server/app.test-support.ts";
import {
  DEFAULT_BEHAVIORAL_SUITE,
  type FullBehavioralTestSuite,
  frozenTestsInput,
  gateInput,
  generatedUnitsFor,
  makeBehaviorProvider,
  notesSpec,
} from "../../../gate.test-support.ts";
import { runCapabilityGate } from "../../../gate.ts";
import { runFullBehavioralRung } from "../generation/gate-behavioral-full.ts";
import type { BehavioralExecutionImpact } from "./behavioral-execution-plan.ts";

setDefaultTimeout(15_000);

const FIVE_ACTION_SPEC = notesSpec();
const FIVE_ACTION_UNITS = generatedUnitsFor(FIVE_ACTION_SPEC);
const FULL_SPEC = FULL_NOTES_SPEC as CapabilitySpec;

function fullInput() {
  return gateInput(
    {
      spec: FULL_SPEC,
      ddl: deriveCapabilityTableDdl(FULL_SPEC),
      itemRenderer: FULL_ITEM_RENDERER,
      handlers: {
        create: FULL_CREATE_HANDLER,
        read: FULL_READ_HANDLER,
        update: FULL_UPDATE_HANDLER,
        delete: FULL_DELETE_HANDLER,
        search: FULL_SEARCH_HANDLER,
      },
    },
    FULL_BEHAVIORAL_SUITE,
  );
}
/** A tier input whose every suite was carried forward byte-for-byte, with a stated impact. */
function carriedTierInput(
  spec: CapabilitySpec,
  impact: BehavioralExecutionImpact,
  suite: FullBehavioralTestSuite = FULL_BEHAVIORAL_SUITE,
) {
  const base = frozenTestsInput(spec, suite);
  return {
    enabled: true,
    impact,
    frozen: {
      ...base,
      generation: {
        ...base.generation,
        generatedActions: [],
        carriedActions: base.generation.generatedActions,
      },
    },
  };
}

const ACTIONS = ["create", "read", "update", "delete", "search"] as const;

/**
 * Handler source that cannot even be prepared for execution. The rung loads every declared
 * Handler before its first case, so a run that passes with these in place demonstrably ran
 * nothing at all — the pin for "the tests were copied and not run", which has no separate
 * test process to observe the absence of.
 */
const UNLOADABLE_HANDLERS = Object.fromEntries(
  ACTIONS.map((action) => [action, `const ${action} = "never loadable";`]),
);

/** Handlers that load cleanly and throw the moment they are invoked. */
const UNCALLABLE_HANDLERS = Object.fromEntries(
  ACTIONS.map((action) => [
    action,
    `export default async function tripwire(): Promise<string> {\n  throw new Error("the behavioral rung invoked the ${action} Handler");\n}`,
  ]),
);

describe("capability gate — behavioral execution selection", () => {
  test("unchanged inputs and no covered Handler change copy the tests and run nothing", async () => {
    const spec = FULL_NOTES_SPEC as CapabilitySpec;
    const { result } = await runFullBehavioralRung({
      ...fullInput(),
      handlers: UNLOADABLE_HANDLERS,
      behavioralTier: carriedTierInput(spec, { regeneratedHandlers: [] }),
    });

    if (result.tier !== "on") throw new Error("tier-on rung returned a tier-off result");
    expect(result.testRun.cases).toEqual([]);
    expect(result.execution.fullSuite).toBe(false);
    expect(result.execution.actions.map((entry) => entry.execution)).toEqual([
      "skipped",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
    expect(result.execution.actions.every((entry) => entry.source === "copied")).toBe(true);
    // The suite the snapshot carries is still the frozen one, untouched by not running.
    expect(result.frozenTests).toEqual(
      carriedTierInput(spec, { regeneratedHandlers: [] }).frozen.frozenTests,
    );
  });

  test("a copied suite runs — and covers exactly one Handler — when its Handler regenerates", async () => {
    const spec = FULL_NOTES_SPEC as CapabilitySpec;
    const input = fullInput();
    const { result } = await runFullBehavioralRung({
      ...input,
      // Every Handler but `update` throws if it is called. The update suite still passes,
      // which is what makes "an Action's suite covers exactly its own Handler" a fact about
      // the executor rather than a claim about the generated cases: setup rows are seeded
      // through the platform mutation port and state is read back through the platform query
      // port, so no other generated Handler is ever invoked.
      handlers: { ...UNCALLABLE_HANDLERS, update: input.handlers.update ?? "" },
      behavioralTier: carriedTierInput(spec, { regeneratedHandlers: ["update"] }),
    });

    if (result.tier !== "on") throw new Error("tier-on rung returned a tier-off result");
    expect(result.execution.fullSuite).toBe(false);
    expect([...new Set(result.testRun.cases.map((entry) => entry.action))]).toEqual(["update"]);
    expect(result.testRun.cases.length).toBeGreaterThan(0);
    expect(
      result.execution.actions
        .filter((entry) => entry.execution === "executed")
        .map((entry) => entry.action),
    ).toEqual(["update"]);
  });

  test("attribution that cannot be narrowed runs the complete frozen suite", async () => {
    const spec = FULL_NOTES_SPEC as CapabilitySpec;
    const { result } = await runFullBehavioralRung({
      ...fullInput(),
      behavioralTier: carriedTierInput(spec, {
        regeneratedHandlers: ["update"],
        regeneratedItemRenderer: true,
      }),
    });

    if (result.tier !== "on") throw new Error("tier-on rung returned a tier-off result");
    expect(result.execution.fullSuite).toBe(true);
    expect(result.execution.fullSuiteReason).toContain("could not be attributed to one Handler");
    expect([...new Set(result.testRun.cases.map((entry) => entry.action))]).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
    ]);
    expect(result.testRun.cases.length).toBe(
      carriedTierInput(spec, { regeneratedHandlers: [] }).frozen.generation.testCount,
    );
  });
});

describe("capability gate — behavioral execution fallback and repair impact", () => {
  test("a caller that states no impact runs everything", async () => {
    // The default for every direct Gate caller: nothing was claimed about which Handlers
    // moved, so no copied suite can be proven unaffected and all of them run.
    const spec = FULL_NOTES_SPEC as CapabilitySpec;
    const tier = carriedTierInput(spec, { regeneratedHandlers: [] });
    const { result } = await runFullBehavioralRung({
      ...fullInput(),
      behavioralTier: { enabled: true, frozen: tier.frozen },
    });

    if (result.tier !== "on") throw new Error("tier-on rung returned a tier-off result");
    expect(result.execution.fullSuite).toBe(true);
    expect(result.execution.actions.every((entry) => entry.execution === "executed")).toBe(true);
  });

  test("a Handler the Gate itself repaired counts as regenerated", async () => {
    // The plan said "copy search". The smoke rung then rewrote it. Selection has to answer
    // to the bytes the Gate is about to clear, not to a plan made before the repair existed.
    const handlers = Object.fromEntries(
      FIVE_ACTION_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
        unit.name,
        unit.content,
      ]),
    );
    const itemRenderer = FIVE_ACTION_UNITS.find((unit) => unit.kind === "item-renderer")?.content;
    const goodSearch = handlers.search;
    if (!itemRenderer || !goodSearch) throw new Error("generated Gate unit missing");
    const { provider } = makeBehaviorProvider({ content: goodSearch });

    const result = await runCapabilityGate(
      gateInput({
        spec: FIVE_ACTION_SPEC,
        ddl: deriveCapabilityTableDdl(FIVE_ACTION_SPEC),
        handlers: {
          ...handlers,
          search: goodSearch.replaceAll("platform_search_normalize", "lower"),
        },
        itemRenderer,
        provider,
        behavioralTier: carriedTierInput(
          FIVE_ACTION_SPEC,
          { regeneratedHandlers: [] },
          DEFAULT_BEHAVIORAL_SUITE,
        ),
      }),
    );

    expect(result.smoke.fixed).toBe(true);
    if (result.behavioral.tier !== "on") throw new Error("expected the behavioral tier on");
    expect(
      result.behavioral.execution.actions.find((entry) => entry.action === "search"),
    ).toMatchObject({ execution: "executed", reason: "covered_handler_regenerated" });
  });
});
