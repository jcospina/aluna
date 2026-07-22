import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const projectDirectory = join(import.meta.dir, "..");
const formatHook = join(projectDirectory, ".codex/hooks/biome-format.sh");
const lintHook = join(projectDirectory, ".codex/hooks/biome-lint.sh");
const hooksConfiguration = join(projectDirectory, ".codex/hooks.json");
const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(join(projectDirectory, "hook-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runHook(
  hook: string,
  payload: object,
): { exitCode: number; stderr: string; stdout: string } {
  const process = spawnSync("bash", [hook], {
    cwd: projectDirectory,
    env: { ...Bun.env, CLAUDE_PROJECT_DIR: projectDirectory },
    encoding: "utf8",
    input: JSON.stringify(payload),
  });
  return {
    exitCode: process.status ?? 1,
    stderr: process.stderr,
    stdout: process.stdout,
  };
}

function relativePath(directory: string, file: string): string {
  return join(basename(directory), file);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Biome Codex hooks", () => {
  test("registers both hooks for apply_patch", () => {
    const configuration = JSON.parse(readFileSync(hooksConfiguration, "utf8"));
    const postToolUse = configuration.hooks.PostToolUse;

    expect(postToolUse).toHaveLength(2);
    for (const hook of postToolUse) {
      expect(hook.matcher).toContain("apply_patch");
    }
  });

  test("formats a Write/Edit file_path payload", () => {
    const directory = makeTemporaryDirectory();
    const file = join(directory, "direct.ts");
    writeFileSync(file, "export const direct={value:1}\n");

    const result = runHook(formatHook, { tool_input: { file_path: file } });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });
    expect(readFileSync(file, "utf8")).toBe("export const direct = { value: 1 };\n");
  });

  test("formats every file named by an apply_patch payload", () => {
    const directory = makeTemporaryDirectory();
    const first = join(directory, "first.ts");
    const second = join(directory, "second.ts");
    writeFileSync(first, "export const first={value:1}\n");
    writeFileSync(second, "export const second={value:2}\n");
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${relativePath(directory, "first.ts")}`,
      "@@",
      `*** Add File: ${relativePath(directory, "second.ts")}`,
      "*** End Patch",
    ].join("\n");

    const result = runHook(formatHook, { tool_input: patch });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });
    expect(readFileSync(first, "utf8")).toBe("export const first = { value: 1 };\n");
    expect(readFileSync(second, "utf8")).toBe("export const second = { value: 2 };\n");
  });

  test("formats apply_patch files nested in a Codex command payload", () => {
    const directory = makeTemporaryDirectory();
    const file = join(directory, "nested.ts");
    writeFileSync(file, "export const nested={value:3}\n");
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${relativePath(directory, "nested.ts")}`,
      "@@",
      "*** End Patch",
    ].join("\n");
    const command = `const patch = ${JSON.stringify(patch)}; text(await tools.apply_patch(patch));`;

    const result = runHook(formatHook, { tool_input: { command } });

    expect(result).toEqual({ exitCode: 0, stderr: "", stdout: "{}\n" });
    expect(readFileSync(file, "utf8")).toBe("export const nested = { value: 3 };\n");
  });

  test("blocks when any file in a multi-file patch violates Biome lint", () => {
    const directory = makeTemporaryDirectory();
    const valid = join(directory, "valid.ts");
    const excessive = join(directory, "excessive.ts");
    writeFileSync(valid, "export const valid = true;\n");
    writeFileSync(
      excessive,
      Array.from({ length: 501 }, (_, index) => `export const line${index} = ${index};`).join("\n"),
    );
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${relativePath(directory, "valid.ts")}`,
      "@@",
      `*** Update File: ${relativePath(directory, "excessive.ts")}`,
      "*** End Patch",
    ].join("\n");

    const result = runHook(lintHook, { tool_input: { patch } });
    const response = JSON.parse(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(response.decision).toBe("block");
    expect(response.reason).toContain("noExcessiveLinesPerFile");
    expect(response.reason).toContain("excessive.ts");
  });

  test("ignores non-Biome and deleted files in patch payloads", () => {
    const directory = makeTemporaryDirectory();
    const markdown = relativePath(directory, "notes.md");
    const deleted = relativePath(directory, "deleted.ts");
    writeFileSync(join(directory, "notes.md"), "# Notes\n");
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${markdown}`,
      "@@",
      `*** Delete File: ${deleted}`,
      "*** End Patch",
    ].join("\n");

    expect(runHook(lintHook, { tool_input: patch })).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "{}\n",
    });
  });
});

describe("Biome Codex hooks — path containment", () => {
  test("never formats a path outside the project", () => {
    const directory = mkdtempSync(join(tmpdir(), "omni-crud-hook-outside-"));
    temporaryDirectories.push(directory);
    const file = join(directory, "outside.ts");
    const unformatted = "export const outside={value:1}\n";
    writeFileSync(file, unformatted);

    expect(runHook(formatHook, { tool_input: { file_path: file } })).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "{}\n",
    });
    expect(readFileSync(file, "utf8")).toBe(unformatted);
  });

  test("ignores patch-control text embedded inside changed source lines", () => {
    const directory = makeTemporaryDirectory();
    const target = join(directory, "target.ts");
    const unrelated = join(directory, "unrelated.ts");
    writeFileSync(target, "export const target={value:1}\n");
    const unrelatedSource = "export const unrelated={value:2}\n";
    writeFileSync(unrelated, unrelatedSource);
    const patch = [
      "*** Begin Patch",
      `*** Update File: ${relativePath(directory, "target.ts")}`,
      "@@",
      `+const decoy = '*** Update File: ${relativePath(directory, "unrelated.ts")}\\n';`,
      `-const moved = '*** Move to: ${relativePath(directory, "unrelated.ts")}\\n';`,
      "*** End Patch",
    ].join("\n");
    const command = `const patch = ${JSON.stringify(patch)}; text(await tools.apply_patch(patch));`;

    expect(runHook(formatHook, { tool_input: { command } })).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "{}\n",
    });
    expect(readFileSync(target, "utf8")).toBe("export const target = { value: 1 };\n");
    expect(readFileSync(unrelated, "utf8")).toBe(unrelatedSource);
  });
});
