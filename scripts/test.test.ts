import { describe, expect, test } from "bun:test";

import { unhandledErrors } from "./test.ts";

/** What Bun prints for a file that failed to load, its JUnit carrying no case for it. */
const loadFailure = (message: string) =>
  `# Unhandled error between tests\n-------------------------------\n1 | })\n    ^\n${message}\n      at loadAndEvaluateModule (2:1)\n-------------------------------\n`;

describe("the runner's unhandled errors", () => {
  test("a file that failed to load is reported by its error, beside the shard's failures", () => {
    const missing = "SyntaxError: Export named 'gone' not found in module 'x.js'.";
    const output = `(fail) a test > that failed\n${loadFailure(missing)}${loadFailure("TypeError: no")}`;
    expect(unhandledErrors(output)).toEqual([missing, "TypeError: no"]);
  });

  test("a plain error is named by its own line, not by the code frame above it", () => {
    const frame = `# Unhandled error between tests\n---\n1 | throw new Error("x");\n    ^\nerror: x\n      at a.ts:1\n---\n`;
    expect(unhandledErrors(frame)).toEqual(["error: x"]);
  });

  test("a shard whose tests only failed reports none", () => {
    expect(unhandledErrors("(fail) a test > that failed\n 0 pass\n 1 fail\n")).toEqual([]);
  });
});
