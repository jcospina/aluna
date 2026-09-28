import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// No timeout exists on a step or on the loop. `question-loop.test.ts` pins that nothing fired for
// its fixtures; this sweep pins that there is no code to fire for any other, because "we did not
// add one" stays true right up until somebody adds one as a convenience.

/** Every module of the read path, off the directory: a new one is swept the day it arrives. */
const QUERY_SOURCE = readdirSync(import.meta.dir).filter(
  (name) => name.endsWith(".ts") && !name.includes(".test") && !name.endsWith(".policy.ts"),
);

describe("no timeout exists on a step or on the loop", () => {
  test("no source on the path holds a construct a deadline is built from", () => {
    // The worker's thread is swept too: its globals are out of the spies' reach. `.test` drops
    // both the suites and their support, which warp clocks on purpose, and the policy files name
    // the constructs they ban. `question-pipeline.ts` is deliberately outside: it arms the
    // presenter's own bound.
    const source = [...QUERY_SOURCE, "../../pipeline/query/data-query.ts"];

    for (const file of source) {
      const text = readFileSync(join(import.meta.dir, file), "utf8");
      for (const construct of [
        "setTimeout",
        "setInterval",
        "setImmediate",
        "AbortSignal.timeout",
        "Bun.sleep",
        "Date.now",
        "new Date",
        "performance.now",
        "nanoseconds",
        "hrtime",
        "node:timers",
      ]) {
        expect({ file, construct, present: text.includes(construct) }).toEqual({
          file,
          construct,
          present: false,
        });
      }
    }
  });

  test("the sweep is looking at every file on the path, and they exist", () => {
    // A sweep over a mistyped path passes by reading nothing, and one over an empty listing
    // passes by reading nothing at all. Both ends are pinned here.
    expect(QUERY_SOURCE).toContain("question-loop.ts");
    expect(QUERY_SOURCE).toContain("query-worker-thread.ts");
    expect(QUERY_SOURCE.length).toBeGreaterThan(10);
    for (const file of [...QUERY_SOURCE, "../../pipeline/query/data-query.ts"]) {
      expect(readFileSync(join(import.meta.dir, file), "utf8").length).toBeGreaterThan(0);
    }
  });
});
