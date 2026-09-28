import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALLOWED_CLASSES } from "./vocabulary.ts";

// design/design-system.md names the layout kit as the source of truth and the classes live in
// design/styles/layout-kit.css. The enforcer hard-codes the allow-list, so this pins the two.

function classesDefinedInLayoutKit(): Set<string> {
  const css = readFileSync(join(import.meta.dir, "../../../design/styles/layout-kit.css"), "utf8");
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectorsOnly = withoutComments.replace(/\{[^{}]*\}/g, " "); // drop declaration bodies
  const names = [...selectorsOnly.matchAll(/\.([a-z][\w-]*)/gi)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
  return new Set(names);
}

describe("class allow-list", () => {
  test("matches exactly the classes defined in the layout kit", () => {
    const fromCss = [...classesDefinedInLayoutKit()].sort();
    const fromAllowList = [...ALLOWED_CLASSES].sort();
    expect(fromAllowList).toEqual(fromCss);
  });
});
