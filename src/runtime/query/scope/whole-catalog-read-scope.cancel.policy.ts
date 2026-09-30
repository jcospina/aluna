import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// What the cancel path may not become: a wall-clock deadline (PLAN decision 9).
// `whole-catalog-read-scope.cancel.test.ts` runs how a question is cancelled.

describe("what the cancel path may not become", () => {
  test("nothing on the question's path arms a wall-clock deadline", () => {
    // A cancel entry point is one timer away from the deadline decision 9 refused. The thread's
    // `PRAGMA busy_timeout` is not one: it bounds waiting for another process's lock.
    for (const module of [
      "whole-catalog-read-scope.ts",
      "../worker/query-worker.ts",
      "../worker/query-worker-thread.ts",
    ]) {
      const source = readFileSync(join(import.meta.dir, module), "utf8");
      expect([module, /\b(?:setTimeout|setInterval|AbortSignal\.timeout)\b/.test(source)]).toEqual([
        module,
        false,
      ]);
    }
  });
});
