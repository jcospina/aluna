import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Nothing but the results reaches the answer (PLAN decision 4); `question-answer.test.ts` proves
// what does, and this that the module has no way to reach anything else.

describe("nothing but the results reaches the answer", () => {
  test("the module holds no way of reading anything", () => {
    // The type says the answer is handed a provider and a signal, and that is the enforcement.
    // This says the file names nothing it could reach a row through, even if somebody widened it.
    const text = readFileSync(join(import.meta.dir, "question-answer.ts"), "utf8");

    for (const reader of [
      "query-worker.ts",
      "whole-catalog",
      "persistence",
      "registry",
      "../../data/",
      "scope.read",
      "bun:sqlite",
    ]) {
      expect({ reader, present: text.includes(reader) }).toEqual({ reader, present: false });
    }
  });
});
