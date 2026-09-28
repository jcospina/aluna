import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { WORKER_THREAD_SOURCE } from "./build.ts";

// The bundle copies the query worker's thread beside itself because `bun build` cannot follow
// it (`build.test.ts` proves the copy). The copy is only enough while the thread imports nothing
// of its own.

describe("the production bundle", () => {
  test("the copied thread has no relative dependency the copy could not resolve", () => {
    const source = readFileSync(WORKER_THREAD_SOURCE, "utf8");

    // A sibling import would silently stop the copy being enough, and not every shape that
    // does it is `import … from`, which is all the first version of this assertion matched.
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g),
    ].map((match) => match[1] as string);

    expect(specifiers).toContain("bun:sqlite");
    expect(specifiers.filter((specifier) => specifier.startsWith("."))).toEqual([]);
    // A dynamic reach for a computed specifier is unresolvable by inspection, so it is
    // refused rather than assessed.
    expect(source).not.toMatch(/\b(?:import|require)\s*\(\s*[^"')]/);
  });
});
