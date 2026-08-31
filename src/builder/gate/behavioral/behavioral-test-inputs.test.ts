// The closed per-Action test-input projection and its content address.
// These tests are the mechanical statement of what "total inputs"
// means: what is in, what is out, and which spec edits can and cannot move a digest.

import { describe, expect, test } from "bun:test";

import {
  type CapabilitySpec,
  type ChoiceOption,
  FULL_CAPABILITY_TOOLS,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../../../registry/index.ts";
import { diffCapabilitySpec } from "../../evolution/diff-engine.ts";
import { notesSpec } from "../gate.test-support.ts";
import {
  type ActionTestInputs,
  actionFixtureVocabulary,
  actionTestInputDigest,
  actionTestInputs,
  canonicalTestInputJson,
  specActionTestInputs,
} from "./behavioral-test-inputs.ts";

const RICH_SPEC = notesSpec({
  schema: {
    fields: [
      { name: "text", label: "Text", type: "string", required: true, lifecycle: "active" },
      { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
      { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
      { name: "rank", label: "Rank", type: "number", required: false, lifecycle: "active" },
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

function digests(spec: CapabilitySpec): Record<string, string> {
  return Object.fromEntries(
    specActionTestInputs(spec).map((inputs) => [inputs.action, actionTestInputDigest(inputs)]),
  );
}

/** Actions whose total test inputs differ between two specs. */
function movedActions(before: CapabilitySpec, after: CapabilitySpec): readonly string[] {
  const left = digests(before);
  const right = digests(after);
  return FULL_CAPABILITY_TOOLS.filter((action) => left[action] !== right[action]);
}

const CHOICE_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

/** The notes spec with one active choice field, for the admitted-value projection. */
function choiceSpec(
  values: readonly ChoiceOption[],
  groups: readonly { id: string; heading: string }[] = [],
): CapabilitySpec {
  const base = notesSpec();
  return notesSpec({
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "stage",
          label: "Stage",
          type: "choice",
          required: false,
          lifecycle: "active",
          values: [...values],
          groups: [...groups],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: { ...base.ui_intent.form, choice_inputs: [{ field: "stage", presentation: "picker" }] },
    },
  });
}

describe("a choice field's admitted values are create/update validation shape", () => {
  test("the write projection carries the declared values; the search projection does not", () => {
    const inputs = specActionTestInputs(choiceSpec(CHOICE_OPTIONS));
    const create = inputs.find((entry) => entry.action === "create");
    const stage = (create?.schema as readonly { name: string; values?: readonly string[] }[]).find(
      (field) => field.name === "stage",
    );
    expect(stage?.values).toEqual(["draft", "sent"]);

    const search = inputs.find((entry) => entry.action === "search");
    const searchable = (search?.schema as { searchable_fields: readonly { name: string }[] })
      .searchable_fields;
    expect(searchable.map((field) => field.name)).toContain("stage");
    expect(searchable.every((field) => !("values" in field))).toBe(true);
  });

  test("appending an option moves the create and update digests, and only those", () => {
    expect(
      movedActions(
        choiceSpec(CHOICE_OPTIONS),
        choiceSpec([...CHOICE_OPTIONS, { value: "paid", label: "Paid" }]),
      ),
    ).toEqual(["create", "update"]);
  });

  test("the fixture vocabulary carries the admitted values a synthetic row may hold", () => {
    const vocabulary = actionFixtureVocabulary(choiceSpec(CHOICE_OPTIONS));
    const stage = vocabulary.row_fields.find((field) => field.name === "stage");
    expect(stage?.values).toEqual(["draft", "sent"]);
    // Every other field carries none: only a choice constrains what a row may hold.
    expect(vocabulary.row_fields.filter((field) => field.values !== undefined)).toHaveLength(1);
  });

  test("the fixture vocabulary stays out of the digest — it is scratch context", () => {
    expect(
      movedActions(
        choiceSpec(CHOICE_OPTIONS),
        choiceSpec([
          { value: "draft", label: "Renamed" },
          { value: "sent", label: "Sent" },
        ]),
      ),
    ).toEqual([]);
  });

  test("relabelling an option moves no digest — a label is presentation", () => {
    expect(
      movedActions(
        choiceSpec(CHOICE_OPTIONS),
        choiceSpec([
          { value: "draft", label: "Still a draft" },
          { value: "sent", label: "Sent" },
        ]),
      ),
    ).toEqual([]);
  });

  test("retiring an option moves the create and update digests, like appending one", () => {
    expect(
      movedActions(
        choiceSpec(CHOICE_OPTIONS),
        choiceSpec([
          { value: "draft", label: "Draft" },
          { value: "sent", label: "Sent", disabled: true },
        ]),
      ),
    ).toEqual(["create", "update"]);
  });

  test("a retired option leaves the projection and the fixture vocabulary alike", () => {
    const retired = choiceSpec([
      { value: "draft", label: "Draft" },
      { value: "sent", label: "Sent", disabled: true },
    ]);
    const create = specActionTestInputs(retired).find((entry) => entry.action === "create");
    const stage = (create?.schema as readonly { name: string; values?: readonly string[] }[]).find(
      (field) => field.name === "stage",
    );
    // A generated test may only write what a person may choose, or it authors a case the
    // platform refuses.
    expect(stage?.values).toEqual(["draft"]);
    expect(
      actionFixtureVocabulary(retired).row_fields.find((field) => field.name === "stage")?.values,
    ).toEqual(["draft"]);
  });

  test("appending an already-retired option moves the digest too", () => {
    // Nothing new can be written, but what a submission *earns* changed: that value now
    // earns `choice_disabled` where it earned `invalid_choice` before. Validation shape
    // moved, so a prior suite may not be carried forward on the strength of the digest.
    expect(
      movedActions(
        choiceSpec(CHOICE_OPTIONS),
        choiceSpec([...CHOICE_OPTIONS, { value: "paid", label: "Paid", disabled: true }]),
      ),
    ).toEqual(["create", "update"]);
  });

  test("a field that has retired nothing digests exactly as it always did", () => {
    const create = specActionTestInputs(choiceSpec(CHOICE_OPTIONS)).find(
      (entry) => entry.action === "create",
    );
    const stage = (create?.schema as readonly { name: string }[]).find(
      (field) => field.name === "stage",
    );
    expect(Object.keys(stage ?? {}).sort()).toEqual(["name", "required", "type", "values"]);
  });

  test("reordering, noting and grouping the options move no digest at all", () => {
    const committed = choiceSpec(CHOICE_OPTIONS);
    expect(
      movedActions(
        committed,
        choiceSpec([
          { value: "sent", label: "Sent" },
          { value: "draft", label: "Draft" },
        ]),
      ),
    ).toEqual([]);
    expect(
      movedActions(
        committed,
        choiceSpec([
          { value: "draft", label: "Draft", note: "not sent yet" },
          { value: "sent", label: "Sent" },
        ]),
      ),
    ).toEqual([]);
    expect(
      movedActions(
        committed,
        choiceSpec(
          [
            { value: "draft", label: "Draft", group: "open" },
            { value: "sent", label: "Sent", group: "open" },
          ],
          [{ id: "open", heading: "Open" }],
        ),
      ),
    ).toEqual([]);
  });
});

describe("per-Action behavioral test inputs — the closed set", () => {
  test("projects exactly the five keys decision 23 admits, and no others", () => {
    for (const inputs of specActionTestInputs(RICH_SPEC)) {
      expect(Object.keys(inputs).sort()).toEqual([
        "action",
        "behavior",
        "behavioral_errors",
        "read_dependencies",
        "schema",
      ]);
    }
  });

  test("create and update see active name/type/required, sorted and label-free", () => {
    for (const action of ["create", "update"] as const) {
      expect(actionTestInputs(RICH_SPEC, action).schema).toEqual([
        { name: "pinned", required: false, type: "boolean" },
        { name: "rank", required: false, type: "number" },
        { name: "tags", required: false, type: "string[]" },
        { name: "text", required: true, type: "string" },
      ]);
    }
  });

  test("search sees only the q input and the active text-shaped fields", () => {
    expect(actionTestInputs(RICH_SPEC, "search").schema).toEqual({
      input: { name: "q", type: "string" },
      searchable_fields: [
        { name: "tags", type: "string[]" },
        { name: "text", type: "string" },
      ],
    });
  });

  test("read and delete project no schema at all — smoke owns their mechanics", () => {
    expect(actionTestInputs(RICH_SPEC, "read").schema).toEqual([]);
    expect(actionTestInputs(RICH_SPEC, "delete").schema).toEqual([]);
  });

  test("behavior is an input to every Action; errors and dependencies are Action-scoped", () => {
    const withDependency = notesSpec({
      read_dependencies: {
        ...RICH_SPEC.read_dependencies,
        read: [
          { capability_id: "shelves", incarnation_id: "22222222-2222-4222-8222-222222222222" },
        ],
      },
    });

    for (const inputs of specActionTestInputs(withDependency)) {
      expect(inputs.behavior).toBe(withDependency.behavior);
      for (const errorCase of inputs.behavioral_errors)
        expect(errorCase.action).toBe(inputs.action);
    }
    expect(actionTestInputs(withDependency, "read").read_dependencies).toEqual([
      { capability_id: "shelves", incarnation_id: "22222222-2222-4222-8222-222222222222" },
    ]);
    expect(actionTestInputs(withDependency, "create").read_dependencies).toEqual([]);
    expect(actionTestInputs(withDependency, "create").behavioral_errors[0]?.code).toBe(
      MISSING_REQUIRED_FIELDS_ERROR_CODE,
    );
  });

  test("no presentational or inactive material reaches the serialized inputs", () => {
    const serialized = specActionTestInputs(RICH_SPEC)
      .map((inputs) => canonicalTestInputJson(inputs))
      .join("\n");

    expect(serialized).not.toContain("retired_secret");
    expect(serialized).not.toContain("label");
    expect(serialized).not.toContain("ui_intent");
    expect(serialized).not.toContain("prompt_context");
    expect(serialized).not.toContain("list_inputs");
  });

  test("serialization is key-order independent", () => {
    const inputs = actionTestInputs(RICH_SPEC, "create");
    const shuffled = {
      read_dependencies: inputs.read_dependencies,
      schema: inputs.schema,
      action: inputs.action,
      behavioral_errors: inputs.behavioral_errors,
      behavior: inputs.behavior,
    } satisfies ActionTestInputs;

    expect(actionTestInputDigest(shuffled)).toBe(actionTestInputDigest(inputs));
  });
});

describe("per-Action behavioral test inputs — digest equality", () => {
  test("a label-only change moves no digest", () => {
    const relabelled: CapabilitySpec = {
      ...RICH_SPEC,
      label: "Jottings",
      noun: "note",
      schema: {
        fields: RICH_SPEC.schema.fields.map((field) => ({
          ...field,
          label: `${field.label} (renamed)`,
        })),
      },
    };

    expect(movedActions(RICH_SPEC, relabelled)).toEqual([]);
    expect(diffCapabilitySpec(RICH_SPEC, relabelled).workPlan.gate.behavioral).toEqual({
      actions: [],
      fullSuite: false,
    });
  });

  test("a field-order-only change moves no digest", () => {
    const reordered: CapabilitySpec = {
      ...RICH_SPEC,
      schema: { fields: [...RICH_SPEC.schema.fields].reverse() },
    };

    expect(movedActions(RICH_SPEC, reordered)).toEqual([]);
    expect(diffCapabilitySpec(RICH_SPEC, reordered).workPlan.gate.behavioral).toEqual({
      actions: [],
      fullSuite: false,
    });
  });

  test("a required change moves exactly create and update", () => {
    const required: CapabilitySpec = {
      ...RICH_SPEC,
      schema: {
        fields: RICH_SPEC.schema.fields.map((field) =>
          field.name === "rank" ? { ...field, required: true } : field,
        ),
      },
    };

    expect(movedActions(RICH_SPEC, required)).toEqual(["create", "update"]);
  });

  test("a new active text field moves create, update, and search", () => {
    const extended: CapabilitySpec = {
      ...RICH_SPEC,
      schema: {
        fields: [
          ...RICH_SPEC.schema.fields,
          {
            name: "summary",
            label: "Summary",
            type: "string",
            required: false,
            lifecycle: "active",
          },
        ],
      },
    };

    expect(movedActions(RICH_SPEC, extended)).toEqual(["create", "update", "search"]);
  });

  test("a new active non-text field leaves search alone", () => {
    const extended: CapabilitySpec = {
      ...RICH_SPEC,
      schema: {
        fields: [
          ...RICH_SPEC.schema.fields,
          { name: "score", label: "Score", type: "number", required: false, lifecycle: "active" },
        ],
      },
    };

    expect(movedActions(RICH_SPEC, extended)).toEqual(["create", "update"]);
  });

  test("a free-text behavior change moves every Action's digest", () => {
    const rebehaved: CapabilitySpec = { ...RICH_SPEC, behavior: "Oldest notes appear first." };

    expect(movedActions(RICH_SPEC, rebehaved)).toEqual([...FULL_CAPABILITY_TOOLS]);
    expect(diffCapabilitySpec(RICH_SPEC, rebehaved).workPlan.gate.behavioral.fullSuite).toBe(true);
  });

  test("a dependency identity change moves only the Action that declares it", () => {
    const rebound: CapabilitySpec = {
      ...RICH_SPEC,
      read_dependencies: {
        ...RICH_SPEC.read_dependencies,
        search: [
          { capability_id: "shelves", incarnation_id: "22222222-2222-4222-8222-222222222222" },
        ],
      },
    };

    expect(movedActions(RICH_SPEC, rebound)).toEqual(["search"]);
  });

  test("hiding an active text field moves create, update, and search", () => {
    const hidden: CapabilitySpec = {
      ...RICH_SPEC,
      schema: {
        fields: RICH_SPEC.schema.fields.map((field) =>
          field.name === "tags" ? { ...field, lifecycle: "inactive" as const } : field,
        ),
      },
    };

    expect(movedActions(RICH_SPEC, hidden)).toEqual(["create", "update", "search"]);
  });
});
