// Behavioral execution, scratch-catalog, ordering, and tier integration tests.

import { describe, expect, setDefaultTimeout, test } from "bun:test";
import {
  BEHAVIORAL_SUITE as FULL_BEHAVIORAL_SUITE,
  CREATE_HANDLER as FULL_CREATE_HANDLER,
  DELETE_HANDLER as FULL_DELETE_HANDLER,
  ITEM_RENDERER as FULL_ITEM_RENDERER,
  NOTES_SPEC as FULL_NOTES_SPEC,
  READ_HANDLER as FULL_READ_HANDLER,
  SEARCH_HANDLER as FULL_SEARCH_HANDLER,
  UPDATE_HANDLER as FULL_UPDATE_HANDLER,
} from "../../../app/app.test-support.ts";
import { deriveCapabilityTableDdl } from "../../../capability-data/index.ts";
import type { CapabilitySpec } from "../../../registry/index.ts";
import {
  CREATE_HANDLER,
  DEFAULT_BEHAVIORAL_SUITE,
  expectGateFailure,
  fullBehavioralSuiteFor,
  GOOD_HANDLERS,
  gateInput,
  generatedUnitsFor,
  makeBehaviorProvider,
  notesSpec,
} from "../gate.test-support.ts";
import {
  BEHAVIORAL_TIER_ENV_VAR,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
} from "../gate.ts";

setDefaultTimeout(15_000);

const FIVE_ACTION_SPEC = notesSpec();
const FIVE_ACTION_UNITS = generatedUnitsFor(FIVE_ACTION_SPEC);

function fullInput(suite: unknown = FULL_BEHAVIORAL_SUITE) {
  return gateInput({
    spec: FULL_NOTES_SPEC as CapabilitySpec,
    ddl: deriveCapabilityTableDdl(FULL_NOTES_SPEC as CapabilitySpec),
    itemRenderer: FULL_ITEM_RENDERER,
    handlers: {
      create: FULL_CREATE_HANDLER,
      read: FULL_READ_HANDLER,
      update: FULL_UPDATE_HANDLER,
      delete: FULL_DELETE_HANDLER,
      search: FULL_SEARCH_HANDLER,
    },
    provider: makeBehaviorProvider(suite).provider,
  });
}

describe("capability gate — behavioral violations", () => {
  test("behavioral rung fails violating handlers and passes conforming handlers", async () => {
    const trimSpec = notesSpec({ behavior: "Text is trimmed before saving." });
    const trimSuite = fullBehavioralSuiteFor(trimSpec, {
      createValues: { text: "Trim me", pinned: false },
      updateValues: { text: "Updated note", pinned: false },
      readValues: { text: "Read note", pinned: false },
      searchMatchValues: { text: "Matching note newest", pinned: false },
      searchOlderMatchValues: { text: "Matching note older", pinned: false },
      searchMissValues: { text: "Other entry", pinned: false },
      markerField: "text",
      searchQuery: "matching",
    });
    const normalCreate = trimSuite.cases.find(
      (testCase) => testCase.action === "create" && !testCase.expectedError,
    );
    if (!normalCreate) throw new Error("trim suite is missing normal create coverage");
    normalCreate.name = "trims note text before saving";
    normalCreate.input = [
      { field: "text", value: "  Trim me  " },
      { field: "pinned", value: "false" },
    ];
    const trimmingCreate = CREATE_HANDLER.replace(
      "text: input.values.text,",
      'text: String(input.values.text ?? "").trim(),',
    );

    const pass = await runCapabilityGate(
      gateInput({
        spec: trimSpec,
        ddl: deriveCapabilityTableDdl(trimSpec),
        provider: makeBehaviorProvider(trimSuite).provider,
        handlers: { ...GOOD_HANDLERS, create: trimmingCreate },
      }),
    );
    expect(pass.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);

    const error = await expectGateFailure(
      gateInput({
        spec: trimSpec,
        ddl: deriveCapabilityTableDdl(trimSpec),
        provider: makeBehaviorProvider(trimSuite).provider,
        handlers: GOOD_HANDLERS,
      }),
    );

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:failed",
      "design-lint:passed",
    ]);
    expect(error.outcomes[2]?.error).toContain("trims note text before saving");
    expect(error.outcomes[2]?.error).toContain("did not find a scratch row matching");
    expect(error.diagnostic).toMatchObject({
      failure: expect.stringContaining("did not find a scratch row matching"),
      actionInput: {
        values: { text: "  Trim me  ", pinned: "false" },
        submittedFields: expect.any(Set),
      },
      scratchRows: [expect.objectContaining({ text: "  Trim me  " })],
      fragment: expect.stringContaining("Trim me"),
    });
  });
});

describe("capability gate — behavioral scratch catalog", () => {
  test("behavioral execution receives declared synthetic dependency schemas and compatibility rows", async () => {
    const dependencyIncarnation = "33333333-3333-4333-8333-333333333333";
    const dependencySpec = notesSpec({
      id: "behavior_catalog",
      label: "Behavior catalog",
      schema: {
        fields: [
          { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
          {
            name: "retired_note",
            label: "Retired note",
            type: "string",
            required: false,
            lifecycle: "inactive",
          },
        ],
      },
    });
    const spec: CapabilitySpec = {
      ...FIVE_ACTION_SPEC,
      schema: {
        fields: FIVE_ACTION_SPEC.schema.fields.map((field) => ({
          ...field,
          required: false,
        })),
      },
      behavioral_errors: [],
      read_dependencies: {
        ...FIVE_ACTION_SPEC.read_dependencies,
        read: [
          {
            capability_id: dependencySpec.id,
            incarnation_id: dependencyIncarnation,
          },
        ],
      },
    };
    const handlers = {
      ...Object.fromEntries(
        FIVE_ACTION_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
          unit.name,
          unit.content,
        ]),
      ),
      read: [
        "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
        "  return query.records({",
        '    sql: \'SELECT target."id" AS "target_id" FROM "cap_notes" AS target CROSS JOIN "cap_behavior_catalog" AS catalog WHERE catalog."text" = ? AND catalog."retired_note" = ? ORDER BY target."created_at" DESC, target."id" DESC\',',
        '    parameters: ["synthetic behavior", "compatible hidden value"],',
        '  }).map(({ record }) => present(record)).join("");',
        "}",
      ].join("\n"),
    };
    const itemRenderer = FIVE_ACTION_UNITS.find((unit) => unit.kind === "item-renderer")?.content;
    if (!itemRenderer) throw new Error("generated item renderer missing");
    const suite = fullBehavioralSuiteFor(spec, {
      createValues: { text: "Behavioral entry", pinned: false },
      updateValues: { text: "Updated entry", pinned: false },
      readValues: { text: "Read entry", pinned: false },
      searchMatchValues: { text: "Search entry newest", pinned: false },
      searchOlderMatchValues: { text: "Search entry older", pinned: false },
      searchMissValues: { text: "Other entry", pinned: false },
      markerField: "text",
      searchQuery: "search",
    });

    const result = await runCapabilityGate(
      gateInput({
        spec,
        ddl: deriveCapabilityTableDdl(spec),
        handlers,
        itemRenderer,
        provider: makeBehaviorProvider(suite).provider,
        scratchCatalog: [
          {
            spec: dependencySpec,
            incarnationId: dependencyIncarnation,
            rows: [
              {
                text: "synthetic behavior",
                retired_note: "compatible hidden value",
              },
            ],
          },
        ],
      }),
    );

    expect(result.behavioral.status).toBe("passed");
  });
});

describe("capability gate — setup-row ordering", () => {
  test("setup rows are deterministic older records for newest-first behavioral checks", async () => {
    const orderSuite = structuredClone(DEFAULT_BEHAVIORAL_SUITE);
    const readCase = orderSuite.cases.find((testCase) => testCase.action === "read");
    if (!readCase) throw new Error("order suite is missing read coverage");
    readCase.name = "setup rows render newest first";
    readCase.setupRows = [
      {
        values: [
          { field: "text", value: "Newest setup note" },
          { field: "pinned", value: false },
        ],
      },
      {
        values: [
          { field: "text", value: "Older note" },
          { field: "pinned", value: false },
        ],
      },
    ];
    readCase.expectedRows = readCase.setupRows;
    readCase.expectedRowCount = 2;
    readCase.expectFragmentIncludes = ["Newest setup note", "Older note"];
    readCase.expectFragmentIncludesInOrder = ["Newest setup note", "Older note"];

    const result = await runCapabilityGate(
      gateInput({ provider: makeBehaviorProvider(orderSuite).provider }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });

  test("setup rows are newest-first: array order maps directly to a newest-first read", async () => {
    // Regression: with two+ setup rows, the model lists them newest-first and derives
    // expectReadFragmentIncludesInOrder = [new row, ...setupRows]. The gate must age
    // them so setupRows[0] is the most recent preexisting row; otherwise a correct
    // newest-first handler fails a self-inconsistent test (the bug this guards).
    const orderSuite = structuredClone(DEFAULT_BEHAVIORAL_SUITE);
    const readCase = orderSuite.cases.find((testCase) => testCase.action === "read");
    if (!readCase) throw new Error("order suite is missing read coverage");
    readCase.name = "setup row array order maps to newest-first read";
    readCase.setupRows = [
      {
        values: [
          { field: "text", value: "Newest setup note" },
          { field: "pinned", value: false },
        ],
      },
      {
        values: [
          { field: "text", value: "Middle note" },
          { field: "pinned", value: false },
        ],
      },
      {
        values: [
          { field: "text", value: "Oldest note" },
          { field: "pinned", value: false },
        ],
      },
    ];
    readCase.expectedRows = readCase.setupRows;
    readCase.expectedRowCount = 3;
    readCase.expectFragmentIncludes = ["Newest setup note", "Middle note", "Oldest note"];
    readCase.expectFragmentIncludesInOrder = ["Newest setup note", "Middle note", "Oldest note"];

    const result = await runCapabilityGate(
      gateInput({ provider: makeBehaviorProvider(orderSuite).provider }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });
});

describe("capability gate — behavioral tier", () => {
  test("tier-on retains the exact validated suite for snapshot publication", async () => {
    const result = await runCapabilityGate(fullInput());

    expect(result.behavioral.tier).toBe("on");
    if (result.behavioral.tier !== "on") throw new Error("Behavioral tier unexpectedly skipped.");
    expect(result.behavioral.frozenTests as unknown).toEqual(FULL_BEHAVIORAL_SUITE);
    expect(result.behavioral.frozenTests.cases).toHaveLength(result.behavioral.testGen.testCount);
  });

  test("behavioral tier defaults on and can be globally skipped for baseline runs", async () => {
    expect(resolveBehavioralTierEnabled({})).toBe(true);
    expect(resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "off" })).toBe(false);
    expect(resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "0" })).toBe(false);
    expect(resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "on" })).toBe(true);
    expect(() => resolveBehavioralTierEnabled({ [BEHAVIORAL_TIER_ENV_VAR]: "maybe" })).toThrow(
      BEHAVIORAL_TIER_ENV_VAR,
    );

    const result = await runCapabilityGate(
      gateInput({ provider: undefined, behavioralTier: { enabled: false } }),
    );

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:skipped",
      "design-lint:passed",
    ]);
    expect(result.behavioral).toMatchObject({
      tier: "off",
      status: "skipped",
      reason: "Behavioral tier is off for this run.",
    });
    expect("frozenTests" in result.behavioral).toBe(false);
  });
});
