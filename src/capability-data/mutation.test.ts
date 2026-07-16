import type { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
} from "../registry/index.ts";
import {
  applyCapabilityTableDdl,
  createCapabilityDeleteMutationPort,
  createCapabilityUpdateMutationPort,
  MissingRequiredFieldsError,
  materializeCapabilityActionRecord,
  RECORD_NOT_FOUND_ERROR_CODE,
  RecordNotFoundError,
} from "./index.ts";
import { withFileDatabase } from "./tool.test-support.ts";

function mutationSpec(): CapabilitySpec {
  const requiredError: Omit<CapabilitySpec["behavioral_errors"][number], "action"> = {
    trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
    fields: ["title"],
    expected_markers: BEHAVIORAL_ERROR_MARKERS,
  };
  return {
    id: "notes",
    label: "Notes",
    schema: {
      fields: [
        { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
        { name: "note", label: "Note", type: "string", required: false, lifecycle: "active" },
        { name: "pinned", label: "Pinned", type: "boolean", required: false, lifecycle: "active" },
        { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
        {
          name: "retired_note",
          label: "Retired note",
          type: "string",
          required: true,
          lifecycle: "inactive",
        },
      ],
    },
    ui_intent: {
      form: { list_inputs: [{ field: "tags", mode: "comma_separated" }] },
      item: { direction: "A text-forward note.", shows: ["title", "tags"] },
      collection: { layout: "feed" },
      detail: { shows: ["title", "note", "pinned", "tags"] },
    },
    behavior: "A title is required.",
    behavioral_errors: [
      { action: "create", ...requiredError },
      { action: "update", ...requiredError },
    ],
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores notes.",
  };
}

function seedRecord(
  database: Database,
  id: string,
  overrides: Partial<{
    title: string | null;
    note: string | null;
    pinned: number | null;
    tags: string | null;
    retired_note: string | null;
    extra: string;
  }> = {},
): void {
  const values = {
    title: "Original title",
    note: "Original note",
    pinned: 1,
    tags: '["one","two"]',
    retired_note: "hidden value",
    extra: '{"source":"fixture"}',
    ...overrides,
  };
  database.run(
    'INSERT INTO "cap_notes" ("id", "title", "note", "pinned", "tags", "retired_note", "extra") VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, values.title, values.note, values.pinned, values.tags, values.retired_note, values.extra],
  );
}

describe("target-bound capability update preservation", () => {
  test("partial update preserves omitted active values, inactive data, platform columns, and extra", () => {
    withFileDatabase((databases) => {
      const spec = mutationSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      seedRecord(databases.readwrite, "target");
      seedRecord(databases.readwrite, "other", { title: "Other" });
      const before = databases.readwrite
        .query('SELECT * FROM "cap_notes" WHERE "id" = ?')
        .get("target") as Record<string, unknown>;

      const mutation = createCapabilityUpdateMutationPort(
        spec,
        "target",
        new Set(["note"]),
        databases.readwrite,
      );
      expect(Object.keys(mutation)).toEqual(["update"]);
      expect(mutation.update.length).toBe(1);
      const updated = materializeCapabilityActionRecord(mutation.update({ note: "Changed note" }));

      expect(updated).toMatchObject({
        id: "target",
        title: "Original title",
        note: "Changed note",
        pinned: true,
        tags: ["one", "two"],
      });
      expect(updated).not.toHaveProperty("retired_note");
      expect(updated).not.toHaveProperty("extra");
      const after = databases.readwrite
        .query('SELECT * FROM "cap_notes" WHERE "id" = ?')
        .get("target") as Record<string, unknown>;
      expect(after).toMatchObject({
        id: before.id,
        created_at: before.created_at,
        title: before.title,
        note: "Changed note",
        pinned: before.pinned,
        tags: before.tags,
        retired_note: before.retired_note,
        extra: before.extra,
      });
      expect(
        databases.readwrite.query('SELECT "title" FROM "cap_notes" WHERE "id" = ?').get("other"),
      ).toEqual({ title: "Other" });
    });
  });
});

describe("target-bound capability update clears and validates", () => {
  test("platform, inactive, unknown, and unsubmitted active keys are rejected without a write", () => {
    withFileDatabase((databases) => {
      const spec = mutationSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      seedRecord(databases.readwrite, "target");
      const mutation = createCapabilityUpdateMutationPort(
        spec,
        "target",
        new Set(["note"]),
        databases.readwrite,
      );
      const before = databases.readwrite
        .query('SELECT * FROM "cap_notes" WHERE "id" = ?')
        .get("target");

      for (const values of [
        { id: "other" },
        { created_at: "later" },
        { extra: {} },
        { retired_note: "visible" },
        { unknown: "value" },
        { title: "Not submitted" },
      ]) {
        expect(() => mutation.update(values)).toThrow();
        expect(
          databases.readwrite.query('SELECT * FROM "cap_notes" WHERE "id" = ?').get("target"),
        ).toEqual(before);
      }
    });
  });
});

describe("target-bound capability mutation failures and delete", () => {
  test("submitted empty values clear by type while omitted active values remain preserved", () => {
    withFileDatabase((databases) => {
      const spec = mutationSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      seedRecord(databases.readwrite, "target");

      const cleared = materializeCapabilityActionRecord(
        createCapabilityUpdateMutationPort(
          spec,
          "target",
          new Set(["note", "pinned", "tags"]),
          databases.readwrite,
        ).update({ note: "" }),
      );
      expect(cleared).toMatchObject({
        title: "Original title",
        note: null,
        pinned: false,
        tags: [],
      });

      expect(
        materializeCapabilityActionRecord(
          createCapabilityUpdateMutationPort(
            spec,
            "target",
            new Set(["note"]),
            databases.readwrite,
          ).update({ note: null }),
        ),
      ).toMatchObject({ note: null });

      expect(() =>
        createCapabilityUpdateMutationPort(
          spec,
          "target",
          new Set(["title"]),
          databases.readwrite,
        ).update({ title: null }),
      ).toThrow(MissingRequiredFieldsError);
      expect(
        databases.readwrite.query('SELECT "title" FROM "cap_notes" WHERE "id" = ?').get("target"),
      ).toEqual({ title: "Original title" });
    });
  });

  test("post-merge requiredness validates the complete resulting active record and writes nothing", () => {
    withFileDatabase((databases) => {
      const spec = mutationSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      seedRecord(databases.readwrite, "historical", { title: null });

      const mutation = createCapabilityUpdateMutationPort(
        spec,
        "historical",
        new Set(["note"]),
        databases.readwrite,
      );
      try {
        mutation.update({ note: "Should roll back" });
        throw new Error("expected update requiredness failure");
      } catch (error) {
        expect(error).toBeInstanceOf(MissingRequiredFieldsError);
        expect(error).toMatchObject({
          action: "update",
          code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
          fields: ["title"],
        });
      }
      expect(
        databases.readwrite
          .query('SELECT "note" FROM "cap_notes" WHERE "id" = ?')
          .get("historical"),
      ).toEqual({ note: "Original note" });
    });
  });

  test("missing update/delete share record_not_found and exact delete cannot substitute its target", () => {
    withFileDatabase((databases) => {
      const spec = mutationSpec();
      applyCapabilityTableDdl(spec, databases.readwrite);
      seedRecord(databases.readwrite, "target");
      seedRecord(databases.readwrite, "survivor");

      for (const [action, run] of [
        [
          "update",
          () =>
            createCapabilityUpdateMutationPort(
              spec,
              "missing",
              new Set(["note"]),
              databases.readwrite,
            ).update({ note: "Nope" }),
        ],
        [
          "delete",
          () => createCapabilityDeleteMutationPort(spec, "missing", databases.readwrite).delete(),
        ],
      ] as const) {
        try {
          run();
          throw new Error("expected record-not-found failure");
        } catch (error) {
          expect(error).toBeInstanceOf(RecordNotFoundError);
          expect(error).toMatchObject({ action, code: RECORD_NOT_FOUND_ERROR_CODE });
        }
      }

      const remove = createCapabilityDeleteMutationPort(spec, "target", databases.readwrite);
      expect(Object.keys(remove)).toEqual(["delete"]);
      expect(remove.delete.length).toBe(0);
      (remove.delete as (...args: string[]) => void)("survivor");
      expect(databases.readwrite.query('SELECT "id" FROM "cap_notes" ORDER BY "id"').all()).toEqual(
        [{ id: "survivor" }],
      );
    });
  });
});
