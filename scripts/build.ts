#!/usr/bin/env bun
/**
 * The production bundle, and the one file that cannot be inside it.
 *
 * `bun build` emits `new Worker(new URL("./query-worker-thread.ts", import.meta.url).href)`
 * from `src/runtime/query/query-worker.ts` exactly as written, so the bundled entry point
 * looks for the query worker's thread beside itself rather than in `src/`. 6.2/01 recorded
 * that seam; the question path the prompt bar reaches (6.5/03) runs every statement in that
 * worker, so the thread is copied here.
 *
 * It is copied as TypeScript rather than bundled, because the URL in the bundle names
 * `./query-worker-thread.ts` and Bun runs that file directly. The copy stays self-contained
 * only while the thread imports `bun:sqlite` and nothing else, which `build.test.ts` asserts.
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
  // `bun build` overwrites what it emits and leaves everything else, so a stale chunk or a
  // worker thread that moved would sit in `dist/` looking shipped.
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
