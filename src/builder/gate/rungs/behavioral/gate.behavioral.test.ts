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
} from "../../../../app/app.test-support.ts";
import {
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../../registry/index.ts";
import { deriveCapabilityTableDdl } from "../../../../runtime/data/index.ts";
import {
  expectGateFailure,
  type FullBehavioralTestSuite,
  fullBehavioralSuiteFor,
  gateInput,
  makeBehaviorProvider,
  notesSpec,
} from "../../gate.test-support.ts";
import { buildBehavioralTestPrompt, runCapabilityGate } from "../../gate.ts";
import { freezeBehavioralTests } from "./freeze/behavioral-test-freeze.ts";
import { actionFixtureVocabulary, actionTestInputs } from "./freeze/behavioral-test-inputs.ts";
import { runFullBehavioralRung } from "./generation/gate-behavioral-full.ts";
import { assertActionSuiteContract } from "./generation/gate-behavioral-full-contract.ts";

setDefaultTimeout(15_000);

function fullInput(
  suite: FullBehavioralTestSuite = FULL_BEHAVIORAL_SUITE as FullBehavioralTestSuite,
  handlerOverrides: Partial<Record<"search", string>> = {},
) {
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
        search: handlerOverrides.search ?? FULL_SEARCH_HANDLER,
      },
    },
    suite,
  );
}

describe("capability gate — behavioral test generation", () => {
  test("each Action's prompt carries exactly the closed input set, and nothing else", () => {
    const spec = notesSpec({
      schema: {
        fields: [
          { name: "text", label: "Note Body", type: "string", required: true, lifecycle: "active" },
          {
            name: "pinned",
            label: "Pinned?",
            type: "boolean",
            required: false,
            lifecycle: "active",
          },
          {
            name: "retired_secret",
            label: "Retired",
            type: "string",
            required: false,
            lifecycle: "inactive",
          },
        ],
      },
    });
    const createPrompt = buildBehavioralTestPrompt(
      actionTestInputs(spec, "create"),
      actionFixtureVocabulary(spec),
    );

    expect(createPrompt).toContain("Action under test: create");
    expect(createPrompt).toContain("Include at least one normal create case.");
    expect(createPrompt).not.toContain("export default async function");

    // The prompt builder takes `ActionTestInputs` and never the spec, so the closed set is
    // enforced by what is reachable, not by prompt discipline. Pin the payload exactly.
    const sourceStart = createPrompt.indexOf("{\n");
    const sourceEnd = createPrompt.indexOf("\n\nSynthetic row vocabulary");
    const source = JSON.parse(createPrompt.slice(sourceStart, sourceEnd)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(source).sort()).toEqual([
      "action",
      "behavior",
      "behavioral_errors",
      "read_dependencies",
      "schema",
    ]);
    expect(source.behavior).toBe("Text is required. Newest notes appear first.");
    expect(source.schema).toEqual([
      { name: "pinned", required: false, type: "boolean" },
      { name: "text", required: true, type: "string" },
    ]);
    expect(JSON.stringify(source)).toContain(MISSING_REQUIRED_FIELDS_ERROR_CODE);
    // No label, no inactive field, no field-order signal anywhere in the payload.
    expect(createPrompt).not.toContain("Note Body");
    expect(createPrompt).not.toContain("Pinned?");
    expect(createPrompt).not.toContain("retired_secret");

    for (const action of ["read", "delete"] as const) {
      const prompt = buildBehavioralTestPrompt(
        actionTestInputs(spec, action),
        actionFixtureVocabulary(spec),
      );
      expect(prompt).toContain('"row_fields"');
      expect(prompt).toContain('"name": "text"');
      expect(prompt).toContain('"name": "pinned"');
      expect(prompt).not.toContain("retired_secret");
    }
  });

  test("the generation schema is one Action's cases, in an OpenAI-compatible shape", async () => {
    const { provider, prompts } = makeBehaviorProvider();
    const result = await runCapabilityGate(gateInput({ provider }));

    // The Gate authors nothing: no prompt is issued for the behavioral rung at all.
    expect(result.behavioral.status).toBe("passed");
    expect(prompts).toHaveLength(0);

    const spy = makeBehaviorProvider();
    await freezeBehavioralTests({ provider: spy.provider, spec: notesSpec() });

    expect(spy.prompts).toHaveLength(5);
    expect(spy.prompts.map((prompt) => /Action under test: (\w+)/.exec(prompt)?.[1])).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
    ]);
    expect(JSON.stringify(spy.jsonSchemas[0])).not.toContain("propertyNames");
    const schema = spy.jsonSchemas[0] as {
      properties?: {
        cases?: { items?: { properties?: Record<string, unknown>; required?: string[] } };
      };
    };
    const caseSchema = schema.properties?.cases?.items;
    expect(caseSchema?.required).toContain("expectedError");
    expect(caseSchema?.required?.sort()).toEqual(Object.keys(caseSchema?.properties ?? {}).sort());
    expect(JSON.stringify(caseSchema?.properties?.expectedError)).toContain("null");
  });

  test("requires non-vacuous ordered search evidence from generated suites", () => {
    const spec = notesSpec();
    const prompt = buildBehavioralTestPrompt(
      actionTestInputs(spec, "search"),
      actionFixtureVocabulary(spec),
    );

    expect(prompt).toContain("normal search case must seed at least two matching rows");
    expect(prompt).toContain(
      "`expectFragmentIncludesInOrder` must list one unique synthetic marker from each matching row",
    );
    expect(prompt).not.toContain("should exclude at least one seeded non-match");
    expect(prompt).not.toContain("add a seeded non-match");
    const createPrompt = buildBehavioralTestPrompt(
      actionTestInputs(spec, "create"),
      actionFixtureVocabulary(spec),
    );
    expect(createPrompt).toContain("Leave `expectFragmentIncludesInOrder` empty");
    expect(createPrompt).toContain(
      "values from `expectedRows` only when it holds exactly one affected mutated row",
    );
  });
});

describe("capability gate — behavioral read coverage", () => {
  test("steers normal read coverage away from platform-owned empty mechanics", () => {
    const spec = notesSpec();
    const prompt = buildBehavioralTestPrompt(
      actionTestInputs(spec, "read"),
      actionFixtureVocabulary(spec),
    );

    expect(prompt).toContain("The normal read case must seed at least one row");
    expect(prompt).toContain("Do not use an empty collection as the normal read case");
    expect(prompt).toContain("always-on smoke");
  });
});

describe("capability gate — behavioral search coverage", () => {
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
        form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
        item: { direction: "Show the reading.", shows: ["reading"] },
        collection: { layout: "feed" },
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
    const noTextSearchCases = suite.cases
      .filter((testCase) => testCase.action === "search")
      .map((testCase) => ({
        ...testCase,
        expectFragmentIncludes: [],
        expectFragmentExcludes: [],
        expectFragmentIncludesInOrder: [],
      }));

    expect(() => assertActionSuiteContract(numericSpec, "search", noTextSearchCases)).not.toThrow();
    const prompt = buildBehavioralTestPrompt(
      actionTestInputs(numericSpec, "search"),
      actionFixtureVocabulary(numericSpec),
    );
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
    // Cases execute grouped by the Action that owns them, because each Action's suite is
    // generated and frozen independently.
    expect(result.behavioral.testRun.cases.map((testCase) => testCase.action)).toEqual([
      "create",
      "create",
      "read",
      "update",
      "update",
      "update",
      "delete",
      "delete",
      "search",
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
