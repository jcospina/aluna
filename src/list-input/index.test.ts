import { describe, expect, test } from "bun:test";

import { listInputModeForField, normalizeListInputValues } from "./index.ts";

describe("platform list-input contract", () => {
  test("comma_separated trims and flattens segments while preserving order and duplicates", () => {
    expect(
      normalizeListInputValues("comma_separated", [
        "Drama, Historical fiction, , Classic",
        "Drama",
      ]),
    ).toEqual(["Drama", "Historical fiction", "Classic", "Drama"]);
    expect(normalizeListInputValues("comma_separated", [" , , "])).toEqual([]);
  });

  test("repeatable preserves every raw occurrence and treats commas as ordinary data", () => {
    expect(normalizeListInputValues("repeatable", ["Doe, Jane", "  exact spacing  "])).toEqual([
      "Doe, Jane",
      "  exact spacing  ",
    ]);
  });

  test("mode lookup fails loudly when a render projection drops authored form intent", () => {
    expect(
      listInputModeForField({ list_inputs: [{ field: "tags", mode: "comma_separated" }] }, "tags"),
    ).toBe("comma_separated");
    expect(() => listInputModeForField({ list_inputs: [] }, "tags")).toThrow(
      'Missing list input mode for active field "tags"',
    );
  });
});
