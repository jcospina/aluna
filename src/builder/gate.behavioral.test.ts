// Behavioral-rung tests for the always-on gate (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: the five-Action behavioral Gate remains one integration surface.

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
} from "../app.test-support.ts";
import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import { type CapabilitySpec, MISSING_REQUIRED_FIELDS_ERROR_CODE } from "../registry/index.ts";
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
} from "./gate.test-support.ts";
import {
  BEHAVIORAL_TIER_ENV_VAR,
  buildBehavioralTestPrompt,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
} from "./gate.ts";
import { runFullBehavioralRung } from "./gate-behavioral-full.ts";
import { assertFullSuiteContract } from "./gate-behavioral-full-contract.ts";

setDefaultTimeout(15_000);

const FIVE_ACTION_SPEC = notesSpec();
const FIVE_ACTION_UNITS = generatedUnitsFor(FIVE_ACTION_SPEC);

function fullInput(
  suite: unknown = FULL_BEHAVIORAL_SUITE,
  handlerOverrides: Partial<Record<"search", string>> = {},
) {
  return gateInput({
    spec: FULL_NOTES_SPEC as CapabilitySpec,
    ddl: deriveCapabilityTableDdl(FULL_NOTES_SPEC as CapabilitySpec),
    itemRenderer: FULL_ITEM_RENDERER,
    handlers: {
      create: FULL_CREATE_HANDLER,
      read: FULL_READ_HANDLER,
      update: FULL_UPDATE_HANDLER,
      delete: FULL_DELETE_HANDLER,
      search: handlerOverrides.search ?? FULL_SEARCH_HANDLER,
    },
    provider: makeBehaviorProvider(suite).provider,
  });
}

describe("capability gate — behavioral test generation", () => {
  test("behavioral test generation sees only behavior and schema, never handler code", async () => {
    const { provider, prompts, jsonSchemas } = makeBehaviorProvider();
    const createMarker = "HANDLER_SOURCE_MUST_NOT_ENTER_TEST_GENERATION";
    const result = await runCapabilityGate(
      gateInput({
        provider,
        handlers: { ...GOOD_HANDLERS, create: `${CREATE_HANDLER}\n// ${createMarker}` },
      }),
    );

    expect(result.behavioral.status).toBe("passed");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Text is required. Newest notes appear first.");
    expect(prompts[0]).toContain('"schema"');
    expect(prompts[0]).toContain('"fields"');
    expect(prompts[0]).toContain('"behavioral_errors"');
    expect(prompts[0]).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
    expect(prompts[0]).toContain(
      "every Action in the source material needs at least one normal case",
    );
    expect(prompts[0]).not.toContain(createMarker);
    expect(prompts[0]).not.toContain("export default async function");
    expect(buildBehavioralTestPrompt(notesSpec())).not.toContain("export default async function");
    expect(JSON.stringify(jsonSchemas[0])).not.toContain("propertyNames");
    const schema = jsonSchemas[0] as {
      properties?: {
        cases?: {
          items?: {
            properties?: Record<string, unknown>;
            required?: string[];
          };
        };
      };
    };
    const caseSchema = schema.properties?.cases?.items;
    expect(caseSchema?.required).toContain("expectedError");
    expect(caseSchema?.required?.sort()).toEqual(Object.keys(caseSchema?.properties ?? {}).sort());
    expect(JSON.stringify(caseSchema?.properties?.expectedError)).toContain("null");
  });

  test("requires non-vacuous ordered search evidence from generated suites", () => {
    const prompt = buildBehavioralTestPrompt(notesSpec());

    expect(prompt).toContain("Every normal search case must seed at least two matching rows");
    expect(prompt).toContain(
      "`expectFragmentIncludesInOrder` must list one unique synthetic marker from each matching row",
    );
    expect(prompt).not.toContain("should exclude at least one seeded non-match");
    expect(prompt).not.toContain("add a seeded non-match");
  });

  test("describes an honest nonblank search case when the schema has no searchable fields", () => {
    const numericSpec: CapabilitySpec = {
      ...(FULL_NOTES_SPEC as CapabilitySpec),
      schema: {
        fields: [
          {
            name: "reading",
            label: "Reading",
            type: "number",
            required: false,
            lifecycle: "active",
          },
        ],
      },
      ui_intent: {
        form: { list_inputs: [] },
        item: { direction: "Show the reading.", shows: ["reading"] },
        collection: { layout: "feed" },
        detail: { shows: ["reading", "created_at"] },
      },
      behavioral_errors: [],
    };
    const suite = fullBehavioralSuiteFor(numericSpec, {
      createValues: { reading: 1 },
      updateValues: { reading: 2 },
      readValues: { reading: 3 },
      searchMatchValues: { reading: 4 },
      searchOlderMatchValues: { reading: 5 },
      searchMissValues: { reading: 6 },
      markerField: "reading",
      searchQuery: "anything",
    });
    const noTextSearchSuite = {
      cases: suite.cases.map((testCase) =>
        testCase.action === "search"
          ? {
              ...testCase,
              expectFragmentIncludes: [],
              expectFragmentExcludes: [],
              expectFragmentIncludesInOrder: [],
            }
          : testCase,
      ),
    };

    expect(() => assertFullSuiteContract(numericSpec, noTextSearchSuite)).not.toThrow();
    const prompt = buildBehavioralTestPrompt(numericSpec);
    expect(prompt).toContain("has no active string/string[] fields");
    expect(prompt).toContain("behavioral ordering is honestly inapplicable");
    expect(prompt).not.toContain("must seed at least two matching rows");
  });
});

describe("capability gate — five-Action behavioral contract", () => {
  test("reports every Action plus authored and platform-stable errors independently", async () => {
    const result = await runCapabilityGate(fullInput());
    expect(result.behavioral.status).toBe("passed");
    if (result.behavioral.tier !== "on") throw new Error("behavioral tier unexpectedly off");
    expect(result.behavioral.testRun.cases.map((testCase) => testCase.action)).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
      "create",
      "update",
      "update",
      "delete",
    ]);
  });

  test("rejects missing Action coverage, false error triggers, and error-case product copy", async () => {
    const missingSearch = {
      cases: FULL_BEHAVIORAL_SUITE.cases.filter((testCase) => testCase.action !== "search"),
    };
    const missing = await expectGateFailure(fullInput(missingSearch));
    expect(missing.failedRung).toBe("behavioral");
    expect(missing.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      "normal search case",
    );

    const productCopy = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.expectedError
          ? { ...testCase, expectFragmentIncludes: ["friendly generated wording"] }
          : testCase,
      ),
    };
    const wording = await expectGateFailure(fullInput(productCopy));
    expect(wording.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      "never product wording",
    );

    const falseErrorTrigger = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.expectedError
          ? { ...testCase, input: [{ field: "text", value: "Definitely present" }] }
          : testCase,
      ),
    };
    const falseTrigger = await expectGateFailure(fullInput(falseErrorTrigger));
    expect(falseTrigger.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      "may not submit non-empty",
    );

    const malformedReadInput = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "read"
          ? { ...testCase, input: [{ field: "text", value: "copy" }] }
          : testCase,
      ),
    };
    const malformedRead = await expectGateFailure(fullInput(malformedReadInput));
    expect(
      malformedRead.outcomes.find((outcome) => outcome.rung === "behavioral")?.error,
    ).toContain('input references unknown spec field "text"');

    const normalProductCopy = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "read" && !testCase.expectedError
          ? { ...testCase, expectFragmentIncludes: ["Welcome, friend!"] }
          : testCase,
      ),
    };
    const normalWording = await expectGateFailure(fullInput(normalProductCopy));
    expect(
      normalWording.outcomes.find((outcome) => outcome.rung === "behavioral")?.error,
    ).toContain("never product wording");
  });
});

describe("capability gate — search behavioral contract", () => {
  test("accepts ordered rows that match every q term through platform normalization", async () => {
    const normalizedSearch = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "search" && !testCase.expectedError
          ? {
              ...testCase,
              setupRows: [
                { values: [{ field: "text", value: "CAFÉ newest tasting" }] },
                { values: [{ field: "text", value: "Cafe\u0301 older tasting" }] },
                { values: [{ field: "text", value: "Other entry" }] },
              ],
              input: [{ field: "q", value: "cafe tasting" }],
              expectedRows: [
                { values: [{ field: "text", value: "CAFÉ newest tasting" }] },
                { values: [{ field: "text", value: "Cafe\u0301 older tasting" }] },
                { values: [{ field: "text", value: "Other entry" }] },
              ],
              expectFragmentIncludes: ["CAFÉ newest tasting", "Cafe\u0301 older tasting"],
              expectFragmentIncludesInOrder: ["CAFÉ newest tasting", "Cafe\u0301 older tasting"],
              expectFragmentExcludes: ["Other entry"],
            }
          : testCase,
      ),
    };

    const result = await runCapabilityGate(fullInput(normalizedSearch));

    expect(result.behavioral.status).toBe("passed");
  });
});

describe("capability gate — search behavioral fixture validation", () => {
  test("rejects ordered evidence from a setup row that does not mechanically match q", async () => {
    const nonmatchingOrderedRow = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "search" && !testCase.expectedError
          ? {
              ...testCase,
              setupRows: testCase.setupRows.map((row, index) =>
                index === 1 ? { values: [{ field: "text", value: "Unrelated ordered row" }] } : row,
              ),
              expectFragmentIncludes: ["Matching note newest", "Unrelated ordered row"],
              expectFragmentIncludesInOrder: ["Matching note newest", "Unrelated ordered row"],
            }
          : testCase,
      ),
    };

    const error = await expectGateFailure(fullInput(nonmatchingOrderedRow));

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      'ordered setup row identified by "Unrelated ordered row" does not mechanically match q',
    );
  });

  test("rejects a generated exclusion row that mechanically matches its own search query", async () => {
    const selfMatchingNonmatch = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "search" && !testCase.expectedError
          ? {
              ...testCase,
              input: [{ field: "q", value: "search" }],
              setupRows: testCase.setupRows.map((row, index) =>
                index === 2
                  ? { values: [{ field: "text", value: "Search Nonmatch Marker" }] }
                  : {
                      values: row.values.map((entry) => ({
                        ...entry,
                        value:
                          entry.field === "text" ? `Search ${String(entry.value)}` : entry.value,
                      })),
                    },
              ),
              expectFragmentIncludes: ["Search Matching note newest", "Search Matching note older"],
              expectFragmentIncludesInOrder: [
                "Search Matching note newest",
                "Search Matching note older",
              ],
              expectFragmentExcludes: ["Search Nonmatch Marker"],
            }
          : testCase,
      ),
    };

    const error = await expectGateFailure(fullInput(selfMatchingNonmatch));

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      'excluded setup row identified by "Search Nonmatch Marker" mechanically matches q',
    );
  });
});

describe("capability gate — search behavioral execution", () => {
  test("fails a search Handler that renders seeded non-matches", async () => {
    const rendersEveryRow = [
      "export default async function search({ query, present }: CapabilityContext): Promise<string> {",
      "  return query.records({",
      '    sql: \'SELECT "id" AS "target_id" FROM "cap_notes" ORDER BY "created_at" DESC, "id" DESC\',',
      '  }).map(({ record }) => present(record)).join("");',
      "}",
    ].join("\n");
    await expect(
      runFullBehavioralRung(fullInput(FULL_BEHAVIORAL_SUITE, { search: rendersEveryRow })),
    ).rejects.toThrow("unexpectedly included Other entry");
  });

  test("fails id-only nonblank ordering when behavior requires newest-first matches", async () => {
    const idOnlyNonblankSearch = FULL_SEARCH_HANDLER.replace(
      'ORDER BY "target"."created_at" DESC, "target"."id" DESC',
      'ORDER BY "target"."id" DESC',
    );

    const error = await expectGateFailure(
      fullInput(FULL_BEHAVIORAL_SUITE, { search: idOnlyNonblankSearch }),
    );

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      'include "Matching note older" in order',
    );
  });

  test("tier-off explicitly skips primary search-order semantics", async () => {
    const idOnlyNonblankSearch = FULL_SEARCH_HANDLER.replace(
      'ORDER BY "target"."created_at" DESC, "target"."id" DESC',
      'ORDER BY "target"."id" DESC',
    );

    const result = await runCapabilityGate({
      ...fullInput(FULL_BEHAVIORAL_SUITE, { search: idOnlyNonblankSearch }),
      provider: undefined,
      behavioralTier: { enabled: false },
    });

    expect(result.outcomes).toContainEqual(
      expect.objectContaining({ rung: "behavioral", status: "skipped" }),
    );
  });

  test("rejects a normal search case with vacuous ordering coverage", async () => {
    const vacuousSearchOrder = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "search" && !testCase.expectedError
          ? { ...testCase, expectFragmentIncludesInOrder: [] }
          : testCase,
      ),
    };

    const error = await expectGateFailure(fullInput(vacuousSearchOrder));

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      "normal search case must prove ordering with at least two",
    );
  });

  test("rejects a search-order case that exercises only blank-query canonical read", async () => {
    const blankQueryOrder = {
      cases: FULL_BEHAVIORAL_SUITE.cases.map((testCase) =>
        testCase.action === "search" && !testCase.expectedError
          ? { ...testCase, input: [{ field: "q", value: "   " }] }
          : testCase,
      ),
    };

    const error = await expectGateFailure(fullInput(blankQueryOrder));

    expect(error.failedRung).toBe("behavioral");
    expect(error.outcomes.find((outcome) => outcome.rung === "behavioral")?.error).toContain(
      "one nonblank q",
    );
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
