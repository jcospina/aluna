import { describe, expect, test } from "bun:test";

import type { SpecField } from "../registry/index.ts";
import { fieldValuesToRecord } from "./gate-behavioral-input.ts";
import { rowMatches } from "./gate-behavioral-shared.ts";

const FIELDS: readonly SpecField[] = [
  { name: "title", label: "Title", type: "string", required: true, lifecycle: "active" },
  { name: "tags", label: "Tags", type: "string[]", required: false, lifecycle: "active" },
];

describe("fieldValuesToRecord — list-field normalization", () => {
  test("a single scalar for a string[] field becomes a one-element list", () => {
    const record = fieldValuesToRecord(FIELDS, [
      { field: "title", value: "CREATE_NEW" },
      { field: "tags", value: "CREATE_TAG" },
    ]);

    expect(record).toEqual({ title: "CREATE_NEW", tags: ["CREATE_TAG"] });
  });

  test("repeated entries for a string[] field collect into one list in order", () => {
    const record = fieldValuesToRecord(FIELDS, [
      { field: "tags", value: "first" },
      { field: "tags", value: "second" },
    ]);

    expect(record).toEqual({ tags: ["first", "second"] });
  });

  test("null asserts a list field's absence rather than an empty list", () => {
    const record = fieldValuesToRecord(FIELDS, [{ field: "tags", value: null }]);

    expect(record).toEqual({ tags: null });
  });

  test("non-list fields pass through untouched", () => {
    const record = fieldValuesToRecord(FIELDS, [
      { field: "title", value: "kept" },
      { field: "unknown", value: "also-kept" },
    ]);

    expect(record).toEqual({ title: "kept", unknown: "also-kept" });
  });

  test("a normalized expected row matches a stored row whose list is a real array", () => {
    // The regression: the model authors {"field":"tags","value":"CREATE_TAG"} while
    // the data port stores ["CREATE_TAG"]; the raw scalar used to fail rowMatches.
    const stored = {
      id: "row-1",
      created_at: "2026-07-23 01:24:54",
      title: "CREATE_NEW",
      tags: ["CREATE_TAG"],
    };
    const expected = fieldValuesToRecord(FIELDS, [
      { field: "title", value: "CREATE_NEW" },
      { field: "tags", value: "CREATE_TAG" },
    ]);

    expect(rowMatches(FIELDS, stored, expected)).toBe(true);
  });
});
