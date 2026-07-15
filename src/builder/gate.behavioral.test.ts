// Behavioral-rung tests for the always-on gate (Epic 2.5, issue 05).
//
// These bypass the provider and unit-generation loop on purpose: the gate is the
// final verdict over generated strings, and must catch broken units independently.

import { describe, expect, setDefaultTimeout, test } from "bun:test";

import { deriveCapabilityTableDdl } from "../capability-data/index.ts";
import { FIELD_LIFECYCLE_DEMO_SPEC, FIELD_LIFECYCLE_DEMO_UNITS } from "../demo/field-lifecycle.ts";
import { type CapabilitySpec, MISSING_REQUIRED_FIELDS_ERROR_CODE } from "../registry/index.ts";
import {
  CREATE_HANDLER,
  expectGateFailure,
  GOOD_HANDLERS,
  gateInput,
  makeBehaviorProvider,
  notesSpec,
} from "./gate.test-support.ts";
import {
  BEHAVIORAL_TIER_ENV_VAR,
  buildBehavioralTestPrompt,
  resolveBehavioralTierEnabled,
  runCapabilityGate,
} from "./gate.ts";

setDefaultTimeout(15_000);

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
      "For `setupRows` and `expectedCreatedRow`, a string[] field value must be an array of strings, never a scalar string",
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
});

describe("capability gate — behavioral violations", () => {
  test("behavioral rung fails violating handlers and passes conforming handlers", async () => {
    const trimSpec = notesSpec({ behavior: "Text is trimmed before saving." });
    const trimSuite = {
      cases: [
        {
          name: "trims note text before saving",
          setupRows: [],
          input: [
            { field: "text", value: "  Trim me  " },
            { field: "pinned", value: "false" },
          ],
          expectedCreatedRow: [
            { field: "text", value: "Trim me" },
            { field: "pinned", value: false },
          ],
          expectedRowCount: 1,
          expectCreateFragmentIncludes: ["Trim me"],
          expectReadFragmentIncludes: ["Trim me"],
          expectReadFragmentIncludesInOrder: [],
          expectedError: null,
        },
      ],
    };
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
    ]);
    expect(error.outcomes[2]?.error).toContain("trims note text before saving");
    expect(error.outcomes[2]?.error).toContain("did not find a scratch row matching");
    expect(error.diagnostic).toMatchObject({
      failure: expect.stringContaining("did not find a scratch row matching"),
      createInput: {
        values: { text: "  Trim me  ", pinned: "false" },
        submittedFields: expect.any(Set),
      },
      scratchRows: [expect.objectContaining({ text: "  Trim me  " })],
      createFragment: expect.stringContaining("Trim me"),
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
      ...FIELD_LIFECYCLE_DEMO_SPEC,
      read_dependencies: {
        ...FIELD_LIFECYCLE_DEMO_SPEC.read_dependencies,
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
        FIELD_LIFECYCLE_DEMO_UNITS.filter((unit) => unit.kind === "handler").map((unit) => [
          unit.name,
          unit.content,
        ]),
      ),
      read: [
        "export default async function read({ query, present }: CapabilityContext): Promise<string> {",
        "  return query.all({",
        '    sql: \'SELECT target.* FROM "cap_field_lifecycle_demo" AS target CROSS JOIN "cap_behavior_catalog" AS catalog WHERE catalog."text" = ? AND catalog."retired_note" = ? ORDER BY target."created_at" DESC, target."id" DESC\',',
        '    parameters: ["synthetic behavior", "compatible hidden value"],',
        '    result: [{ alias: "id", type: "string" }, { alias: "created_at", type: "datetime" }, { alias: "entry", type: "string" }, { alias: "reflection", type: "string" }, { alias: "tags", type: "string[]" }, { alias: "aliases", type: "string[]" }],',
        '  }).map((row) => present(row)).join("");',
        "}",
      ].join("\n"),
    };
    const itemRenderer = FIELD_LIFECYCLE_DEMO_UNITS.find(
      (unit) => unit.kind === "item-renderer",
    )?.content;
    if (!itemRenderer) throw new Error("reference item renderer missing");
    const suite = {
      cases: [
        {
          name: "declared dependency is present during behavior",
          setupRows: [],
          input: [
            { field: "entry", value: "Behavioral entry" },
            { field: "reflection", value: "Synthetic reflection" },
            { field: "tags", value: "behavior" },
          ],
          expectedCreatedRow: [{ field: "entry", value: "Behavioral entry" }],
          expectedRowCount: 1,
          expectCreateFragmentIncludes: ["Behavioral entry"],
          expectReadFragmentIncludes: ["Behavioral entry"],
          expectReadFragmentIncludesInOrder: [],
          expectedError: null,
        },
      ],
    };

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
    const orderSuite = {
      cases: [
        {
          name: "new note appears before preexisting older note",
          setupRows: [{ values: [{ field: "text", value: "Older note" }] }],
          input: [
            { field: "text", value: "Newest note" },
            { field: "pinned", value: "false" },
          ],
          expectedCreatedRow: [{ field: "text", value: "Newest note" }],
          expectedRowCount: 2,
          expectCreateFragmentIncludes: ["Newest note"],
          expectReadFragmentIncludes: ["Newest note", "Older note"],
          expectReadFragmentIncludesInOrder: ["Newest note", "Older note"],
          expectedError: null,
        },
      ],
    };

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
    const orderSuite = {
      cases: [
        {
          name: "new note, then setup rows in listed (newest-first) order",
          setupRows: [
            { values: [{ field: "text", value: "Middle note" }] },
            { values: [{ field: "text", value: "Oldest note" }] },
          ],
          input: [
            { field: "text", value: "Newest note" },
            { field: "pinned", value: "false" },
          ],
          expectedCreatedRow: [{ field: "text", value: "Newest note" }],
          expectedRowCount: 3,
          expectCreateFragmentIncludes: ["Newest note"],
          expectReadFragmentIncludes: ["Newest note", "Middle note", "Oldest note"],
          expectReadFragmentIncludesInOrder: ["Newest note", "Middle note", "Oldest note"],
          expectedError: null,
        },
      ],
    };

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
  });
});
