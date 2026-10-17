import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Every relation change goes through the relation diff, so the work it
// maps a change to is used by the diff's executor alone, whoever makes the change.

const SRC = join(import.meta.dir, "..", "..", "..", "..");

const EXECUTOR = "runtime/data/links/relation-diff/relation-diff.ts";

const SCAN = "runtime/data/links/matching-scan.ts";

/**
 * Each piece of relation work, the module that defines it, and every other module that may use it:
 * the executor, the matching scan, which forgets a field's rows before it matches the field again,
 * and the startup's matching of fields linked before.
 */
const RELATION_WORK: readonly (readonly [string, string, readonly string[]])[] = [
  ["writeCapabilityRelations", "registry/store/store.ts", [EXECUTOR]],
  ["removeRelationsTo", "registry/store/store.ts", [EXECUTOR]],
  ["deleteCapabilityLinkRows", "platform/links/link-table.ts", [EXECUTOR]],
  ["deleteFieldLinkRows", "platform/links/link-table.ts", [EXECUTOR, SCAN]],
  ["matchTypedNames", SCAN, [EXECUTOR]],
  ["matchUnlinkedNames", SCAN, [EXECUTOR, "lifecycle/link/matching/match-at-startup.ts"]],
  ["reviveLinkedText", "runtime/data/links/linked-text.ts", [EXECUTOR]],
];

/** Every module that ships, by its path under `src/`, with its text. */
function shippedModules(): readonly { readonly path: string; readonly text: string }[] {
  return readdirSync(SRC, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith(".ts"))
    .filter((path) => !path.includes(".test") && !path.endsWith(".policy.ts"))
    .map((path) => ({ path, text: readFileSync(join(SRC, path), "utf8") }));
}

/**
 * How often a module's code names `name`: a call, an import, an alias, a value passed. Comments and
 * strings are no use of it, and nor is a barrel's re-export under the same name, which only hands
 * it on; one under another name is a use, since its importers would pass unseen.
 */
function mentions(path: string, text: string, name: string): number {
  if (!text.includes(name)) return 0;
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        count += node.exportClause.elements.filter(renames(name)).length;
      }
      return;
    }
    if (ts.isIdentifier(node) && node.text === name) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(path, text, ts.ScriptTarget.Latest));
  return count;
}

/** Whether a re-export hands `name` on under another name. */
function renames(name: string): (specifier: ts.ExportSpecifier) => boolean {
  return (specifier) => specifier.propertyName?.text === name;
}

describe("relation work is used where the relation diff's work is done, and nowhere else", () => {
  const modules = shippedModules();

  test.each(RELATION_WORK)("%s", (name, home, users) => {
    const using = modules
      .filter(({ path, text }) => path !== home && mentions(path, text, name) > 0)
      .map(({ path }) => path);
    expect(using.sort()).toEqual([...users].sort());
    const defined = modules.find(({ path }) => path === home);
    expect(defined && mentions(defined.path, defined.text, name)).toBe(1);
  });
});
