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
import {
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../registry/index.ts";
import {
  CREATE_HANDLER,
  expectGateFailure,
  fullBehavioralSuiteFor,
  GOOD_HANDLERS,
  gateInput,
  makeBehaviorProvider,
  notesSpec,
} from "../gate.test-support.ts";
import { buildBehavioralTestPrompt, runCapabilityGate } from "../gate.ts";
import { runFullBehavioralRung } from "./gate-behavioral-full.ts";
import { assertFullSuiteContract } from "./gate-behavioral-full-contract.ts";

setDefaultTimeout(15_000);

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
    expect(prompt).toContain("Ordered assertions belong only to read/search");
    expect(prompt).toContain(
      "create/update use submitted input values, or values from `expectedRows` only when it contains exactly one affected mutated row",
    );
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
