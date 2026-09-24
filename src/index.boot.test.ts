// Boot is a script rather than a function, so the order it runs in is read from its source.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("boot empties the upload staging directory before the server listens", () => {
  const boot = readFileSync(join(import.meta.dir, "index.ts"), "utf8");
  const clears = boot.indexOf("platformObjectStore.clearStaging()");
  expect(clears).toBeGreaterThan(-1);
  expect(clears).toBeLessThan(boot.indexOf("Bun.serve("));
});
