import { describe, expect, test } from "bun:test";

import { code, readSource, shippedStylesheets } from "../../safety/source.test-support.ts";

// The button set, as a closed set.
//
// Seven variants, one of them unfilled, three heights and a full-width modifier. The
// design layer owns every number and every fill (`design/styles/components/form-controls.css`)
// and the product's own sheet restates the colours on top of it, because it loads after
// the manifest. What is pinned here is that the two agree on the same seven names, that
// no eighth face exists in either direction — a dropped name still spelled, or a bare
// `.btn` relying on the absence of a class — and that the sizes resolve from the one
// control-height token a field and a button share.

const VARIANTS = ["primary", "secondary", "info", "feature", "warm", "danger", "outline"] as const;

/** The three modifiers that are a metric rather than a face. */
const SIZES = ["sm", "lg", "block"];

/**
 * Every `.btn--x` a stylesheet names anywhere in a selector, sizes aside.
 *
 * Unanchored on purpose. Reading only the rules that open a line let `.card .btn--muted`
 * declare an eighth face the closure check below could not see.
 */
function variantsIn(css: string): string[] {
  return [...new Set([...css.matchAll(/\.btn--([a-z]+)/g)].map((found) => found[1] ?? ""))].filter(
    (name) => !SIZES.includes(name),
  );
}

const MANIFEST = readSource("design/styles/components/form-controls.css");
const SHELL = readSource("public/css/components.css");
const HANDBOOK = readSource("design/design-system.md");

describe("the button set", () => {
  test("is the same seven names in the design layer and in the product", () => {
    expect(variantsIn(MANIFEST).sort()).toEqual([...VARIANTS].sort());
    expect(variantsIn(SHELL).sort()).toEqual([...VARIANTS].sort());
  });

  test("is a closed set across every stylesheet that ships, not just those two", () => {
    // A variant may be *used* by any sheet; what none of them may do is introduce an
    // eighth. Asked of every shipped sheet, because a rule in a layout file is as much a
    // button face as one in the manifest.
    for (const [path, css] of shippedStylesheets()) {
      for (const variant of variantsIn(css)) {
        expect(VARIANTS as readonly string[], `${path} names .btn--${variant}`).toContain(variant);
      }
    }
  });

  test("has outline as the only unfilled one, in both", () => {
    // The manifest fills through one custom property, so "unfilled" is legible as the
    // absence of a `--btn-fill` on the variant's own rule.
    for (const variant of VARIANTS) {
      const rule = new RegExp(`^\\.btn--${variant}\\s*\\{([^}]*)\\}`, "m");
      const manifest = rule.exec(MANIFEST)?.[1] ?? "";
      const shell = rule.exec(SHELL)?.[1] ?? "";
      const filled = variant !== "outline";
      expect(manifest.includes("--btn-fill:"), `${variant} in the manifest`).toBe(filled);
      // The product sets `background` directly; outline's is the transparent one.
      expect(/background:\s*transparent/.test(shell), `${variant} in the product`).toBe(!filled);
    }
    // And the base carries no fill of its own, which is what makes outline a name for
    // something rather than a second way of spelling nothing.
    expect(MANIFEST).toMatch(/\.btn\s*\{[^}]*--btn-fill:\s*transparent/);
  });

  test("keeps no name the design system refuses, anywhere it ships", () => {
    expect(HANDBOOK).toContain("`ghost` is not a name in this system, and neither is `neutral` or");
    for (const [path, css] of shippedStylesheets()) {
      for (const refused of ["btn--ghost", "btn--neutral", "btn--default"]) {
        expect(css, `${path} declares .${refused}`).not.toContain(refused);
      }
    }
  });

  test("resolves its three heights and its full width from the control-height token", () => {
    expect(MANIFEST).toMatch(/\.btn\s*\{[^}]*min-height:\s*var\(--control-h\)/);
    expect(MANIFEST).toMatch(/\.btn--sm\s*\{[^}]*min-height:\s*var\(--control-h-sm\)/);
    expect(MANIFEST).toMatch(/\.btn--lg\s*\{[^}]*min-height:\s*var\(--control-h-lg\)/);
    expect(MANIFEST).toMatch(/\.btn--block\s*\{[^}]*width:\s*100%/);
    // The product states none of the four. It loads after the manifest, so restating one
    // would not duplicate it — it would silently defeat the modifier. Asked of the rules
    // rather than the file, because the comment there explains exactly this.
    const shellRules = code(SHELL);
    for (const size of SIZES) {
      expect(shellRules, `public/css/components.css restates .btn--${size}`).not.toContain(
        `btn--${size}`,
      );
    }
    expect(shellRules).not.toMatch(/\.btn\s*\{[^}]*min-height/);
  });
});

describe("every button the product renders", () => {
  /** Every `class="btn …"` in shipped markup, preview surfaces included. */
  function renderedButtons(): string[] {
    const under = (root: string, pattern: string): string[] =>
      [...new Bun.Glob(pattern).scanSync({ cwd: root })].map((name: string) => `${root}/${name}`);
    // The design pages included. They are where the set is authored, so a bare `.btn` in
    // the gallery is the rule being broken by the page that states it.
    const sources = [
      ...under("src", "**/*.{ts,js,html}"),
      ...under("public", "*.{js,html}"),
      ...under("design", "*.html"),
    ].filter((path) => !path.endsWith(".test.ts") && !path.includes(".test-support."));
    // `\bbtn\b` anywhere in the list rather than `btn` at the front: `class="field-list__action
    // btn"` is the same button, and matching only the leading token meant the row actions
    // this epic adds could drop every modifier with nothing failing.
    return sources.flatMap((path) =>
      [...readSource(path).matchAll(/class="([^"]*\bbtn\b[^"]*)"/g)].map((found) => found[1] ?? ""),
    );
  }

  test("names one of the seven rather than relying on the absence of a class", () => {
    const buttons = renderedButtons();
    expect(buttons.length).toBeGreaterThan(0);
    for (const classes of buttons) {
      const named = classes.split(/\s+/).filter((one) => one.startsWith("btn--"));
      const variants = named.filter((one) => VARIANTS.some((v) => one === `btn--${v}`));
      expect(variants, `"${classes}" names no variant`).toHaveLength(1);
      // The rest may only be a size or a placement class, never a second face.
      for (const modifier of named) {
        const known =
          variants.includes(modifier) || ["btn--sm", "btn--lg", "btn--block"].includes(modifier);
        expect(known, `"${classes}" carries an unknown ${modifier}`).toBe(true);
      }
    }
  });
});
