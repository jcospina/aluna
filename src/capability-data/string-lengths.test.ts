import { describe, expect, test } from "bun:test";

import { MAX_DECLARED_MAX_LENGTH, type SpecField } from "../registry/index.ts";
import { MaxLengthExceededError } from "./internal.ts";
import { assertAdmittedStringLengths } from "./string-lengths.ts";

function field(overrides: Partial<SpecField> & Pick<SpecField, "name" | "type">): SpecField {
  return {
    label: overrides.name,
    required: false,
    lifecycle: "active",
    ...overrides,
  } as SpecField;
}

const FIELDS: readonly SpecField[] = [
  field({ name: "bounded", type: "string", max_length: 64 }),
  field({ name: "unbounded", type: "string" }),
  field({ name: "tags", type: "string[]" }),
];

function admit(values: Record<string, unknown>): void {
  assertAdmittedStringLengths("notes", FIELDS, values, "create");
}

describe("what a string field admits on the way in", () => {
  test("a declared limit is the one enforced", () => {
    expect(() => admit({ bounded: "x".repeat(64) })).not.toThrow();
    expect(() => admit({ bounded: "x".repeat(65) })).toThrow(MaxLengthExceededError);
  });

  // The two shapes that had no ceiling anywhere: a string field that declared none, and a
  // list field, which may not declare one at all.
  test("a string field that declares nothing is still bounded by the platform's own ceiling", () => {
    expect(() => admit({ unbounded: "x".repeat(MAX_DECLARED_MAX_LENGTH) })).not.toThrow();
    expect(() => admit({ unbounded: "x".repeat(MAX_DECLARED_MAX_LENGTH + 1) })).toThrow(
      MaxLengthExceededError,
    );
  });

  test("a list is measured across its elements, which bounds both their size and their number", () => {
    expect(() => admit({ tags: ["a", "b", "c"] })).not.toThrow();
    // One enormous element.
    expect(() => admit({ tags: ["x".repeat(MAX_DECLARED_MAX_LENGTH + 1)] })).toThrow(
      MaxLengthExceededError,
    );
    // Or a great many small ones.
    expect(() =>
      admit({ tags: Array.from({ length: MAX_DECLARED_MAX_LENGTH + 1 }, () => "x") }),
    ).toThrow(MaxLengthExceededError);
  });

  test("one refusal names every field that overran", () => {
    try {
      admit({ bounded: "x".repeat(65), unbounded: "y".repeat(MAX_DECLARED_MAX_LENGTH + 1) });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(MaxLengthExceededError);
      expect((error as MaxLengthExceededError).fields).toEqual(["bounded", "unbounded"]);
    }
  });
});
