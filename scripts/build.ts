#!/usr/bin/env bun
/**
 * The production bundle, and the one file that cannot be inside it.
 *
 * `bun build` is the whole of the bundle. What it does not do is follow
 * `new Worker(new URL("./query-worker-thread.ts", import.meta.url).href)` in
 * `src/runtime/query/query-worker.ts`: the specifier is emitted exactly as written, so a
 * bundled entry point looks for the query worker's thread *beside itself* rather than in
 * `src/`. 6.2/01 measured that and recorded it as a seam that stays open only while
 * nothing the server reaches imports the worker. 6.3/01 is what made the server reach it —
 * `/demo/question` reaches the worker, and 6.3/02 turned that one turn into the loop — so
 * the thread is copied beside the bundle here.
 *
 * It is copied rather than bundled, and as TypeScript rather than as JavaScript, because
 * the URL in the bundle names `./query-worker-thread.ts` and Bun runs that file directly.
 * The copy is self-contained by construction: the thread imports `bun:sqlite` and nothing
 * else, which `build.test.ts` asserts rather than trusts — a relative import added to it
 * would arrive here as a module the copy cannot resolve.
 */

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const BUILD_ENTRY_POINT = join(REPO_ROOT, "src", "index.ts");
/** Copied beside the bundle; the worker URL in the bundle names it by this basename. */
export const WORKER_THREAD_SOURCE = join(
  REPO_ROOT,
  "src",
  "runtime",
  "query",
  "query-worker-thread.ts",
);

export interface BuildResult {
  readonly outdir: string;
  readonly outputs: readonly string[];
}

export async function buildPlatform(outdir: string): Promise<BuildResult> {
  // Cleared, not merged. `bun build` overwrites what it emits and leaves everything else, so
  // a file from an older shape of this script — a stale chunk, a worker thread that moved —
  // would sit in `dist/` looking shipped. What is deployed should be what this run produced.
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });

  const result = await Bun.build({
    entrypoints: [BUILD_ENTRY_POINT],
    outdir,
    target: "bun",
    define: { "process.env.NODE_ENV": '"production"' },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("bun build failed");
  }

  const thread = join(outdir, basename(WORKER_THREAD_SOURCE));
  copyFileSync(WORKER_THREAD_SOURCE, thread);

  return {
    outdir,
    outputs: [...result.outputs.map((artifact) => artifact.path), thread],
  };
}

if (import.meta.main) {
  const outdir = process.argv[2] ?? join(REPO_ROOT, "dist");
  const { outputs } = await buildPlatform(outdir);
  for (const output of outputs) console.log(output);
}
