// Candidate-spec validation — Module 4.6/01. One test per rejection row of the
// PLAN matrix's invalid-candidate line (field omission, rename-as-replacement,
// duplication, type change, inactive→inactive drift, active→inactive plus
// another change, new-field-born-inactive, tools-set change, malformed Action
// ownership, undeclared dependency pair, id/lifecycle-metadata), plus the valid
// evolutions the contract admits: reactivation with label/required changes,
// additive fields, hides, and list-input-mode presentation changes.

import { describe, expect, test } from "bun:test";

import { promptCapabilitySpecSchema } from "../registry/index.ts";
import {
  type CandidateDraft,
  candidateFrom,
  evolutionDependencyCatalog,
  journalCapabilityRow,
  SHELVES_INCARNATION_ID,
} from "./candidate.test-support.ts";
import {
  CandidateValidationError,
  type CandidateValidationIssue,
  validateCandidateSpec,
} from "./candidate-validation.ts";

function validate(candidate: unknown) {
  return validateCandidateSpec({
    committed: journalCapabilityRow(),
    candidate,
    dependencyCatalog: evolutionDependencyCatalog(),
  });
}

/** Run a candidate expected to fail; return every issue for matcher assertions. */
function rejectionIssues(candidate: unknown): readonly CandidateValidationIssue[] {
  try {
    validate(candidate);
  } catch (error) {
    if (error instanceof CandidateValidationError) return error.issues;
    throw error;
  }
  throw new Error("expected the candidate to be rejected");
}

function expectRejected(candidate: unknown, messagePart: string): void {
  const issues = rejectionIssues(candidate);
  expect(issues.some((issue) => issue.message.includes(messagePart))).toBe(true);
}

describe("valid candidates", () => {
  test("an unchanged candidate round-trips to the Diff stage as the validated canonical value", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const validated = validate(draft);
    expect(validated).toEqual(
      promptCapabilitySpecSchema.parse(candidateFrom(journalCapabilityRow())),
    );
  });

  test("an additive new active field validates", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields.push({
      name: "mood",
      label: "Mood",
      type: "string",
      required: false,
      lifecycle: "active",
    });
    const validated = validate(draft);
    expect(validated.schema.fields.map((field) => field.name)).toContain("mood");
  });

  test("reactivation may combine inactive→active with label and required changes", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const rating = draft.schema.fields.find((field) => field.name === "old_rating");
    if (!rating) throw new Error("fixture is missing old_rating");
    rating.lifecycle = "active";
    rating.label = "Rating";
    rating.required = true;
    // The reactivated field joins the required set, so the exact
    // missing_required_fields pair must widen with it (decision 4).
    for (const errorCase of draft.behavioral_errors) {
      errorCase.fields = ["title", "old_rating"];
    }
    const validated = validate(draft);
    const reactivated = validated.schema.fields.find((field) => field.name === "old_rating");
    expect(reactivated).toEqual({
      name: "old_rating",
      label: "Rating",
      type: "number",
      required: true,
      lifecycle: "active",
    });
  });

  test("hiding an active string[] removes exactly its form list-input entry", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const tags = draft.schema.fields.find((field) => field.name === "tags");
    if (!tags) throw new Error("fixture is missing tags");
    tags.lifecycle = "inactive";
    draft.ui_intent.form.list_inputs = [];
    draft.ui_intent.item.shows = ["title"];
    draft.ui_intent.detail.shows = ["title", "created_at"];
    const validated = validate(draft);
    expect(validated.ui_intent.form.list_inputs).toEqual([]);
  });

  test("a reactivated string[] adds its form list-input entry in schema order", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const oldLabels = draft.schema.fields.find((field) => field.name === "old_labels");
    if (!oldLabels) throw new Error("fixture is missing old_labels");
    oldLabels.lifecycle = "active";
    draft.ui_intent.form.list_inputs = [
      { field: "tags", mode: "comma_separated" },
      { field: "old_labels", mode: "repeatable" },
    ];
    const validated = validate(draft);
    expect(validated.ui_intent.form.list_inputs.map((entry) => entry.field)).toEqual([
      "tags",
      "old_labels",
    ]);
  });

  test("a new active string[] requires its form list-input entry", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields.push({
      name: "aliases",
      label: "Aliases",
      type: "string[]",
      required: false,
      lifecycle: "active",
    });
    expectRejected(
      draft,
      "form list_inputs must contain every active string[] field exactly once in schema-field order",
    );

    draft.ui_intent.form.list_inputs = [
      { field: "tags", mode: "comma_separated" },
      { field: "aliases", mode: "repeatable" },
    ];
    expect(validate(draft).ui_intent.form.list_inputs).toHaveLength(2);
  });

  test("a valid list-input mode change round-trips as a presentation fact", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.ui_intent.form.list_inputs = [{ field: "tags", mode: "repeatable" }];
    const validated = validate(draft);
    expect(validated.ui_intent.form.list_inputs).toEqual([{ field: "tags", mode: "repeatable" }]);
  });

  test("mutable label/required changes on an active field validate", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const tags = draft.schema.fields.find((field) => field.name === "tags");
    if (!tags) throw new Error("fixture is missing tags");
    tags.label = "Topics";
    const validated = validate(draft);
    expect(validated.schema.fields.find((field) => field.name === "tags")?.label).toBe("Topics");
  });

  test("a dependency pair from the frozen catalog validates and is preserved", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.read_dependencies.read = [
      { capability_id: "shelves", incarnation_id: SHELVES_INCARNATION_ID },
    ];
    const validated = validate(draft);
    expect(validated.read_dependencies.read).toEqual([
      { capability_id: "shelves", incarnation_id: SHELVES_INCARNATION_ID },
    ]);
  });
});

describe("the invalid-candidate matrix row", () => {
  test("committed field omission is rejected — never a soft hide", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields = draft.schema.fields.filter((field) => field.name !== "archived_reason");
    expectRejected(draft, 'committed field "archived_reason" must be returned exactly once');
  });

  test("rename-as-replacement is rejected as the committed field's omission", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const title = draft.schema.fields.find((field) => field.name === "title");
    if (!title) throw new Error("fixture is missing title");
    title.name = "heading";
    draft.ui_intent.item.shows = ["heading", "tags"];
    draft.ui_intent.detail.shows = ["heading", "tags", "created_at"];
    for (const errorCase of draft.behavioral_errors) {
      errorCase.fields = ["heading"];
    }
    expectRejected(draft, 'committed field "title" must be returned exactly once');
  });

  test("field duplication is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields.push({
      name: "title",
      label: "Title",
      type: "string",
      required: true,
      lifecycle: "active",
    });
    expectRejected(draft, "field names must be unique");
  });

  test("an existing field's type change is rejected, active or inactive", () => {
    const active = candidateFrom(journalCapabilityRow());
    const title = active.schema.fields.find((field) => field.name === "title");
    if (!title) throw new Error("fixture is missing title");
    title.type = "number";
    expectRejected(active, 'field "title" type is immutable');

    const inactive = candidateFrom(journalCapabilityRow());
    const archived = inactive.schema.fields.find((field) => field.name === "archived_reason");
    if (!archived) throw new Error("fixture is missing archived_reason");
    archived.type = "number";
    expectRejected(inactive, 'field "archived_reason" type is immutable');
  });

  test("inactive→inactive definition drift is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const archived = draft.schema.fields.find((field) => field.name === "archived_reason");
    if (!archived) throw new Error("fixture is missing archived_reason");
    archived.label = "Why archived";
    expectRejected(draft, 'inactive field "archived_reason" must be returned identically');
  });

  test("active→inactive plus another attribute change is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const tags = draft.schema.fields.find((field) => field.name === "tags");
    if (!tags) throw new Error("fixture is missing tags");
    tags.lifecycle = "inactive";
    tags.label = "Old tags";
    draft.ui_intent.form.list_inputs = [];
    draft.ui_intent.item.shows = ["title"];
    draft.ui_intent.detail.shows = ["title", "created_at"];
    expectRejected(draft, 'hiding "tags" may change only its lifecycle');
  });

  test("a newly introduced field born inactive is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields.push({
      name: "mood",
      label: "Mood",
      type: "string",
      required: false,
      lifecycle: "inactive",
    });
    expectRejected(draft, 'new field "mood" must be born active');
  });

  test("five-Action tools-set changes are rejected", () => {
    const dropped = candidateFrom(journalCapabilityRow());
    dropped.tools = ["create", "read", "update", "delete"];
    expect(() => validate(dropped)).toThrow(CandidateValidationError);

    const reordered = candidateFrom(journalCapabilityRow());
    reordered.tools = ["read", "create", "update", "delete", "search"];
    expectRejected(reordered, "must be exactly [create, read, update, delete, search]");
  });

  test("a changed capability id is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.id = "journal_v2";
    expectRejected(draft, 'capability id is immutable; expected "journal"');
  });
});

describe("malformed Action ownership — rejected, never an all-Handler fallback", () => {
  test("an unknown Action owning an error case is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.behavioral_errors.push({
      action: "archive",
      trigger: "too_old",
      code: "too_old",
      fields: ["title"],
      expected_markers: draft.behavioral_errors[0]?.expected_markers ?? {},
    });
    expect(() => validate(draft)).toThrow(CandidateValidationError);
  });

  test("duplicate Action ownership per trigger/code is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    const first = draft.behavioral_errors[0];
    if (!first) throw new Error("fixture is missing behavioral errors");
    draft.behavioral_errors.push(structuredClone(first));
    expectRejected(draft, "behavioral error Action ownership must be unique per trigger/code");
  });

  test("a missing required-field error case for update is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.behavioral_errors = draft.behavioral_errors.filter(
      (errorCase) => errorCase.action !== "update",
    );
    expectRejected(draft, "must contain the exact missing_required_fields cases");
  });

  test("required-field error cases must track the active required set exactly", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields.push({
      name: "priority",
      label: "Priority",
      type: "string",
      required: true,
      lifecycle: "active",
    });
    // The new required field is missing from both cases' field sets.
    expectRejected(draft, "must contain the exact missing_required_fields cases");
  });

  test("an error case referencing an inactive field is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.behavioral_errors.push({
      action: "create",
      trigger: "bad_reason",
      code: "bad_reason",
      fields: ["archived_reason"],
      expected_markers: draft.behavioral_errors[0]?.expected_markers ?? {},
    });
    expectRejected(draft, 'behavioral error field "archived_reason" must be active');
  });

  test("a read_dependencies shape missing an Action key is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    delete (draft.read_dependencies as Record<string, unknown>).search;
    expect(() => validate(draft)).toThrow(CandidateValidationError);
  });

  test("a listed self-dependency is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.read_dependencies.read = [
      { capability_id: "journal", incarnation_id: journalCapabilityRow().incarnation_id },
    ];
    expectRejected(draft, "self-dependency is implicit and must not be listed");
  });
});

describe("the frozen dependency-generation catalog", () => {
  test("an undeclared dependency pair — unknown capability — is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.read_dependencies.read = [
      { capability_id: "ghosts", incarnation_id: SHELVES_INCARNATION_ID },
    ];
    expectRejected(draft, "is not in the frozen dependency-generation catalog");
  });

  test("an undeclared dependency pair — stale incarnation — is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.read_dependencies.read = [
      { capability_id: "shelves", incarnation_id: "44444444-4444-4444-8444-444444444444" },
    ];
    expectRejected(draft, "is not in the frozen dependency-generation catalog");
  });
});

describe("platform-owned lifecycle metadata and non-spec shapes", () => {
  test.each([
    ["incarnation_id", "99999999-9999-4999-8999-999999999999"],
    ["version", 2],
    ["build_id", "build-123"],
    ["artifacts_path", "capabilities/journal/x/v2/"],
    ["snapshot", { files: [] }],
  ])("a candidate carrying %s is rejected", (key, value) => {
    const draft = candidateFrom(journalCapabilityRow());
    draft[key as string] = value;
    expect(() => validate(draft)).toThrow(CandidateValidationError);
  });

  test("a patch/migration/regeneration shape is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.migration = ["ALTER TABLE cap_journal ADD COLUMN mood TEXT"];
    draft.regenerate = ["create", "update"];
    expect(() => validate(draft)).toThrow(CandidateValidationError);
  });
});

describe("reserved names", () => {
  test("a new field with the reserved __aluna_ prefix is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields.push({
      name: "__aluna_flag",
      label: "Flag",
      type: "string",
      required: false,
      lifecycle: "active",
    });
    expect(() => validate(draft)).toThrow(CandidateValidationError);
  });

  test("a new field named after a platform column is rejected", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields.push({
      name: "created_at",
      label: "Created",
      type: "datetime",
      required: false,
      lifecycle: "active",
    });
    expect(() => validate(draft)).toThrow(CandidateValidationError);
  });
});

describe("list-input intent entries", () => {
  function withListInputs(entries: CandidateDraft["ui_intent"]["form"]["list_inputs"]) {
    const draft = candidateFrom(journalCapabilityRow());
    draft.ui_intent.form.list_inputs = entries;
    return draft;
  }

  test("a scalar entry is rejected", () => {
    expectRejected(
      withListInputs([
        { field: "title", mode: "repeatable" },
        { field: "tags", mode: "comma_separated" },
      ]),
      'field "title" must be a list field',
    );
  });

  test("an inactive entry is rejected", () => {
    expectRejected(
      withListInputs([
        { field: "tags", mode: "comma_separated" },
        { field: "old_labels", mode: "repeatable" },
      ]),
      'field "old_labels" must be active',
    );
  });

  test("an unknown-field entry is rejected", () => {
    expectRejected(
      withListInputs([
        { field: "tags", mode: "comma_separated" },
        { field: "phantom", mode: "repeatable" },
      ]),
      'field "phantom" is not in schema.fields',
    );
  });

  test("a duplicate entry is rejected", () => {
    expectRejected(
      withListInputs([
        { field: "tags", mode: "comma_separated" },
        { field: "tags", mode: "comma_separated" },
      ]),
      'field "tags" appears more than once',
    );
  });

  test("a missing entry is rejected", () => {
    expectRejected(
      withListInputs([]),
      "form list_inputs must contain every active string[] field exactly once",
    );
  });

  test("an invented mode is rejected", () => {
    expect(() => validate(withListInputs([{ field: "tags", mode: "chips" }]))).toThrow(
      CandidateValidationError,
    );
  });
});

describe("a legacy narration-like committed label (registry tolerates it)", () => {
  // The row schema admits older narration-like labels that the strict spec
  // schema rejects; every display path canonicalizes them. Evolution must read
  // such a committed capability without throwing — the strict label gate applies
  // only to the candidate the model authors, never to the committed input.
  function evolveWithCommittedLabel(committedLabel: string, candidate: unknown) {
    return validateCandidateSpec({
      committed: journalCapabilityRow({ label: committedLabel }),
      candidate,
      dependencyCatalog: evolutionDependencyCatalog(),
    });
  }

  test("a valid candidate against a narration-labeled capability is accepted, not thrown", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.label = "Journal"; // the candidate refines to a strict name
    const validated = evolveWithCommittedLabel("A place to keep every note", draft);
    expect(validated.label).toBe("Journal");
  });

  test("an invalid candidate against a narration-labeled capability still rejects warmly", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.label = "Journal";
    draft.schema.fields = draft.schema.fields.filter((field) => field.name !== "old_rating");
    expect(() => evolveWithCommittedLabel("I'll track your reading for you", draft)).toThrow(
      CandidateValidationError,
    );
  });
});

describe("rejection ergonomics", () => {
  test("every violation is reported at once with dev-preview paths", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.schema.fields = draft.schema.fields.filter((field) => field.name !== "old_rating");
    const archived = draft.schema.fields.find((field) => field.name === "archived_reason");
    if (!archived) throw new Error("fixture is missing archived_reason");
    archived.required = true;
    draft.read_dependencies.search = [
      { capability_id: "ghosts", incarnation_id: SHELVES_INCARNATION_ID },
    ];
    const issues = rejectionIssues(draft);
    expect(issues.length).toBeGreaterThanOrEqual(3);
    expect(issues.every((issue) => issue.path.length > 0)).toBe(true);
  });

  test("the error carries a diagnostic mirror for the developer preview", () => {
    const draft = candidateFrom(journalCapabilityRow());
    draft.id = "renamed";
    try {
      validate(draft);
      throw new Error("expected rejection");
    } catch (error) {
      if (!(error instanceof CandidateValidationError)) throw error;
      expect(error.diagnostic).toEqual({ issues: error.issues });
      expect(error.name).toBe("CandidateValidationError");
    }
  });
});
