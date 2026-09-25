import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALLOWED_CLASSES, ALLOWED_ELEMENTS, isSafeAttr, REMOVED_ELEMENTS } from "./vocabulary.ts";

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

describe("element sets", () => {
  test("presentational elements are allowed", () => {
    for (const tag of ["div", "span", "p", "ul", "li", "img", "figure", "time", "strong"]) {
      expect(ALLOWED_ELEMENTS.has(tag)).toBe(true);
    }
  });

  test("interactive elements are neither allowed nor removed-with-content (they unwrap)", () => {
    for (const tag of ["a", "button", "input", "form", "select", "label", "details"]) {
      expect(ALLOWED_ELEMENTS.has(tag)).toBe(false);
      expect(REMOVED_ELEMENTS.has(tag)).toBe(false);
    }
  });

  test("script / foreign / embedding elements are removed with their content", () => {
    for (const tag of ["script", "style", "svg", "math", "iframe", "template", "object"]) {
      expect(REMOVED_ELEMENTS.has(tag)).toBe(true);
      expect(ALLOWED_ELEMENTS.has(tag)).toBe(false);
    }
  });
});

describe("isSafeAttr", () => {
  test("keeps global, aria, and element-specific attributes", () => {
    expect(isSafeAttr("div", "title")).toBe(true);
    expect(isSafeAttr("span", "aria-label")).toBe(true);
    expect(isSafeAttr("img", "alt")).toBe(true);
    expect(isSafeAttr("time", "datetime")).toBe(true);
  });

  test("drops handlers, identity, and cross-element attributes by default-deny", () => {
    expect(isSafeAttr("div", "onclick")).toBe(false);
    expect(isSafeAttr("div", "id")).toBe(false);
    expect(isSafeAttr("div", "name")).toBe(false);
    expect(isSafeAttr("div", "href")).toBe(false);
    expect(isSafeAttr("div", "datetime")).toBe(false); // only valid on <time>/<ins>/<del>
    expect(isSafeAttr("span", "src")).toBe(false); // only valid on media elements
  });
});
