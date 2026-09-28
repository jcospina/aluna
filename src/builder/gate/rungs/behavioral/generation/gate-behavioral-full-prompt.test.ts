// What the behavioral-test generator is told, read without a second copy of the telling. The
// wording is a person's to change; these own the closed input set it reaches, which Actions are
// told the same thing, and which coverage duties follow which inputs.

import { describe, expect, test } from "bun:test";
import {
  addedLines,
  linesOnlyIn,
} from "../../../../../platform/provider/prompt-lines.test-support.ts";
import {
  type CapabilitySpec,
  type CapabilityTool,
  FULL_CAPABILITY_TOOLS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../../../registry/index.ts";
import { RECORD_NOT_FOUND_ERROR_CODE } from "../../../../../runtime/data/index.ts";
import { notesSpec } from "../../../gate.test-support.ts";
import {
  actionFixtureVocabulary,
  actionTestInputs,
  canonicalTestInputJson,
  isSearchSchemaInput,
} from "../freeze/behavioral-test-inputs.ts";
import {
  ACTION_UNDER_TEST_PREFIX,
  buildActionBehavioralTestPrompt,
  missingRecordCaseDuty,
  missingRecordPlatformError,
  normalCaseDuty,
} from "./gate-behavioral-full-prompt.ts";
import {
  actionBehavioralTestSuiteSchema,
  type FullBehavioralTestCase,
} from "./gate-behavioral-full-schema.ts";

const ACTIONS = FULL_CAPABILITY_TOOLS;

function behavioralPrompt(spec: CapabilitySpec, action: CapabilityTool): string {
  return buildActionBehavioralTestPrompt(
    actionTestInputs(spec, action),
    actionFixtureVocabulary(spec),
  );
}

/** What the prompt itself says to `action`, with both payloads out and every Action's name set aside. */
function instructionsFor(spec: CapabilitySpec, action: CapabilityTool): string {
  return behavioralPrompt(spec, action)
    .replace(canonicalTestInputJson(actionTestInputs(spec, action)), "")
    .replace(canonicalTestInputJson(actionFixtureVocabulary(spec)), "")
    .replace(new RegExp(`\\b(${ACTIONS.join("|")})\\b`, "g"), "ACTION");
}

describe("the behavioral-test prompt — its closed input set", () => {
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
    const createInputs = actionTestInputs(spec, "create");
    const createPrompt = buildActionBehavioralTestPrompt(
      createInputs,
      actionFixtureVocabulary(spec),
    );

    expect(createPrompt).toContain(`${ACTION_UNDER_TEST_PREFIX} create`);
    expect(createPrompt).not.toContain("export default async function");

    // The prompt builder takes `ActionTestInputs` and never the spec, so the closed set is
    // enforced by what is reachable, not by prompt discipline. Pin the payload exactly.
    expect(createPrompt).toContain(canonicalTestInputJson(createInputs));
    const source = JSON.parse(canonicalTestInputJson(createInputs)) as Record<string, unknown>;
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
      const prompt = buildActionBehavioralTestPrompt(
        actionTestInputs(spec, action),
        actionFixtureVocabulary(spec),
      );
      expect(prompt).toContain(canonicalTestInputJson(actionFixtureVocabulary(spec)));
      expect(prompt).toContain('"row_fields"');
      expect(prompt).toContain('"name": "text"');
      expect(prompt).toContain('"name": "pinned"');
      expect(prompt).not.toContain("retired_secret");
    }
  });

  test("anything outside the closed input set leaves every Action's prompt byte-identical", () => {
    const spec = notesSpec();
    const relabelled = notesSpec({
      schema: {
        fields: [...spec.schema.fields]
          .reverse()
          .map((field) => ({ ...field, label: `${field.label} again` })),
      },
      ui_intent: {
        ...spec.ui_intent,
        item: { direction: "Another direction entirely.", shows: ["pinned"] },
        collection: { layout: "grid" },
      },
    });
    for (const action of ACTIONS) {
      expect(behavioralPrompt(relabelled, action), action).toBe(behavioralPrompt(spec, action));
    }
  });

  test("the instructions never name a field: renaming one moves only the payloads", () => {
    const spec = notesSpec();
    const renamed = notesSpec({
      schema: {
        fields: spec.schema.fields.map((field) =>
          field.name === "text" ? { ...field, name: "body" } : field,
        ),
      },
      ui_intent: { ...spec.ui_intent, item: { ...spec.ui_intent.item, shows: ["body"] } },
      behavioral_errors: spec.behavioral_errors.map((errorCase) => ({
        ...errorCase,
        fields: ["body"],
      })),
    });
    for (const action of ACTIONS) {
      expect(instructionsFor(renamed, action), action).toBe(instructionsFor(spec, action));
    }
  });
});

describe("the behavioral-test prompt — which Actions are told the same thing", () => {
  // Each group is a set of Actions the suite contract treats alike for some rule — a target, an
  // input shape, a response shape, a coverage duty — so they share an instruction no other gets.
  test.each([
    [["read"]],
    [["delete"]],
    [["search"]],
    [["update"]],
    [["read", "search"]],
    [["read", "delete"]],
    [["update", "delete"]],
    [["create", "update"]],
    [["create", "read", "search"]],
  ] as const)("%p share an instruction no other Action gets", (group) => {
    const all = new Map(ACTIONS.map((action) => [action, instructionsFor(notesSpec(), action)]));
    const inside = group.map((action) => all.get(action) ?? "");
    const outside = ACTIONS.filter((action) => !(group as readonly string[]).includes(action));
    expect(
      linesOnlyIn(
        inside,
        outside.map((action) => all.get(action) ?? ""),
      ),
    ).not.toEqual([]);
  });

  test("only update and delete are offered a target row, and each is offered both targets", () => {
    const targets =
      actionBehavioralTestSuiteSchema.shape.cases.element.shape.target.unwrap().options;
    for (const action of ACTIONS) {
      const offered = action === "update" || action === "delete";
      for (const target of targets) {
        const instructions = instructionsFor(notesSpec(), action);
        expect(instructions.includes(target), `${action} ${target}`).toBe(offered);
      }
    }
  });

  test("only search is told about the query input it alone takes", () => {
    const { schema } = actionTestInputs(notesSpec(), "search");
    if (!isSearchSchemaInput(schema)) throw new Error("search projects the query input shape");
    for (const action of ACTIONS) {
      const told = instructionsFor(notesSpec(), action).includes(`\`${schema.input.name}\``);
      expect(told, action).toBe(action === "search");
    }
  });

  test("read and search are never told about a missing record", () => {
    for (const action of ["read", "search"] as const) {
      expect(instructionsFor(notesSpec(), action)).not.toContain(RECORD_NOT_FOUND_ERROR_CODE);
    }
  });
});

describe("the behavioral-test prompt — coverage follows the inputs", () => {
  const unrequired = notesSpec({
    schema: {
      fields: notesSpec().schema.fields.map((field) => ({ ...field, required: false })),
    },
    behavioral_errors: [],
  });

  test("error cases add a coverage duty to the Actions that own them, and to no other", () => {
    for (const action of ACTIONS) {
      const owns = notesSpec().behavioral_errors.some((errorCase) => errorCase.action === action);
      const moved = instructionsFor(notesSpec(), action) !== instructionsFor(unrequired, action);
      expect(moved, action).toBe(owns);
    }
  });

  test("a missing-required case on update adds more than the same case on create", () => {
    const duty = (action: "create" | "update") =>
      addedLines(instructionsFor(unrequired, action), instructionsFor(notesSpec(), action));
    const create = duty("create");
    const update = duty("update");
    expect(create).not.toEqual([]);
    for (const line of create) expect(update).toContain(line);
    expect(update.length).toBeGreaterThan(create.length);
  });

  test("the update duty follows the missing-required case itself, not any case beside it", () => {
    const inputs = actionTestInputs(notesSpec(), "update");
    const [missing] = inputs.behavioral_errors;
    if (!missing) throw new Error("notes owns a missing-required update case");
    const other = { ...missing, trigger: "a_custom_rule", code: "a_custom_rule" };
    const fixture = actionFixtureVocabulary(notesSpec());
    const told = (errors: readonly (typeof missing)[]) => {
      const owned = { ...inputs, behavioral_errors: errors };
      return buildActionBehavioralTestPrompt(owned, fixture).replace(
        canonicalTestInputJson(owned),
        "",
      );
    };
    expect(addedLines(told([other]), told([other, missing]))).not.toEqual([]);
  });
});

describe("the behavioral-test prompt — the duties every suite owes", () => {
  const spec = notesSpec();

  test("each Action is asked for at least one normal case of its own, and of no other Action", () => {
    for (const action of ACTIONS) {
      for (const named of ACTIONS) {
        expect([
          action,
          named,
          behavioralPrompt(spec, action).includes(normalCaseDuty(named)),
        ]).toEqual([action, named, action === named]);
      }
    }
  });

  test("update and delete each owe one missing-record case, answered with the platform's code", () => {
    for (const action of ACTIONS) {
      const prompt = behavioralPrompt(spec, action);
      for (const owing of ["update", "delete"] as const) {
        const own = action === owing;
        expect([action, owing, prompt.includes(missingRecordCaseDuty(owing))]).toEqual([
          action,
          owing,
          own,
        ]);
        expect([action, owing, prompt.includes(missingRecordPlatformError(owing))]).toEqual([
          action,
          owing,
          own,
        ]);
      }
    }
    expect(missingRecordPlatformError("update")).toContain(RECORD_NOT_FOUND_ERROR_CODE);
  });
});

describe("the behavioral-test prompt — search coverage", () => {
  test("turns on whether any field can be searched at all", () => {
    const base = notesSpec();
    const numeric = notesSpec({
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
      ui_intent: { ...base.ui_intent, item: { ...base.ui_intent.item, shows: ["reading"] } },
      behavioral_errors: [],
    });
    expect(instructionsFor(numeric, "search")).not.toBe(instructionsFor(base, "search"));
  });
});

describe("the behavioral-test prompt — ordered search evidence", () => {
  const ORDER_KEY = "expectFragmentIncludesInOrder" satisfies keyof FullBehavioralTestCase;

  test("is asked of search only when some field can be searched", () => {
    const base = notesSpec();
    const numeric = notesSpec({
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
      ui_intent: { ...base.ui_intent, item: { ...base.ui_intent.item, shows: ["reading"] } },
      behavioral_errors: [],
    });
    const searchable = addedLines(
      instructionsFor(numeric, "search"),
      instructionsFor(base, "search"),
    );
    const unsearchable = addedLines(
      instructionsFor(base, "search"),
      instructionsFor(numeric, "search"),
    );
    expect(searchable.some((line) => line.includes(ORDER_KEY))).toBe(true);
    expect(unsearchable.some((line) => line.includes(ORDER_KEY))).toBe(false);
  });
});
