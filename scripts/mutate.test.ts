import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countMutants, parseArgs, SANDBOX_IGNORE, siblingTests, strykerConfig } from "./mutate.ts";

const repos: string[] = [];

afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repoWith(files: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), "mutate-test-"));
  repos.push(root);
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
  return root;
}

describe("the mutation script", () => {
  test("finds the tests named for a source file and no others", () => {
    const root = repoWith([
      "src/a/file-name.ts",
      "src/a/file-name.test.ts",
      "src/a/file-name.unicode.test.ts",
      "src/a/file-names.test.ts",
      "src/a/other.test.ts",
    ]);
    const args = parseArgs(["src/a/file-name.ts"], root);
    expect(args.tests).toEqual(["src/a/file-name.test.ts", "src/a/file-name.unicode.test.ts"]);
    expect(siblingTests(join(root, "src/a/other.ts"))).toEqual([join(root, "src/a/other.test.ts")]);
  });

  test("runs exactly the tests it is given instead of the siblings", () => {
    const root = repoWith(["src/a/x.ts", "src/a/x.test.ts", "src/b/y.test.ts"]);
    const args = parseArgs(["src/a/x.ts", "src/b/y.test.ts", "--break=75"], root);
    expect(args.tests).toEqual(["src/b/y.test.ts"]);
    const config = strykerConfig(args, "/work");
    expect(config.mutate).toEqual(["src/a/x.ts"]);
    expect(config.commandRunner).toEqual({
      command: "bun scripts/memory-guard.ts bun test ./src/b/y.test.ts",
    });
    expect(config.thresholds).toMatchObject({ break: 75 });
    expect(config.concurrency).toBe(1);
  });

  test("narrows a large file to a line range and still finds the file behind it", () => {
    const root = repoWith(["public/app.js", "src/a/x.test.ts"]);
    const args = parseArgs(["public/app.js:120-200", "src/a/x.test.ts"], root);
    expect(strykerConfig(args, "/work").mutate).toEqual(["public/app.js:120-200"]);
    expect(parseArgs(["public/app.js:3:4-9:2", "src/a/x.test.ts"], root).source).toBe(
      "public/app.js:3:4-9:2",
    );
    expect(() => parseArgs(["public/gone.js:1-9", "src/a/x.test.ts"], root)).toThrow(
      /no such source file: public\/gone.js$/,
    );
  });

  test("refuses a run that could only report a meaningless score", () => {
    const root = repoWith([
      "src/a/lonely.ts",
      "src/a/x.ts",
      "src/a/x.test.ts",
      "data/README.md",
      "dist/bundle.js",
    ]);
    expect(() => parseArgs(["src/a/x.ts", "--brake=80"], root)).toThrow(/unknown flag: --brake/);
    expect(() => parseArgs(["data/README.md", "src/a/x.test.ts"], root)).toThrow(
      /not a script Stryker can mutate/,
    );
    expect(() => parseArgs(["dist/bundle.js", "src/a/x.test.ts"], root)).toThrow(/left out/);
    expect(() => parseArgs([], root)).toThrow(/usage/);
    expect(() => parseArgs(["src/a/missing.ts"], root)).toThrow(/no such source/);
    expect(() => parseArgs(["src/a/lonely.ts"], root)).toThrow(/no test files/);
    expect(() => parseArgs(["src/a/x.ts", "--break=150"], root)).toThrow(/--break/);
    expect(parseArgs(["src/a/x.ts"], root).breakAt).toBeNull();
  });

  test("keeps secrets out of the sandbox copy", () => {
    const secrets = [".env", ".env.local", ".env.production"];
    const root = repoWith([...secrets, ".env.ts", "src/a/x.ts", "src/a/x.test.ts", "src/env.ts"]);
    expect(() => parseArgs([".env.ts", "src/a/x.test.ts"], root)).toThrow(/left out/);
    expect(() => parseArgs([".env", "src/a/x.test.ts"], root)).toThrow();
    expect(strykerConfig(parseArgs(["src/a/x.ts"], root), "/w").ignorePatterns).toBe(
      SANDBOX_IGNORE,
    );

    // Read the patterns the way the sandbox copy reads them, as gitignore rules, by git itself.
    writeFileSync(join(root, ".gitignore"), SANDBOX_IGNORE.join("\n"));
    const ignored = (path: string) => {
      Bun.spawnSync(["git", "init", "-q"], { cwd: root });
      return Bun.spawnSync(["git", "check-ignore", "-q", path], { cwd: root }).exitCode === 0;
    };
    expect(secrets.filter(ignored)).toEqual(secrets);
    expect(["src/a/x.ts", "src/env.ts"].filter(ignored)).toEqual([]);
  });

  test("counts the mutants a report holds, so an empty run cannot pass", () => {
    expect(
      countMutants({ files: { "a.ts": { mutants: [{}, {}] }, "b.ts": { mutants: [{}] } } }),
    ).toBe(3);
    expect(countMutants({ files: {} })).toBe(0);
    expect(countMutants({ files: { "a.ts": {} } })).toBe(0);
    expect(countMutants(null)).toBe(0);
  });
});
