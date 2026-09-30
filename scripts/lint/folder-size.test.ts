import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  crowdedFolders,
  filesGitCarries,
  MAX_FILES_PER_FOLDER,
  withoutGitVariables,
} from "./folder-size.ts";

const filesIn = (folder: string, count: number, suffix = ".ts") =>
  Array.from({ length: count }, (_, index) => `${folder}/file-${index}${suffix}`);

describe("which folders are crowded", () => {
  test("a folder at the limit passes and one file more fails it", () => {
    expect(crowdedFolders(filesIn("src/a", MAX_FILES_PER_FOLDER))).toEqual([]);
    expect(crowdedFolders(filesIn("src/a", MAX_FILES_PER_FOLDER + 1))).toEqual([
      { folder: "src/a", files: MAX_FILES_PER_FOLDER + 1 },
    ]);
  });

  test("tests, policies and support files count like any other file", () => {
    const files = [
      ...filesIn("src/a", 4),
      ...filesIn("src/a", 4, ".test.ts"),
      ...filesIn("src/a", 2, ".policy.ts"),
      "src/a/shared.test-support.ts",
    ];
    expect(crowdedFolders(files)).toEqual([{ folder: "src/a", files: 11 }]);
  });

  test("a sub-folder's files count only in the sub-folder", () => {
    const files = [...filesIn("public", 6), ...filesIn("public/desk", 6)];
    expect(crowdedFolders(files)).toEqual([]);
  });

  test("the source, both served trees and the scripts are all governed", () => {
    for (const folder of ["src/a", "public/a", "design/a", "scripts/a"]) {
      expect(crowdedFolders(filesIn(folder, 11)), folder).toEqual([{ folder, files: 11 }]);
    }
  });

  test("a governed root's own files count, and only governed roots are read", () => {
    expect(crowdedFolders(filesIn("scripts", 11))).toEqual([{ folder: "scripts", files: 11 }]);
    expect(crowdedFolders([...filesIn("docs/adr", 20), ...filesIn("srcx", 20)])).toEqual([]);
  });

  test("every crowded folder is named, in path order", () => {
    const files = [...filesIn("src/b", 12), ...filesIn("design/scripts", 11)];
    expect(crowdedFolders(files).map(({ folder }) => folder)).toEqual(["design/scripts", "src/b"]);
  });
});

describe("which files git carries", () => {
  let repo = "";
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const git = (...args: string[]) =>
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: repo,
      env: withoutGitVariables(),
    });
  const write = (path: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), "");
  };

  const freshRepo = () => {
    repo = mkdtempSync(join(tmpdir(), "folder-size-"));
    git("init", "-q");
  };

  test("tracked and new files count; ignored and deleted ones do not", () => {
    freshRepo();
    write(".gitignore");
    writeFileSync(join(repo, ".gitignore"), "*.log\n");
    for (const path of ["src/tracked.ts", "src/deleted.ts"]) write(path);
    git("add", ".");
    write("src/untracked.ts");
    write("src/ignored.log");
    rmSync(join(repo, "src/deleted.ts"));

    expect(filesGitCarries(repo).sort()).toEqual([
      ".gitignore",
      "src/tracked.ts",
      "src/untracked.ts",
    ]);
  });

  test("asked from a sub-folder, it still lists the whole repository", () => {
    freshRepo();
    for (const path of ["src/deep/a.ts", "public/b.js"]) write(path);
    expect(filesGitCarries(join(repo, "src/deep")).sort()).toEqual([
      "public/b.js",
      "src/deep/a.ts",
    ]);
  });

  test("a path with spaces or accents is counted under its folder", () => {
    freshRepo();
    write("src/a/ride log é.ts");
    git("add", ".");
    expect(filesGitCarries(repo)).toEqual(["src/a/ride log é.ts"]);
  });

  test("a conflicted file counts once, not once per side of the conflict", () => {
    freshRepo();
    writeFileSync(join(repo, "base.ts"), "base\n");
    git("add", ".");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "other");
    writeFileSync(join(repo, "base.ts"), "other\n");
    git("commit", "-qam", "other");
    git("checkout", "-q", "-");
    writeFileSync(join(repo, "base.ts"), "mine\n");
    git("commit", "-qam", "mine");
    expect(git("merge", "other").exitCode).not.toBe(0);
    expect(filesGitCarries(repo)).toEqual(["base.ts"]);
  });

  test("a repository nested inside is not a file of its parent folder", () => {
    freshRepo();
    write("src/a/kept.ts");
    mkdirSync(join(repo, "src/a/nested"));
    Bun.spawnSync(["git", "init", "-q"], {
      cwd: join(repo, "src/a/nested"),
      env: withoutGitVariables(),
    });
    writeFileSync(join(repo, "src/a/nested/inner.ts"), "");
    expect(filesGitCarries(repo)).toEqual(["src/a/kept.ts"]);
  });

  test("a folder that is not a repository is an error, not a clean pass", () => {
    repo = mkdtempSync(join(tmpdir(), "folder-size-"));
    expect(() => filesGitCarries(repo)).toThrow();
  });
});

describe("the command lint runs", () => {
  let repo = "";
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  const run = () =>
    Bun.spawnSync(["bun", join(import.meta.dir, "folder-size.ts"), repo], {
      stderr: "pipe",
      env: withoutGitVariables(),
    });

  test("fails and names the folder when one is crowded, and passes once it is split", () => {
    repo = mkdtempSync(join(tmpdir(), "folder-size-cli-"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo, env: withoutGitVariables() });
    mkdirSync(join(repo, "src/a/b"), { recursive: true });
    writeFileSync(join(repo, "README.md"), "");
    for (const name of filesIn("src/a", 11)) writeFileSync(join(repo, name), "");

    const crowded = run();
    expect(crowded.exitCode).toBe(1);
    expect(crowded.stderr.toString()).toContain("src/a/");

    for (const name of filesIn("src/a", 5))
      renameSync(join(repo, name), join(repo, "src/a/b", name.slice(6)));
    const split = run();
    expect(split.exitCode).toBe(0);
    expect(split.stderr.toString()).toBe("");
  });

  test("a GIT_DIR a hook exported cannot aim the check at another repository", () => {
    repo = mkdtempSync(join(tmpdir(), "folder-size-cli-"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo, env: withoutGitVariables() });
    mkdirSync(join(repo, "src/a"), { recursive: true });
    for (const name of filesIn("src/a", 11)) writeFileSync(join(repo, name), "");
    // This repository is clean, so a check aimed at it would pass.
    const elsewhere = join(import.meta.dir, "../..");
    const aimed = Bun.spawnSync(["bun", join(import.meta.dir, "folder-size.ts"), repo], {
      stderr: "pipe",
      env: { ...withoutGitVariables(), GIT_DIR: join(elsewhere, ".git"), GIT_WORK_TREE: elsewhere },
    });
    expect(aimed.exitCode).toBe(1);
    expect(aimed.stderr.toString()).toContain("src/a/");
  });

  test("a repository with nothing under the governed folders fails rather than passing unread", () => {
    repo = mkdtempSync(join(tmpdir(), "folder-size-cli-"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: repo, env: withoutGitVariables() });
    writeFileSync(join(repo, "README.md"), "");
    expect(run().exitCode).toBe(1);
  });
});
