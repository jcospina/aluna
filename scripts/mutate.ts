#!/usr/bin/env bun
/**
 * Mutation check for one source file: StrykerJS plants small bugs in it and runs the file's
 * tests against each. A surviving mutant is behaviour no test enforces; line coverage cannot
 * tell those apart from checked lines.
 *
 * Stryker runs under Node and drives `bun test` through its command runner, in a sandbox copy
 * of the repo, so an interrupted run never leaves a mutant in the working tree. Each test run goes
 * through `memory-guard.ts`, because a mutant can turn a loop into endless allocation.
 *
 * @example
 *   bun run mutate src/platform/files/file-name.ts
 *   bun run mutate src/presentation/safety/attribute-urls.ts src/presentation/safety/enforcer.test.ts
 *   bun run mutate src/platform/files/file-name.ts --break=80
 *   bun run mutate public/app.js:650-720 src/runtime/router/wire/refusal-rescue.test.ts
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MUTABLE_SOURCE = /\.(ts|tsx|js|mjs)$/;
const STRYKER = join(REPO_ROOT, "node_modules", "@stryker-mutator", "core", "bin", "stryker.js");

/** Runtime state, secrets and build output a test run never needs in the sandbox. */
export const SANDBOX_IGNORE = [
  "/.env*",
  "/storage",
  "/data",
  "/dist",
  "/artifacts",
  "/capabilities",
  "/modules",
  "/.internal",
  "/.types",
  "/.claude",
];

/** Test files beside `source` named for it: `x.test.ts` and `x.<aspect>.test.ts`. */
export function siblingTests(source: string): string[] {
  const directory = dirname(source);
  const stem = basename(source, extname(source));
  return readdirSync(directory)
    .filter(
      (name) =>
        name === `${stem}.test.ts` || (name.startsWith(`${stem}.`) && name.endsWith(".test.ts")),
    )
    .sort()
    .map((name) => join(directory, name));
}

export interface MutateArgs {
  readonly source: string;
  readonly tests: readonly string[];
  readonly breakAt: number | null;
}

/** The source to mutate, repo-relative, with any `file:start-end` range Stryker narrows to. */
function sourceOf(argument: string, root: string): { source: string; range: string } {
  const range = /:\d+(?::\d+)?-\d+(?::\d+)?$/.exec(argument)?.[0] ?? "";
  const source = relative(root, resolve(root, argument.slice(0, argument.length - range.length)));
  if (!existsSync(join(root, source))) throw new Error(`no such source file: ${source}`);
  if (!MUTABLE_SOURCE.test(source)) throw new Error(`not a script Stryker can mutate: ${source}`);
  if (SANDBOX_IGNORE.some((pattern) => `/${source}`.startsWith(pattern.replace("*", ""))))
    throw new Error(`${source} is left out of the sandbox, so its tests would never see a mutant`);
  return { source, range };
}

function breakOf(argv: readonly string[]): number | null {
  const unknown = argv.find((arg) => arg.startsWith("--") && !arg.startsWith("--break="));
  if (unknown !== undefined) throw new Error(`unknown flag: ${unknown}`);
  const flag = argv.find((arg) => arg.startsWith("--break="));
  if (flag === undefined) return null;
  const breakAt = Number(flag.slice("--break=".length));
  if (!(breakAt >= 0 && breakAt <= 100)) throw new Error(`--break must be 0-100: ${flag}`);
  return breakAt;
}

export function parseArgs(argv: readonly string[], root: string): MutateArgs {
  const breakAt = breakOf(argv);
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith("--"));
  if (first === undefined)
    throw new Error("usage: bun run mutate <source file> [test files…] [--break=<score>]");
  const { source, range } = sourceOf(first, root);
  const tests =
    rest.length > 0
      ? rest.map((test) => relative(root, resolve(root, test)))
      : siblingTests(join(root, source)).map((test) => relative(root, test));
  if (tests.length === 0)
    throw new Error(`no test files named for ${source}; pass them after the source file`);
  return { source: `${source}${range}`, tests, breakAt };
}

export function strykerConfig(args: MutateArgs, workDirectory: string): Record<string, unknown> {
  return {
    testRunner: "command",
    commandRunner: {
      command: `bun scripts/memory-guard.ts bun test ${args.tests.map((test) => `./${test}`).join(" ")}`,
    },
    mutate: [args.source],
    concurrency: 1,
    coverageAnalysis: "off",
    checkers: [],
    ignorePatterns: SANDBOX_IGNORE,
    reporters: ["clear-text", "progress", "json"],
    jsonReporter: { fileName: join(workDirectory, "report.json") },
    clearTextReporter: {
      allowColor: true,
      logTests: false,
      reportMutants: true,
      reportScoreTable: true,
    },
    thresholds: { high: 90, low: 70, break: args.breakAt },
    tempDirName: join(workDirectory, "sandbox"),
    cleanTempDir: "always",
    timeoutMS: 20_000,
  };
}

/** How many mutants a Stryker JSON report holds; a run with none scored nothing. */
export function countMutants(report: unknown): number {
  const files = (report as { files?: Record<string, { mutants?: unknown[] }> } | null)?.files;
  return Object.values(files ?? {}).reduce((total, file) => total + (file.mutants?.length ?? 0), 0);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2), REPO_ROOT);
  const workDirectory = mkdtempSync(join(tmpdir(), "omni-mutate-"));
  const configPath = join(workDirectory, "stryker.conf.json");
  writeFileSync(configPath, JSON.stringify(strykerConfig(args, workDirectory), null, 2));
  console.log(`mutating ${args.source} against ${args.tests.join(", ")}`);
  // Ctrl-C reaches Stryker too; outliving it is what lets the sandbox copy be removed.
  process.on("SIGINT", () => {});
  const run = Bun.spawn(["node", STRYKER, "run", configPath], {
    cwd: REPO_ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const status = await run.exited;
  const reportPath = join(workDirectory, "report.json");
  const mutants = existsSync(reportPath)
    ? countMutants(JSON.parse(readFileSync(reportPath, "utf8")))
    : 0;
  rmSync(workDirectory, { recursive: true, force: true });
  if (status === 0 && mutants === 0) {
    console.error(`no mutants in ${args.source}: nothing was measured`);
    process.exit(1);
  }
  process.exit(status);
}
