// What a Handler may declare a projected column to be: every pantry type but a file, the same list
// for the runtime that checks a descriptor and the checker that compiles a Handler against it, and
// read without opening the database.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { HANDLER_CONTRACT_DECLARATIONS } from "../../builder/generated-code-check.ts";
import { FILE_FIELD_TYPES, fieldTypeSchema, isFileFieldType } from "../../registry/index.ts";
import { QUERY_RESULT_TYPES } from "./query-result-types.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const SHELL_ALIAS = "#shell/";

/** The file an import names, or `undefined` for a package, which holds no repo module. */
function importedFile(from: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) return resolve(dirname(from), specifier);
  if (specifier.startsWith(SHELL_ALIAS)) {
    return join(ROOT, "public", specifier.slice(SHELL_ALIAS.length));
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
  test("are every pantry type but a file", () => {
    expect(QUERY_RESULT_TYPES).toEqual(
      fieldTypeSchema.options.filter((type) => !isFileFieldType(type)),
    );
    for (const type of FILE_FIELD_TYPES) {
      expect(QUERY_RESULT_TYPES as readonly string[]).not.toContain(type);
    }
  });

  test("are the union a generated Handler is compiled against", () => {
    const declared = /readonly type: ([^;]+);/.exec(HANDLER_CONTRACT_DECLARATIONS)?.[1];
    expect(declared).toBe(QUERY_RESULT_TYPES.map((type) => JSON.stringify(type)).join(" | "));
  });

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
