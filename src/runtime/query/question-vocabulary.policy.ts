import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// "We built no embedding" (PLAN decisions 18 and 19; ADR-0008), pinned by absence where a record
// write goes. `question-vocabulary.test.ts` sweeps the desk and the derived artifacts.

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

/**
 * Everywhere a record write goes: the router that admits and dispatches it, the ports that
 * execute it, and the coordinator that serializes them. Where an embedding computed on save,
 * recomputed on edit and deleted on delete would have to live.
 */
const WRITE_PATH_ROOTS = ["src/runtime/router", "src/runtime/data", "src/runtime/concurrency"];

/** Every module under one root, tests, their support and policy excluded: none of them ships. */
function sourceFiles(root: string): readonly string[] {
  return readdirSync(root, { recursive: true })
    .map((entry) => join(root, String(entry)))
    .filter(
      (path) => path.endsWith(".ts") && !path.includes(".test") && !path.endsWith(".policy.ts"),
    );
}

/** What one module names, static and dynamic alike: a lazy `import()` is an import. */
function specifiersIn(path: string): readonly string[] {
  return [...readFileSync(path, "utf8").matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

describe("nothing is stored to make any of this work", () => {
  test("no module a record write passes through imports a provider", () => {
    const reaching = WRITE_PATH_ROOTS.flatMap((root) =>
      sourceFiles(join(REPO_ROOT, root))
        .filter((path) => specifiersIn(path).some((from) => from.includes("platform/provider")))
        .map((path) => path.slice(REPO_ROOT.length + 1)),
    );

    // An embedding recomputed on every save is an AI call on the write path. This catches the
    // import that would carry one into these roots, not one reached through a module they call.
    expect(reaching).toEqual([]);
  });
});
