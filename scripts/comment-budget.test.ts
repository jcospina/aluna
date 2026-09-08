// The comment budget's own teeth. A check nothing can fail is a check that gets deleted, so
// each rule is forced against a snippet written to break it as well as one written to pass.

import { describe, expect, test } from "bun:test";

import {
  auditRepository,
  BLOCK_BUDGET,
  commentBlocks,
  HEADER_BUDGET,
  overBudget,
} from "./comment-budget.ts";

const line = (text: string, count: number) => Array.from({ length: count }, () => text);
const jsdoc = (prose: number) => ["/**", ...line(" * a sentence.", prose), " */"].join("\n");
const slashes = (prose: number) => line("// a sentence.", prose).join("\n");

describe("what a block is allowed to spend", () => {
  test("the header gets the larger budget and everything after it the smaller", () => {
    const source = `${slashes(1)}\nconst a = 1;\n${slashes(1)}\nconst b = 2;\n`;
    expect(commentBlocks(source).map((block) => block.budget)).toEqual([
      HEADER_BUDGET,
      BLOCK_BUDGET,
    ]);
  });

  test("a header at its budget passes and one line more fails", () => {
    expect(overBudget("f.ts", `${slashes(HEADER_BUDGET)}\nconst a = 1;\n`)).toEqual([]);
    expect(overBudget("f.ts", `${slashes(HEADER_BUDGET + 1)}\nconst a = 1;\n`)).toHaveLength(1);
  });

  test("a block at its budget passes and one line more fails", () => {
    expect(overBudget("f.ts", `const a = 1;\n${jsdoc(BLOCK_BUDGET)}\n`)).toEqual([]);
    expect(overBudget("f.ts", `const a = 1;\n${jsdoc(BLOCK_BUDGET + 1)}\n`)).toHaveLength(1);
  });

  test("a blank line splits one long run into two blocks the budget is applied to apart", () => {
    const split = `${slashes(2)}\n\n${slashes(2)}\nconst a = 1;\n`;
    expect(commentBlocks(split)).toHaveLength(2);
  });
});

describe("what costs nothing", () => {
  test("a shebang leaves the header a header rather than making it an inner block", () => {
    const source = `#!/usr/bin/env bun\n${slashes(HEADER_BUDGET)}\nconst a = 1;\n`;
    expect(overBudget("f.ts", source)).toEqual([]);
  });

  test("pragmas and blank comment lines are free", () => {
    const source = `// @ts-check\n//\n${slashes(HEADER_BUDGET)}\nconst a = 1;\n`;
    expect(overBudget("f.ts", source)).toEqual([]);
  });

  test("a lone pragma above a blank line does not eat the header budget below it", () => {
    const source = `// @ts-check\n\n${jsdoc(HEADER_BUDGET)}\nexport const a = 1;\n`;
    expect(commentBlocks(source).map((block) => block.budget)).toEqual([
      HEADER_BUDGET,
      HEADER_BUDGET,
    ]);
    expect(overBudget("f.js", source)).toEqual([]);
  });

  test("everything from the first JSDoc tag on documents the API and is free", () => {
    const tags = line(" * @param {string} a the thing", BLOCK_BUDGET + 4);
    const source = `const a = 1;\n${["/**", ...line(" * a sentence.", BLOCK_BUDGET), ...tags, " */"].join("\n")}\n`;
    expect(overBudget("f.ts", source)).toEqual([]);
  });

  test("a trailing comment beside code is not a block at all", () => {
    expect(commentBlocks("const a = 1; // why\n")).toEqual([]);
  });
});

describe("the repository", () => {
  test("spends no more comment than the budget allows", () => {
    expect(auditRepository().map((one) => `${one.file}:${one.startLine} (${one.prose})`)).toEqual(
      [],
    );
  });
});
