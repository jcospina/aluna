import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { Glob } from "bun";

// The engine is the platform's one evolution path (`evolution-faults.test.ts` runs its fault
// model). These hold the tree to that: the retired seam stays gone and nothing else publishes.

const ROOT = resolve(import.meta.dir, "../../../..");

/** Every source path under the given repo-relative roots, with its text, however it is run. */
async function sourceFiles(
  roots: readonly string[],
  pattern: string,
): Promise<{ path: string; text: string }[]> {
  const files: { path: string; text: string }[] = [];
  for (const root of roots) {
    for await (const file of new Glob(pattern).scan({ cwd: join(ROOT, root) })) {
      const path = join(root, file);
      files.push({ path, text: await Bun.file(join(ROOT, path)).text() });
    }
  }
  expect(files.length, `nothing under ${roots.join(", ")} matched ${pattern}`).toBeGreaterThan(0);
  return files;
}

describe("the engine is the only evolution path", () => {
  test("the 4.5 hand-authored regenerate-all seam is gone from the tree", async () => {
    const files = await sourceFiles(["src", "public", "scripts"], "**/*.{ts,js,html,css,json}");
    const seam = /hand-authored|handAuthored|hand_authored|v2-tracer|v2Tracer/i;
    const hits = files
      // This file names the seam in order to assert its absence.
      .filter((file) => !file.path.endsWith("evolution-faults.policy.ts"))
      .filter((file) => seam.test(file.text))
      .map((file) => file.path);
    expect(hits).toEqual([]);
  });

  test("exactly two non-test modules publish a capability snapshot: v1 and evolution", async () => {
    const files = await sourceFiles(["src"], "**/*.ts");
    const callers = files
      // The definition site and the barrels that re-export it are not call sites.
      .filter((file) => !file.path.includes(".test") && !file.path.endsWith(".policy.ts"))
      .filter((file) => !file.path.startsWith(join("src", "builder", "artifacts")))
      .filter((file) => !file.path.endsWith("index.ts"))
      .filter((file) => file.text.includes("publishCapabilitySnapshot("))
      .map((file) => file.path)
      .sort();
    expect(callers).toEqual([
      join("src", "pipeline", "build", "build-run.ts"),
      join("src", "pipeline", "evolution", "run", "evolution-run.ts"),
    ]);
  });
});
