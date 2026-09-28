import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The Codex hooks are only worth their tests (`biome-hooks.test.ts`) while they are registered.

const hooksConfiguration = join(import.meta.dir, "..", ".codex/hooks.json");

describe("Biome Codex hooks", () => {
  test("registers both hooks for apply_patch", () => {
    const configuration = JSON.parse(readFileSync(hooksConfiguration, "utf8"));
    const postToolUse = configuration.hooks.PostToolUse;

    expect(postToolUse).toHaveLength(2);
    for (const hook of postToolUse) {
      expect(hook.matcher).toContain("apply_patch");
    }
  });
});
