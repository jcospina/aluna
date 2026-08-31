// Evolving a capability that has a choice field. Option values are stored data: they may
// be appended to and relabelled, never removed, renamed or reordered — and each of those
// movements maps to its own row of the change-fact matrix.

import { describe, expect, test } from "bun:test";

import {
  type CapabilityRow,
  type CapabilitySpec,
  capabilitySpecFromRow,
} from "../../registry/index.ts";
import { diffCapabilitySpec } from "../index.ts";
import {
  type CandidateDraft,
  candidateFrom,
  journalCapabilityRow,
} from "./candidate.test-support.ts";
import {
  CandidateValidationError,
  type CandidateValidationIssue,
  validateCandidateSpec,
} from "./candidate-validation.ts";
import { buildDependencyGenerationCatalog } from "./dependency-catalog.ts";

const COMMITTED_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];

/** The journal, plus one committed active choice field and its form intent. */
function journalWithChoice(lifecycle: "active" | "inactive" = "active"): CapabilityRow {
  const base = journalCapabilityRow();
  return journalCapabilityRow({
    schema: {
      fields: [
        ...base.schema.fields,
        {
          name: "stage",
          label: "Stage",
          type: "choice",
          required: false,
          lifecycle,
          values: [...COMMITTED_OPTIONS],
          groups: [],
        },
      ],
    },
    ui_intent: {
      ...base.ui_intent,
      form: {
        ...base.ui_intent.form,
        choice_inputs: lifecycle === "active" ? [{ field: "stage", presentation: "picker" }] : [],
      },
    },
  });
}

function stageOf(draft: CandidateDraft) {
  const field = draft.schema.fields.find((candidate) => candidate.name === "stage");
  if (!field) throw new Error("the committed choice field is missing from the draft");
  return field;
}

function validate(row: CapabilityRow, mutate: (draft: CandidateDraft) => void): CapabilitySpec {
  const draft = candidateFrom(row);
  mutate(draft);
  return validateCandidateSpec({
    committed: row,
    candidate: draft,
    dependencyCatalog: buildDependencyGenerationCatalog([row], row.id),
  });
}

function rejection(
  row: CapabilityRow,
  mutate: (draft: CandidateDraft) => void,
): readonly CandidateValidationIssue[] {
  try {
    validate(row, mutate);
  } catch (error) {
    if (error instanceof CandidateValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected the candidate to be rejected");
}

function factsFor(row: CapabilityRow, mutate: (draft: CandidateDraft) => void): readonly string[] {
  const candidate = validate(row, mutate);
  return diffCapabilitySpec(capabilitySpecFromRow(row), candidate).facts.map((fact) => fact.kind);
}

describe("committed option values are append-only", () => {
  test("appending an option is admitted", () => {
    const candidate = validate(journalWithChoice(), (draft) => {
      stageOf(draft).values?.push({ value: "archived", label: "Archived" });
    });
    expect(candidate.schema.fields.at(-1)?.values?.map((option) => option.value)).toEqual([
      "draft",
      "published",
      "archived",
    ]);
  });

  test("removing a committed value is refused before the Diff", () => {
    const issues = rejection(journalWithChoice(), (draft) => {
      stageOf(draft).values = [{ value: "draft", label: "Draft" }];
    });
    expect(issues.some((issue) => issue.message.includes('"published" is stored data'))).toBe(true);
  });

  test("renaming a committed value is refused", () => {
    const issues = rejection(journalWithChoice(), (draft) => {
      stageOf(draft).values = [
        { value: "draft", label: "Draft" },
        { value: "live", label: "Published" },
      ];
    });
    expect(
      issues.some((issue) => issue.message.includes("never removed, renamed or reordered")),
    ).toBe(true);
  });

  test("reordering committed values is refused", () => {
    const issues = rejection(journalWithChoice(), (draft) => {
      stageOf(draft).values = [
        { value: "published", label: "Published" },
        { value: "draft", label: "Draft" },
      ];
    });
    expect(issues).not.toHaveLength(0);
  });

  test("relabelling an option is admitted; the value it stores does not move", () => {
    const candidate = validate(journalWithChoice(), (draft) => {
      stageOf(draft).values = [
        { value: "draft", label: "Still a draft" },
        { value: "published", label: "Published" },
      ];
    });
    expect(candidate.schema.fields.at(-1)?.values).toEqual([
      { value: "draft", label: "Still a draft" },
      { value: "published", label: "Published" },
    ]);
  });

  test("hiding a choice field may change only its lifecycle, options included", () => {
    const issues = rejection(journalWithChoice(), (draft) => {
      const stage = stageOf(draft);
      stage.lifecycle = "inactive";
      stage.values = [
        { value: "draft", label: "Renamed while hiding" },
        { value: "published", label: "Published" },
      ];
      draft.ui_intent.form.choice_inputs = [];
    });
    expect(issues.some((issue) => issue.message.includes("may change only its lifecycle"))).toBe(
      true,
    );
  });

  test("a hidden choice field keeps its options across the change", () => {
    const candidate = validate(journalWithChoice(), (draft) => {
      stageOf(draft).lifecycle = "inactive";
      draft.ui_intent.form.choice_inputs = [];
    });
    expect(candidate.schema.fields.at(-1)?.values).toEqual(COMMITTED_OPTIONS);
  });
});

describe("the Diff matrix rows a choice adds", () => {
  test("an appended option is a choice_values fact", () => {
    expect(
      factsFor(journalWithChoice(), (draft) => {
        stageOf(draft).values?.push({ value: "archived", label: "Archived" });
      }),
    ).toEqual(["choice_values"]);
  });

  test("a relabelled option is a choice_option_labels fact and nothing more", () => {
    expect(
      factsFor(journalWithChoice(), (draft) => {
        const stage = stageOf(draft);
        stage.values = [
          { value: "draft", label: "Still a draft" },
          { value: "published", label: "Published" },
        ];
      }),
    ).toEqual(["choice_option_labels"]);
  });

  test("appending an option and rewording another selects both facts, not one", () => {
    expect(
      factsFor(journalWithChoice(), (draft) => {
        const stage = stageOf(draft);
        stage.values = [
          { value: "draft", label: "Rough draft" },
          { value: "published", label: "Published" },
          { value: "archived", label: "Archived" },
        ];
      }),
    ).toEqual(["choice_values", "choice_option_labels"]);
  });

  test("an append alone never manufactures a relabel fact", () => {
    expect(
      factsFor(journalWithChoice(), (draft) => {
        stageOf(draft).values?.push({ value: "archived", label: "Archived" });
      }),
    ).toEqual(["choice_values"]);
  });

  test("hiding a choice field selects its form-intent work alongside the list row's", () => {
    const row = journalWithChoice();
    const candidate = validate(row, (draft) => {
      stageOf(draft).lifecycle = "inactive";
      draft.ui_intent.form.choice_inputs = [];
    });
    const diff = diffCapabilitySpec(capabilitySpecFromRow(row), candidate);
    expect([...diff.workPlan.platformWork]).toContain("choice_input_intent");
  });

  test("hiding a non-choice field claims no choice work", () => {
    const row = journalWithChoice();
    const candidate = validate(row, (draft) => {
      const tags = draft.schema.fields.find((field) => field.name === "tags");
      if (tags) tags.lifecycle = "inactive";
      draft.ui_intent.form.list_inputs = [];
      draft.ui_intent.item.shows = ["title"];
    });
    const diff = diffCapabilitySpec(capabilitySpecFromRow(row), candidate);
    expect([...diff.workPlan.platformWork]).not.toContain("choice_input_intent");
  });

  test("an untouched choice field produces no fact at all", () => {
    expect(factsFor(journalWithChoice(), () => {})).toEqual([]);
  });

  test("an appended option selects the writing Handlers and their suites, and no DDL", () => {
    const row = journalWithChoice();
    const candidate = validate(row, (draft) => {
      stageOf(draft).values?.push({ value: "archived", label: "Archived" });
    });
    const diff = diffCapabilitySpec(capabilitySpecFromRow(row), candidate);
    expect(diff.workPlan.platformWork).toEqual(["choice_admitted_values"]);
    expect([...diff.workPlan.regeneratedUnits].sort()).toEqual(["create", "update"]);
    expect([...diff.workPlan.gate.behavioral.actions].sort()).toEqual(["create", "update"]);
  });

  test("a relabelled option is View work only — no unit regenerates", () => {
    const row = journalWithChoice();
    const candidate = validate(row, (draft) => {
      const stage = stageOf(draft);
      stage.values = [
        { value: "draft", label: "Renamed" },
        { value: "published", label: "Published" },
      ];
    });
    const diff = diffCapabilitySpec(capabilitySpecFromRow(row), candidate);
    expect(diff.workPlan.platformWork).toEqual(["choice_option_presentation"]);
    expect(diff.workPlan.regeneratedUnits).toEqual([]);
  });

  test("a new choice field follows the ordinary new text-field impacts", () => {
    const row = journalCapabilityRow();
    const candidate = validate(row, (draft) => {
      draft.schema.fields.push({
        name: "stage",
        label: "Stage",
        type: "choice",
        required: false,
        lifecycle: "active",
        values: [...COMMITTED_OPTIONS],
        groups: [],
      });
      draft.ui_intent.form.choice_inputs = [{ field: "stage", presentation: "picker" }];
    });
    const diff = diffCapabilitySpec(capabilitySpecFromRow(row), candidate);
    expect(diff.facts.map((fact) => fact.kind)).toEqual(["new_active_field"]);
    expect([...diff.workPlan.platformWork].sort()).toEqual(["add_column", "platform_form_detail"]);
    expect([...diff.workPlan.regeneratedUnits].sort()).toEqual(["create", "search", "update"]);
  });
});
