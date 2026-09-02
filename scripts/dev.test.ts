import { describe, expect, test } from "bun:test";

import { isRestartWorthy } from "./dev.ts";

describe("dev runner restart predicate", () => {
  test("restarts for authored source the running server is compiled from", () => {
    expect(isRestartWorthy("/repo/src/server/app.ts")).toBe(true);
    expect(isRestartWorthy("/repo/src/registry/index.ts")).toBe(true);
    expect(isRestartWorthy("/repo/src/pipeline/prompts/build.json")).toBe(true);
  });

  test("ignores test files, which never enter the running server's module graph", () => {
    expect(isRestartWorthy("/repo/src/server/app.test.ts")).toBe(false);
    expect(isRestartWorthy("/repo/src/runtime/router/dispatch/router.test-support.ts")).toBe(false);
  });

  test("ignores editor scratch files and an unnamed change", () => {
    expect(isRestartWorthy("/repo/src/server/app.ts~")).toBe(false);
    expect(isRestartWorthy("/repo/src/server/.app.ts.swp")).toBe(false);
    expect(isRestartWorthy("/repo/src/.DS_Store")).toBe(false);
    expect(isRestartWorthy(null)).toBe(false);
  });
});
