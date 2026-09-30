import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The answer is prose and it is disposable (`question-answer-material.test.ts` proves the words).

describe("the answer is prose and it is disposable", () => {
  test("there is nothing on this path to render one as a grid instead", () => {
    // The module hands over one string and holds nothing it could render a grid with.
    const text = readFileSync(join(import.meta.dir, "question-answer.ts"), "utf8");
    for (const surface of ["<table", "<tr", "<th", "<td", "chart", "csv", ".xlsx", "download"]) {
      expect({ surface, present: text.includes(surface) }).toEqual({ surface, present: false });
    }
  });
});
