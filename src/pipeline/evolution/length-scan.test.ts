// The one evolution check that reads committed data rather than a spec.
//
// Adding or lowering a `max_length` narrows what the platform admits, and a row committed
// under the old bound would become a row that can be read but never saved again — saving
// an unrelated field resubmits the long value and earns the refusal. So the limits a
// candidate declares are put to the physical column before anything is published.

import { describe, expect, test } from "bun:test";
import {
  BEHAVIORAL_ERROR_MARKERS,
  type CapabilitySpec,
  MISSING_REQUIRED_FIELDS_ERROR_CODE,
  type SpecField,
} from "../../registry/index.ts";
import {
  applyCapabilityTableDdl,
  encodeCapabilityFieldForStorage,
} from "../../runtime/data/index.ts";
import { withFileDatabase } from "../../runtime/data/tool.test-support.ts";
import { assertStoredValuesFitMaxLengths, MaxLengthScanError } from "./length-scan.ts";

function notesSpec(fields: readonly SpecField[]): CapabilitySpec {
  const required = fields.filter((field) => field.lifecycle === "active" && field.required);
  return {
    id: "notes",
    label: "Notes",
    subject: "an open notebook",
    ground: "grass_green",
    companion: "coral_orange",
    noun: "note",
    schema: { fields: [...fields] },
    ui_intent: {
      form: { list_inputs: [], choice_inputs: [], long_text: [], guidance: [] },
      item: { direction: "A text-forward card.", shows: ["title"] },
      collection: { layout: "feed" },
    },
    behavior: "Title is required.",
    behavioral_errors:
      required.length === 0
        ? []
        : (["create", "update"] as const).map((action) => ({
            action,
            trigger: MISSING_REQUIRED_FIELDS_ERROR_CODE,
            code: MISSING_REQUIRED_FIELDS_ERROR_CODE,
            fields: required.map((field) => field.name),
            expected_markers: BEHAVIORAL_ERROR_MARKERS,
          })),
    tools: ["create", "read", "update", "delete", "search"],
    read_dependencies: { create: [], read: [], update: [], delete: [], search: [] },
    prompt_context: "Stores the user's text notes.",
  };
}

const TITLE: SpecField = {
  name: "title",
  label: "Title",
  type: "string",
  required: true,
  lifecycle: "active",
};

const HIDDEN: SpecField = {
  name: "archived_note",
  label: "Archived note",
  type: "string",
  required: false,
  lifecycle: "inactive",
};

function withStored(
  values: Readonly<Record<string, string>>,
  run: (committed: CapabilitySpec, database: Parameters<typeof applyCapabilityTableDdl>[1]) => void,
  fields: readonly SpecField[] = [TITLE, HIDDEN],
): void {
  withFileDatabase((databases) => {
    const committed = notesSpec(fields);
    applyCapabilityTableDdl(committed, databases.readwrite);
    const columns = Object.keys(values);
    databases.readwrite
      .query(
        `INSERT INTO "cap_notes" ("id", "created_at", "extra"${columns
          .map((name) => `, "${name}"`)
          .join("")}) VALUES (?, ?, ?${columns.map(() => ", ?").join("")})`,
      )
      .run(
        "record-1",
        "2026-01-01T00:00:00.000Z",
        "{}",
        ...columns.map((name) =>
          encodeCapabilityFieldForStorage(
            fields.find((field) => field.name === name) as SpecField,
            values[name],
          ),
        ),
      );
    run(committed, databases.readonly);
  });
}

/** The same spec with one field's limit changed, as a candidate would declare it. */
function withLimit(spec: CapabilitySpec, field: string, max_length?: number): CapabilitySpec {
  return {
    ...spec,
    schema: {
      fields: spec.schema.fields.map((candidate) =>
        candidate.name === field
          ? { ...candidate, ...(max_length === undefined ? {} : { max_length }) }
          : candidate,
      ),
    },
  };
}

describe("a narrowed limit is put to the committed column", () => {
  test("a stored value the new limit cannot hold refuses the candidate", () => {
    withStored({ title: "x".repeat(100) }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database),
      ).toThrow(MaxLengthScanError);
    });
  });

  test("the refusal names the field, the limit and the longest value that broke it", () => {
    withStored({ title: "x".repeat(100) }, (committed, database) => {
      try {
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database);
        throw new Error("expected the scan to refuse");
      } catch (error) {
        expect(error).toBeInstanceOf(MaxLengthScanError);
        expect((error as MaxLengthScanError).fields).toEqual([
          { field: "title", limit: 64, longest: 100 },
        ]);
      }
    });
  });

  test("a value exactly at the new limit is admitted; one character more is not", () => {
    withStored({ title: "x".repeat(64) }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database),
      ).not.toThrow();
    });
    withStored({ title: "x".repeat(65) }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database),
      ).toThrow(MaxLengthScanError);
    });
  });

  test("a soft-hidden field's values count: hiding never drops a column or clears it", () => {
    withStored({ title: "short", archived_note: "y".repeat(100) }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(
          committed,
          withLimit(committed, "archived_note", 64),
          database,
        ),
      ).toThrow(MaxLengthScanError);
    });
  });

  test("length is measured in code units, so the scan and the refusal agree exactly", () => {
    // 33 astral characters: 33 SQLite characters, 66 UTF-16 code units. A scan reading
    // SQLite's own count would call this 33 and admit a limit the write path then refuses.
    withStored({ title: "😀".repeat(33) }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database),
      ).toThrow(MaxLengthScanError);
    });
  });

  test("a value carrying a NUL cannot hide behind it", () => {
    // SQLite's `length(X)` over text counts characters *up to the first NUL*, so a scan
    // built on it measures this value as 30 and admits any limit at all — then the write
    // path, which counts the whole string, refuses every later edit of the row.
    withStored({ title: `${"y".repeat(30)}\u0000${"z".repeat(500)}` }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database),
      ).toThrow(MaxLengthScanError);
    });
  });

  test("a leading NUL hides the whole value from a character count, and not from this", () => {
    withStored({ title: `\u0000${"z".repeat(500)}` }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database),
      ).toThrow(MaxLengthScanError);
    });
  });

  test("a multi-byte value that fits is still admitted, so bytes never over-refuse", () => {
    // 40 CJK characters: 40 code units, 120 UTF-8 bytes. Measured in bytes alone this
    // would break a limit of 64; the exact count is what decides, and it fits.
    withStored({ title: "字".repeat(40) }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 64), database),
      ).not.toThrow();
    });
  });

  test("a null column strands nothing", () => {
    withStored({ title: "short" }, (committed, database) => {
      expect(() =>
        assertStoredValuesFitMaxLengths(
          committed,
          withLimit(committed, "archived_note", 64),
          database,
        ),
      ).not.toThrow();
    });
  });
});

describe("only the narrowing direction is scanned", () => {
  const committedAt = (limit: number) => withLimit(notesSpec([TITLE, HIDDEN]), "title", limit);

  test("raising a limit needs no scan, because nothing it admitted can now be too long", () => {
    withStored({ title: "x".repeat(100) }, (_spec, database) => {
      const committed = committedAt(128);
      expect(() =>
        assertStoredValuesFitMaxLengths(committed, withLimit(committed, "title", 240), database),
      ).not.toThrow();
    });
  });

  test("removing a limit needs no scan either", () => {
    withStored({ title: "x".repeat(100) }, (_spec, database) => {
      const committed = committedAt(128);
      const unbounded = {
        ...committed,
        schema: {
          fields: committed.schema.fields.map(({ max_length: _drop, ...field }) => field),
        },
      };
      expect(() => assertStoredValuesFitMaxLengths(committed, unbounded, database)).not.toThrow();
    });
  });

  test("an unchanged limit needs no scan, so an unrelated evolution reads no user table", () => {
    withStored({ title: "x".repeat(100) }, (_spec, database) => {
      const committed = committedAt(128);
      expect(() => assertStoredValuesFitMaxLengths(committed, committed, database)).not.toThrow();
    });
  });

  test("a limit on a field this evolution introduces is skipped: its column has no rows yet", () => {
    withStored({ title: "x".repeat(100) }, (committed, database) => {
      const grown: CapabilitySpec = {
        ...committed,
        schema: {
          fields: [
            ...committed.schema.fields,
            {
              name: "summary",
              label: "Summary",
              type: "string",
              required: false,
              lifecycle: "active",
              max_length: 64,
            },
          ],
        },
      };
      // The column does not exist yet — the same evolution adds it — so a scan that did not
      // skip a new field would fail on the SQL rather than on the data.
      expect(() => assertStoredValuesFitMaxLengths(committed, grown, database)).not.toThrow();
    });
  });
});

test("every field that cannot take its new limit is named in one refusal", () => {
  withStored({ title: "x".repeat(100), archived_note: "y".repeat(100) }, (committed, database) => {
    const tightened = withLimit(withLimit(committed, "title", 64), "archived_note", 64);
    try {
      assertStoredValuesFitMaxLengths(committed, tightened, database);
      throw new Error("expected the scan to refuse");
    } catch (error) {
      expect((error as MaxLengthScanError).fields.map((entry) => entry.field)).toEqual([
        "title",
        "archived_note",
      ]);
    }
  });
});

test("the scan refuses to build a statement over an unvalidated name", () => {
  withStored({ title: "x".repeat(100) }, (committed, database) => {
    const crafted: CapabilitySpec = {
      ...withLimit(committed, "title", 64),
      id: 'notes"; DROP TABLE "cap_notes',
    };
    expect(() => assertStoredValuesFitMaxLengths(committed, crafted, database)).toThrow(
      "unvalidated capability id",
    );
  });
});
