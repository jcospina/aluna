#!/usr/bin/env bun
// No folder under src/, public/, design/ or scripts/ holds more than ten files. Past that, a new
// file lands beside whatever it resembles by name, and the folder stops saying what its files do.
//
// Every file counts: a test, a policy and a test-support file are what a reader scans past on the
// way to the source. A file counts when git carries it, tracked or untracked-but-not-ignored, so
// an agent's new file fails the check before anyone stages it.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const MAX_FILES_PER_FOLDER = 10;
export const GOVERNED_ROOTS: readonly string[] = ["src", "public", "design", "scripts"];

export interface CrowdedFolder {
  readonly folder: string;
  readonly files: number;
}

/** Folders holding more than `max` files directly. Files in a sub-folder count only there. */
export function crowdedFolders(
  files: readonly string[],
  roots: readonly string[] = GOVERNED_ROOTS,
  max: number = MAX_FILES_PER_FOLDER,
): CrowdedFolder[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (!roots.some((root) => file.startsWith(`${root}/`))) continue;
    const folder = dirname(file);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count > max)
    .map(([folder, count]) => ({ folder, files: count }))
    .sort((a, b) => a.folder.localeCompare(b.folder));
}

/** The environment minus `GIT_*`, so a hook's `GIT_DIR` or `GIT_INDEX_FILE` cannot aim git elsewhere. */
export const withoutGitVariables = (): Record<string, string | undefined> =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")));

const git = (cwd: string, args: readonly string[]): string => {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: withoutGitVariables() });
  if (run.exitCode !== 0) throw new Error(`git ${args[0]} failed: ${run.stderr.toString()}`);
  return run.stdout.toString();
};

/**
 * Paths, relative to the repository's top level, of every file git would carry: tracked, or
 * untracked and not ignored. Read from the top whatever folder `cwd` is, because a listing taken
 * from a sub-folder holds only that sub-folder and would pass every other one unread.
 */
export function filesGitCarries(cwd: string): string[] {
  const top = git(cwd, ["rev-parse", "--show-toplevel"]).trim();
  const listed = git(top, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]);
  // An unmerged path is listed once per conflict stage, a nested repository as `dir/`, and a
  // tracked file deleted from the working tree stays in the index until the deletion is staged.
  return [...new Set(listed.split("\0"))].filter(
    (path) => path !== "" && !path.endsWith("/") && existsSync(join(top, path)),
  );
}

/** Print the verdict on `files` and return the exit code. Finding nothing to check is a failure. */
export function reportFolderSizes(files: readonly string[]): number {
  if (!files.some((file) => GOVERNED_ROOTS.some((root) => file.startsWith(`${root}/`)))) {
    console.error(`folder size: no file under ${GOVERNED_ROOTS.join(", ")}; nothing was checked.`);
    return 1;
  }
  const crowded = crowdedFolders(files);
  for (const { folder, files: count } of crowded) {
    console.error(`${folder}/ holds ${count} files; the limit is ${MAX_FILES_PER_FOLDER}.`);
  }
  if (crowded.length === 0) {
    console.log("folder size: clean");
    return 0;
  }
  console.error(
    "Split each one into sub-folders named for what their files do, and keep each test in its subject's folder or below it.",
  );
  return 1;
}

if (import.meta.main)
  process.exit(reportFolderSizes(filesGitCarries(process.argv[2] ?? import.meta.dir)));
