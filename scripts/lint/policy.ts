#!/usr/bin/env bun
// The repo's policy checks: token rules, word bans, import boundaries, contrast audits and the
// other rules about how the source is written rather than what the product does.
//
// They are written in bun:test syntax, because an assertion with a message is the clearest way
// to say which rule a file broke, but they live in `*.policy.ts` beside the code they govern, so
// `bun run test` counts behaviour only. This finds every one under the repo root and runs them in
// a single `bun test`. Finding none is a failure: a rename that hid them all would otherwise
// pass as a clean tree.
//
// Run by `bun run lint`. `policy.test.ts` proves discovery finds what it claims to.

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const POLICY_SUFFIX = ".policy.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Dependencies anywhere, the root's build output, and hidden directories (VCS data, build types,
 * agent worktrees), as `scripts/test.ts` skips them: a `dist` folder deeper down is source.
 */
const skipped = (name: string, atRoot: boolean): boolean =>
  name === "node_modules" || (atRoot && name === "dist") || name.startsWith(".");

function collect(directory: string, found: string[], atRoot: boolean): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (!skipped(entry, atRoot)) collect(path, found, false);
    } else if (entry.endsWith(POLICY_SUFFIX)) found.push(path);
  }
}

/**
 * Every policy file under `root`, as `./`-prefixed root-relative paths `bun test` takes as-is.
 * @throws when there are none, since an empty run would report a clean tree.
 */
export function policyFiles(root: string = REPO_ROOT): string[] {
  const found: string[] = [];
  collect(root, found, true);
  if (found.length === 0) throw new Error(`no *${POLICY_SUFFIX} files under ${root}`);
  return found.map((path) => `./${relative(root, path).split("\\").join("/")}`).sort();
}

if (import.meta.main) {
  let files: string[];
  try {
    files = policyFiles();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  const run = spawnSync("bun", ["test", "--timeout=30000", ...files], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  process.exit(run.status ?? 1);
}
