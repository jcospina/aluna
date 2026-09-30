import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { policyFiles } from "./policy.ts";

const repos: string[] = [];

afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repoWith(files: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "policy-test-"));
  repos.push(root);
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

describe("policy discovery", () => {
  test("finds every policy file, at any depth, as a path bun test takes literally", () => {
    const root = repoWith([
      "src/a/tokens.policy.ts",
      "src/a/tokens.test.ts",
      "src/a/tokens.ts",
      "public/css/sheet.policy.ts",
      "scripts/top.policy.ts",
      "loose.policy.ts",
    ]);
    expect(policyFiles(root)).toEqual([
      "./loose.policy.ts",
      "./public/css/sheet.policy.ts",
      "./scripts/top.policy.ts",
      "./src/a/tokens.policy.ts",
    ]);
  });

  test("never reaches into dependencies, the build output or hidden directories", () => {
    const root = repoWith([
      "src/kept.policy.ts",
      "node_modules/pkg/a.policy.ts",
      "src/node_modules/b.policy.ts",
      "dist/c.policy.ts",
      ".types/d.policy.ts",
      ".claude/worktrees/copy/src/e.policy.ts",
      ".git/f.policy.ts",
      "src/build/dist/g.policy.ts",
    ]);
    expect(policyFiles(root)).toEqual(["./src/build/dist/g.policy.ts", "./src/kept.policy.ts"]);
  });

  test("refuses a tree with none, rather than reporting it clean", () => {
    expect(() => policyFiles(repoWith(["src/a.test.ts", "dist/b.policy.ts"]))).toThrow(
      /no \*\.policy\.ts files under/,
    );
  });
});
