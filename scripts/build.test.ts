// The bundle ships the one file it cannot bundle.
//
// `bun build` leaves the query worker's `new URL("./query-worker-thread.ts",
// import.meta.url)` exactly as written, so the emitted entry point looks for the thread
// beside itself. 6.2/01 recorded that as a seam that stays harmless only while nothing the
// server reaches imports the worker, and 6.3/01's `/demo/question` is what made the server
// reach it. Without the copy, `bun run start` answers a question by starting a thread that
// is not there — and no test that stops at `bun run test` would ever see it.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { WORKER_THREAD_SOURCE } from "./build.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Calling `buildPlatform` in-process resolves `.ts` specifiers differently under `bun test` and
 * fails on modules the real build bundles, so this spawns the build the way a release does.
 */
function build(outdir: string): readonly string[] {
  const result = Bun.spawnSync(["bun", join(REPO_ROOT, "scripts", "build.ts"), outdir], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return readdirSync(outdir).sort();
}

let outdir: string;

beforeEach(() => {
  outdir = mkdtempSync(join(tmpdir(), "omni-crud-build-"));
});

afterEach(() => {
  rmSync(outdir, { recursive: true, force: true });
});

describe("the production bundle", () => {
  test("emits the entry point and the worker thread beside it", () => {
    expect(build(outdir)).toEqual(["index.js", "query-worker-thread.ts"]);
  });

  test("the name the bundle asks for is the name that is there", () => {
    build(outdir);
    const bundle = readFileSync(join(outdir, "index.js"), "utf8");

    // If the bundler ever does start following this, the specifier changes and this test
    // says so rather than leaving a copy nothing reads sitting beside the bundle.
    const specifier = bundle.match(/new URL\("\.\/([^"]+)", import\.meta\.url\)/)?.[1];
    expect(specifier).toBe("query-worker-thread.ts");
    expect(existsSync(join(outdir, specifier as string))).toBe(true);
  });

  test("the copied thread has no relative dependency the copy could not resolve", () => {
    const source = readFileSync(WORKER_THREAD_SOURCE, "utf8");

    // A sibling import would silently stop the copy being enough, and not every shape that
    // does it is `import … from`, which is all the first version of this assertion matched.
    const specifiers = [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
      ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']/g),
    ].map((match) => match[1] as string);

    expect(specifiers).toContain("bun:sqlite");
    expect(specifiers.filter((specifier) => specifier.startsWith("."))).toEqual([]);
    // A dynamic reach for a computed specifier is unresolvable by inspection, so it is
    // refused rather than assessed.
    expect(source).not.toMatch(/\b(?:import|require)\s*\(\s*[^"')]/);
  });

  test("clears the outdir, so nothing stale looks shipped", () => {
    const stale = join(outdir, "left-over.js");
    writeFileSync(stale, "// from an older shape of this script");

    expect(build(outdir)).toEqual(["index.js", "query-worker-thread.ts"]);
    expect(existsSync(stale)).toBe(false);
  });
});
