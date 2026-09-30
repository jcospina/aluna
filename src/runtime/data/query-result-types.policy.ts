import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// The declarable query-result types are read without opening the database: the checker that
// compiles a Handler imports them, and `query-result-types.test.ts` proves what they are.

const ROOT = resolve(import.meta.dir, "../../..");
const SHELL_ALIAS = "#shell/";
const DESIGN_ALIAS = "#design/";

/** The file an import names, or `undefined` for a package, which holds no repo module. */
function importedFile(from: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier);
  if (specifier.startsWith(SHELL_ALIAS)) {
    return join(ROOT, "public", specifier.slice(SHELL_ALIAS.length));
  }
  if (specifier.startsWith(DESIGN_ALIAS)) {
    return join(ROOT, "design/scripts", specifier.slice(DESIGN_ALIAS.length));
  }
  return undefined;
}

/** Every module `entry` imports for a value, followed transitively; type-only imports vanish. */
function valueImportGraph(entry: string): ReadonlySet<string> {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const visit = (file: string | undefined): void => {
    if (file === undefined || seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      visit(importedFile(file, path));
    }
  };
  visit(join(ROOT, entry));
  return seen;
}

describe("the declarable query-result types", () => {
  test("reach the generated-code checker without a module graph that opens the database", () => {
    for (const entry of [
      "src/runtime/data/query-result-types.ts",
      "src/builder/generated-code-check.ts",
    ]) {
      const graph = [...valueImportGraph(entry)].map((file) => file.slice(ROOT.length + 1));
      expect(graph).toContain("src/runtime/data/query-result-types.ts");
      expect(graph).not.toContain("src/platform/persistence/db.ts");
    }
  });
});
