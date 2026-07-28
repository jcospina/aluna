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
import { BEHAVIORAL_ERROR_MARKERS, type CapabilitySpec } from "../../../registry/index.ts";
import {
  CREATE_HANDLER,
  DEFAULT_BEHAVIORAL_SUITE,
  expectGateFailure,
  type FullBehavioralTestSuite,
  frozenTestsInput,
  fullBehavioralSuiteFor,
  GOOD_HANDLERS,
  gateInput,
  generatedUnitsFor,
  notesSpec,
} from "../gate.test-support.ts";
import {
  BEHAVIORAL_TIER_ENV_VAR,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
} from "../gate.ts";
import { runFullBehavioralRung } from "./gate-behavioral-full.ts";

setDefaultTimeout(15_000);

const FIVE_ACTION_SPEC = notesSpec();
const FIVE_ACTION_UNITS = generatedUnitsFor(FIVE_ACTION_SPEC);

function fullInput(suite: FullBehavioralTestSuite = FULL_BEHAVIORAL_SUITE) {
  return gateInput(
    {
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
    },
    suite,
  );
}

describe("capability gate — empty behavioral read", () => {
  test("accepts the required empty read fragment when no rows exist", async () => {
    const emptyReadSuite = structuredClone(DEFAULT_BEHAVIORAL_SUITE);
    const readCase = emptyReadSuite.cases.find((testCase) => testCase.action === "read");
    if (!readCase) throw new Error("behavioral suite is missing normal read coverage");
    readCase.name = "returns empty collection when no entries exist";
    readCase.setupRows = [];
    readCase.expectedRows = [];
    readCase.expectedRowCount = 0;
    readCase.expectFragmentIncludes = [];
    readCase.expectFragmentExcludes = [];
    readCase.expectFragmentIncludesInOrder = [];

    const result = await runCapabilityGate(gateInput({}, emptyReadSuite));

    expect(result.behavioral.status).toBe("passed");
  });

  test("preserves semantic error fragments for read error cases with no rows", async () => {
    const readError: CapabilitySpec["behavioral_errors"][number] = {
      action: "read",
      trigger: "read_unavailable",
      code: "read_unavailable",
      fields: ["text"],
      expected_markers: BEHAVIORAL_ERROR_MARKERS,
    };
    const baseSpec = notesSpec();
    const spec = notesSpec({
      behavioral_errors: [...baseSpec.behavioral_errors, readError],
    });
    const suite = { cases: [...structuredClone(DEFAULT_BEHAVIORAL_SUITE).cases] };
    const normalRead = suite.cases.find((testCase) => testCase.action === "read");
    if (!normalRead) throw new Error("behavioral suite is missing normal read coverage");
    suite.cases.push({
      ...normalRead,
      name: "reports an unavailable read with stable markers",
      setupRows: [],
      expectedRows: [],
      expectedRowCount: 0,
      expectFragmentIncludes: [],
      expectFragmentExcludes: [],
      expectFragmentIncludesInOrder: [],
      expectedError: readError,
    });
    const read = [
      "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
      "  const rows = query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
      "  });",
      '  if (rows.length === 0) return \'<div data-role="error" data-error-code="read_unavailable" data-error-fields="text">Unavailable.</div>\';',
      '  return rows.map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");

    const result = await runFullBehavioralRung(
      gateInput(
        {
          spec,
          ddl: deriveCapabilityTableDdl(spec),
          handlers: { ...GOOD_HANDLERS, read },
        },
        suite,
      ),
    );

    expect(result.status).toBe("passed");
  });
});

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
      gateInput(
        {
          spec: trimSpec,
          ddl: deriveCapabilityTableDdl(trimSpec),
          handlers: { ...GOOD_HANDLERS, create: trimmingCreate },
        },
        trimSuite,
      ),
    );
    expect(pass.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);

    const error = await expectGateFailure(
      gateInput(
        {
          spec: trimSpec,
          ddl: deriveCapabilityTableDdl(trimSpec),
          handlers: GOOD_HANDLERS,
        },
        trimSuite,
      ),
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
      gateInput(
        {
          spec,
          ddl: deriveCapabilityTableDdl(spec),
          handlers,
          itemRenderer,
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
        },
        suite,
      ),
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

    const result = await runCapabilityGate(gateInput({}, orderSuite));

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

    const result = await runCapabilityGate(gateInput({}, orderSuite));

    expect(result.outcomes.map((outcome) => `${outcome.rung}:${outcome.status}`)).toEqual([
      "structural:passed",
      "smoke:passed",
      "behavioral:passed",
      "design-lint:passed",
    ]);
  });
});

describe("capability gate — behavioral tier", () => {
  test("tier-on retains the exact frozen per-Action suite for snapshot publication", async () => {
    const result = await runCapabilityGate(fullInput());

    expect(result.behavioral.tier).toBe("on");
    if (result.behavioral.tier !== "on") throw new Error("Behavioral tier unexpectedly skipped.");
    const frozen = result.behavioral.frozenTests;
    expect(frozen.actions.map((entry) => entry.action)).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
    ]);
    // The Gate hands back exactly what it was given — every case, unmoved and undigested
    // by execution — regrouped only by the Action that owns it.
    expect(frozen.actions.flatMap((entry) => entry.cases)).toEqual(
      ["create", "read", "update", "delete", "search"].flatMap((action) =>
        FULL_BEHAVIORAL_SUITE.cases.filter((testCase) => testCase.action === action),
      ),
    );
    for (const entry of frozen.actions) expect(entry.input_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  test("tier-on without a frozen suite fails closed instead of silently skipping", async () => {
    // The Gate executes behavioral intent; it never authors it. A caller that turned the
    // tier on but froze nothing has a bug, and a skipped rung would hide it.
    const error = await expectGateFailure({
      ...fullInput(),
      behavioralTier: { enabled: true },
    });

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      "no frozen test suite was supplied",
    );
  });

  test("tier-on rejects a frozen suite that is not addressed to the spec's own inputs", async () => {
    const input = fullInput();
    const frozen = frozenTestsInput(FULL_NOTES_SPEC as CapabilitySpec);
    const tampered = {
      ...frozen,
      frozenTests: {
        actions: frozen.frozenTests.actions.map((entry) =>
          entry.action === "create"
            ? { ...entry, input_digest: `sha256:${"0".repeat(64)}` }
            : entry,
        ),
      },
    };

    const error = await expectGateFailure({
      ...input,
      behavioralTier: { enabled: true, frozen: tampered },
    });

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      "Frozen create tests are not content-addressed to their current total inputs",
    );
  });

  test("tier-off rejects supplied frozen intent instead of silently discarding it", async () => {
    const input = fullInput();
    const frozen = input.behavioralTier?.frozen;
    if (!frozen) throw new Error("fixture is missing frozen behavioral intent");

    await expect(
      runCapabilityGate({
        ...input,
        behavioralTier: { enabled: false, frozen },
      }),
    ).rejects.toThrow("refusing to discard frozen intent");
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
