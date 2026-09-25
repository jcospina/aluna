// A file field through evolution. Adding one is additive, a nullable TEXT column; a committed one
// moves only through facts the matrix already maps; and `accepts` is gated and put in canonical
// order before the Diff reads it, so no file fact reaches the unmapped fallback.

import { describe, expect, test } from "bun:test";

import { orderings, PHOTO_FIELD } from "../../../registry/fields/file.test-support.ts";
import {
  type CapabilityRow,
  capabilitySpecFromRow,
  FILE_FAMILIES,
} from "../../../registry/index.ts";
import { deriveAdditiveCapabilityMigration } from "../../../runtime/data/index.ts";
import {
  type CandidateDraft,
  factsFor,
  journalCapabilityRow,
  rejection,
  validate,
  workFor,
} from "./choice-evolution.test-support.ts";

function withPhoto(draft: CandidateDraft, photo: Record<string, unknown> = {}): void {
  draft.schema.fields.push({
    ...PHOTO_FIELD,
    ...photo,
  } as CandidateDraft["schema"]["fields"][number]);
}

/** The journal with a committed file field. */
function journalWithPhoto(lifecycle: "active" | "inactive" = "active"): CapabilityRow {
  const base = journalCapabilityRow();
  return journalCapabilityRow({
    schema: { fields: [...base.schema.fields, { ...PHOTO_FIELD, lifecycle }] },
  });
}

function photoOf(draft: CandidateDraft) {
  const field = draft.schema.fields.find((candidate) => candidate.name === "photo");
  if (!field) throw new Error("the committed file field is missing from the draft");
  return field;
}

describe("adding a file field", () => {
  test("is one additive new-field fact that selects the writes and every reader of records", () => {
    const diff = workFor(journalCapabilityRow(), (draft) => withPhoto(draft));

    expect(diff.facts).toEqual([{ kind: "new_active_field", field: "photo", fieldType: "file" }]);
    expect(diff.workPlan.platformWork).toEqual(["add_column", "platform_form_detail"]);
    // Every Handler holding `query` receives records that can now carry a file: its contract moved.
    expect(diff.workPlan.regeneratedUnits).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
    ]);
    expect(diff.workPlan.gate.behavioral.actions).toEqual([
      "create",
      "read",
      "update",
      "delete",
      "search",
    ]);
  });

  test("a second file field moves no reader's contract, so read and search are copied", () => {
    const diff = workFor(journalWithPhoto(), (draft) =>
      withPhoto(draft, { name: "cover", label: "Cover" }),
    );
    expect(diff.workPlan.regeneratedUnits).toEqual(["create", "update"]);
  });

  test("derives one nullable ADD COLUMN", () => {
    const row = journalCapabilityRow();
    const candidate = validate(row, (draft) => withPhoto(draft));
    const migration = deriveAdditiveCapabilityMigration(capabilitySpecFromRow(row), candidate);

    expect(migration.statements).toEqual([
      'ALTER TABLE "cap_journal" ADD COLUMN "photo" TEXT CHECK ("photo" IS NULL OR ' +
        `(json_valid("photo") AND json_type("photo") = 'object'));`,
    ]);
  });
});

describe("a committed file field", () => {
  test("hidden or reactivated as the only one, regenerates the readers of records", () => {
    for (const [lifecycle, next] of [
      ["active", "inactive"],
      ["inactive", "active"],
    ] as const) {
      const diff = workFor(journalWithPhoto(lifecycle), (draft) =>
        Object.assign(photoOf(draft), { lifecycle: next }),
      );
      expect(diff.workPlan.regeneratedUnits).toEqual([
        "create",
        "read",
        "update",
        "delete",
        "search",
      ]);
    }
  });

  test("relabels and hides through facts the matrix maps", () => {
    const row = journalWithPhoto();
    expect(factsFor(row, (draft) => Object.assign(photoOf(draft), { label: "Picture" }))).toEqual([
      "field_label",
    ]);
    expect(
      factsFor(row, (draft) => Object.assign(photoOf(draft), { lifecycle: "inactive" })),
    ).toEqual(["field_lifecycle"]);
  });

  test("turns required through the fact every field turns required by", () => {
    const facts = factsFor(journalWithPhoto(), (draft) => {
      Object.assign(photoOf(draft), { required: true });
      for (const errorCase of draft.behavioral_errors) errorCase.fields = ["title", "photo"];
    });
    expect(facts).toContain("required_change");
  });

  test("reactivates through the lifecycle fact", () => {
    const row = journalWithPhoto("inactive");
    expect(
      factsFor(row, (draft) => Object.assign(photoOf(draft), { lifecycle: "active" })),
    ).toEqual(["field_lifecycle"]);
  });

  test("returned with its families in any order is no change at all", () => {
    const row = journalWithPhoto();
    for (const authored of orderings(FILE_FAMILIES)) {
      const committed = FILE_FAMILIES.filter((family) => authored.includes(family));
      const committedRow = journalCapabilityRow({
        schema: {
          fields: row.schema.fields.map((field) =>
            field.name === "photo" ? { ...field, accepts: committed } : field,
          ),
        },
      });
      const diff = workFor(committedRow, (draft) => {
        photoOf(draft).accepts = [...authored].reverse();
      });
      expect(diff.isNoop).toBe(true);
    }
  });

  test("keeps its type: returned as any other type it is refused before the Diff", () => {
    const issues = rejection(journalWithPhoto(), (draft) => {
      const photo = photoOf(draft);
      photo.type = "string";
      delete photo.accepts;
    });
    expect(issues.map((issue) => issue.path)).toContain("schema.fields.photo.type");
  });
});

describe("candidate validation holds accepts to its rules", () => {
  test("refuses accepts on a field that is not a file field", () => {
    const issues = rejection(journalCapabilityRow(), (draft) => {
      withPhoto(draft);
      const title = draft.schema.fields[0];
      if (title) title.accepts = ["image"];
    });
    expect(issues).toContainEqual({
      path: "schema.fields.0.accepts",
      message: "only a file field declares accepts",
    });
  });

  test("refuses a file field whose accepts is missing, null, empty, unknown or repeated", () => {
    const at = `schema.fields.${journalCapabilityRow().schema.fields.length}.accepts`;
    for (const accepts of [undefined, null, [], ["video"], ["image", "image"]]) {
      const issues = rejection(journalCapabilityRow(), (draft) => withPhoto(draft, { accepts }));
      expect(issues.some((issue) => issue.path.startsWith(at))).toBe(true);
    }
  });
});
