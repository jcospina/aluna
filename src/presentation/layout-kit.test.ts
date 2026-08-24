import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

import { ALLOWED_CLASSES } from "./vocabulary.ts";

// The layout kit is the class vocabulary generated capability markup speaks. It ships
// as a real stylesheet under design/styles/ so a generated screen arranges correctly
// wherever the High Meadow manifest is loaded — the desk, the standalone documents and
// the developer previews alike — without reaching for inline `style` (ADR-0005 §4).
//
// The two control stylesheets stay two files. What this pins is the thing that made
// them look mergeable: rules in the earlier file that the later one silently overrode.

const ROOT = resolve(import.meta.dir, "../..");
const KIT = "design/styles/layout-kit.css";
const CONTROLS = "design/styles/components/controls.css";
const FORM_CONTROLS = "design/styles/components/form-controls.css";

type Rule = { selector: string; properties: string[] };

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

/**
 * Every rule in a stylesheet. At-rule preludes are dropped rather than parsed, so a
 * rule nested in one is reported under its own selector like any other.
 */
function rules(css: string): Rule[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@[a-z-]+[^{;]*\{/gi, "");
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: (match[1] ?? "").split(/\s+/).filter(Boolean).join(" "),
    properties: [...(match[2] ?? "").matchAll(/([a-z-]+)\s*:/g)].map((found) => found[1] ?? ""),
  }));
}

function selectorsOf(path: string): string[] {
  return rules(read(path)).map((rule) => rule.selector);
}

/** Every property the file declares on a selector, across all of that selector's rules. */
function propertiesOn(path: string, selector: string): string[] {
  const matching = rules(read(path)).filter((rule) => rule.selector === selector);
  if (matching.length === 0) throw new Error(`${path} declares no rule for ${selector}`);
  return matching.flatMap((rule) => rule.properties);
}

/** The class tokens a stylesheet's selectors name, `.btn--danger` included. */
function classesNamedIn(path: string): string[] {
  return [
    ...new Set(
      selectorsOf(path).flatMap((selector) =>
        [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? ""),
      ),
    ),
  ];
}

/** Every stylesheet under a directory, so a new one cannot escape the sweeps below. */
function stylesheetsUnder(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return stylesheetsUnder(path);
    return extname(entry.name) === ".css" ? [path] : [];
  });
}

function nonBlankLines(path: string): number {
  return read(path)
    .split("\n")
    .filter((line) => line.trim() !== "").length;
}

describe("the layout kit ships under design/styles", () => {
  test("is one file, in the manifest, with no second copy under public/", () => {
    expect(existsSync(join(ROOT, KIT))).toBe(true);
    expect(existsSync(join(ROOT, "public/css/primitives.css"))).toBe(false);
    expect(read("public/app.css")).not.toContain("primitives.css");

    // Below the components so its utilities win where they apply, above ink.css,
    // which is the seam where the drawn line takes over and has to stay last.
    const manifest = read("design/styles/index.css");
    const kitImport = manifest.indexOf('@import url("./layout-kit.css");');
    expect(kitImport).toBeGreaterThan(-1);
    expect(kitImport).toBeGreaterThan(manifest.indexOf('url("./components/doc.css")'));
    expect(kitImport).toBeLessThan(manifest.indexOf('url("./components/ink.css")'));
  });

  test("gives every allowed class a rule of its own", () => {
    // vocabulary.test.ts already pins the two sets equal. What it cannot see is a class
    // that only ever appears qualified — `.media-frame > img` and nothing else — which
    // would satisfy set equality while the class itself returned nothing on its own.
    const standalone = new Set(
      selectorsOf(KIT).flatMap((selector) => selector.split(",").map((part) => part.trim())),
    );
    for (const className of ALLOWED_CLASSES) {
      expect(standalone.has(`.${className}`), `.${className} has no rule of its own`).toBe(true);
    }
  });

  test("nothing else under design/styles claims `.stack`", () => {
    // `layout.css`'s page column is `.page-column`; leaving both would have given a
    // generated stack a page column's spacing with no error raised anywhere.
    const stackRule = /(^|[\s,>+~])\.stack(?![\w-])/;
    expect(selectorsOf(KIT).join("\n")).toMatch(stackRule);
    for (const file of stylesheetsUnder("design/styles").filter((path) => path !== KIT)) {
      expect(selectorsOf(file).join("\n"), `${file} claims .stack`).not.toMatch(stackRule);
    }
  });

  test("has no name the temporary shell chrome also claims", () => {
    // public/css/* is linked after the entire manifest, so a shell rule naming a kit
    // class would win outright — the one collision the move made possible.
    const kitClasses = new Set(ALLOWED_CLASSES);
    for (const file of stylesheetsUnder("public/css")) {
      for (const className of classesNamedIn(file)) {
        expect(kitClasses.has(className), `${file} claims the kit's .${className}`).toBe(false);
      }
    }
  });
});

describe("the two control stylesheets", () => {
  test("stay two files, each under the linter's 500-line ceiling", () => {
    expect(nonBlankLines(CONTROLS)).toBeLessThanOrEqual(500);
    expect(nonBlankLines(FORM_CONTROLS)).toBeLessThanOrEqual(500);
  });

  test("share one selector, and declare nothing twice on it", () => {
    const later = selectorsOf(FORM_CONTROLS);
    const shared = [...new Set(selectorsOf(CONTROLS).filter((one) => later.includes(one)))];
    // `.btn` is split between the two on purpose: type, colour and line here, fill and
    // metrics there. Every other overlap was a rule this file no longer reached.
    expect(shared).toEqual([".btn"]);

    const restated = propertiesOn(CONTROLS, ".btn").filter((property) =>
      propertiesOn(FORM_CONTROLS, ".btn").includes(property),
    );
    expect(restated, "controls.css re-declares a `.btn` property form-controls.css sets").toEqual(
      [],
    );
  });

  test("transform a button from exactly one rule, which excludes disabled itself", () => {
    // Deleting controls.css's `.btn:active` left form-controls.css's `.btn:disabled:active`
    // with nothing to suppress. One rule owns the press, and it opts disabled out.
    const pressing = [...rules(read(CONTROLS)), ...rules(read(FORM_CONTROLS))].filter(
      (rule) => rule.selector.startsWith(".btn") && rule.properties.includes("transform"),
    );
    expect(pressing.map((rule) => rule.selector)).toEqual([".btn:active:not(:disabled)"]);
  });

  test("keep no control rule the later file overrides outright", () => {
    // The dead-code defect was `.btn--*`, `.field*` and `.form*` blocks in the earlier
    // file whose every declaration the later one restated or replaced. Only the button
    // base and the chevron may name a control here now; the rest is page chrome.
    const named = classesNamedIn(CONTROLS).filter((className) =>
      /^(btn|field|form|choice|listbox)($|[-_])/.test(className),
    );
    expect(named.sort()).toEqual(["btn", "field__chevron"]);
  });
});
