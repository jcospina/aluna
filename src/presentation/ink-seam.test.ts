import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The seam between the stylesheet and the ink runtime, checked where it is declared
// rather than where it is drawn. Four things have to hold for a drawn surface: the
// runtime ships with the page; `ink.css` stays last; nothing outranks `.is-ink` from a
// heavier selector; and no rule asks a question — `:empty`, `:only-child` — that the
// two SVG layers have already answered.

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const INK_SEAM = "components/ink.css";
const SHELL_SHEETS = readdirSync(join(ROOT, "public/css"))
  .filter((name) => name.endsWith(".css"))
  .map((name) => `public/css/${name}`);
const SHELL_PAGES = readdirSync(join(ROOT, "public")).filter((name) => name.endsWith(".html"));

interface Rule {
  readonly source: string;
  readonly selector: string;
  readonly body: string;
}

/** Every rule in a stylesheet, comments stripped. Flat: nesting is not used here. */
function rules(source: string, css: string): Rule[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .filter((chunk) => chunk.includes("{"))
    .map((chunk) => {
      const cut = chunk.lastIndexOf("{");
      return {
        source,
        selector: (chunk.slice(0, cut).split("}").pop() as string).replace(/\s+/g, " ").trim(),
        body: chunk.slice(cut + 1),
      };
    });
}

/** The shell bridge, plus the inline stylesheets its own preview pages carry. */
function shellRules(): Rule[] {
  const sheets = SHELL_SHEETS.map((path) => rules(path, read(path)));
  const inline = SHELL_PAGES.flatMap((page) =>
    [...read(`public/${page}`).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) =>
      rules(`public/${page}`, match[1] as string),
    ),
  );
  return [...sheets, ...inline].flat();
}

/** The quoted selectors of one `[...].join(",")` list. */
function selectorList(source: string, marker: string): string[] {
  const start = source.indexOf(marker);
  expect(start, `missing selector list: ${marker}`).toBeGreaterThan(-1);
  const body = source.slice(start, source.indexOf("].join", start));
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
}

const DRAWN = new Set([
  ...selectorList(read("design/scripts/ink.js"), "export const INK_SELECTOR = ["),
  ...selectorList(read("public/ink.js"), "const SHELL_INK = ["),
]);

/** A modifier is drawn by its base: `.btn--danger` is a `.btn`. */
const isDrawnClass = (name: string) =>
  DRAWN.has(`.${name}`) || DRAWN.has(`.${name.split("--")[0]}`);

const classesIn = (compound: string) =>
  [...compound.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((match) => match[1] as string);

/** The compound a selector is about: what it would match, states and all. */
const subjectOf = (selector: string) =>
  selector
    .trim()
    .split(/[\s>+~]+/)
    .pop() as string;

/**
 * How hard a selector presses, next to `.is-ink`'s single class. Functional arguments
 * are dropped, which can only under-count — a rule this calls light is light.
 */
function outranksTheSeam(selector: string): boolean {
  const bare = selector.replace(/\(([^()]*)\)/g, "");
  const ids = (bare.match(/#[a-zA-Z0-9_-]+/g) ?? []).length;
  const classish =
    (bare.match(/\.[a-zA-Z0-9_-]+/g) ?? []).length +
    (bare.match(/\[[^\]]*\]/g) ?? []).length +
    (bare.match(/:(?!:)[a-zA-Z-]+/g) ?? []).length;
  return ids > 0 || classish > 1;
}

/**
 * Reserved by a stylesheet and never drawn. Each one is a boundary this issue does not
 * reach, and each says what reaches it.
 */
const RULED_ON_PURPOSE = new Set([
  // the generated record card — 5.2/02 seeds it from the record id
  "capability-item",
  // still the bare <input>; the shell-and-input split is 5.10/03
  "field__control",
  // a spinning circle: the shape of an object, not a boundary
  "capability-search__loading",
  // text payloads hidden by `:empty`, which a drawn element can never be — 5.6/04
  "spec-build__preview",
  // this page's own furniture, deliberately named apart from the drawn `.swatch`
  "preview-item",
  "preview-swatch",
]);

describe("the ink seam holds in the shipped product", () => {
  test("both manifests end with the seam", () => {
    const design = read("design/styles/index.css");
    expect(design.trimEnd().endsWith(`@import url("./${INK_SEAM}");`)).toBe(true);

    // The shell bridge loads after that manifest and declares borders of its own, so
    // the product's cascade has to end with the seam too or the border wins.
    const imports = [...read("public/app.css").matchAll(/@import\s+(?:url\()?["']([^"')]+)/g)].map(
      (match) => match[1] as string,
    );
    expect(imports.at(-1)).toContain(INK_SEAM);
  });

  test("every page that loads the shell bridge loads the ink runtime", () => {
    const surfaces = [
      ...SHELL_PAGES.map((page) => `public/${page}`),
      "src/builder/units/few-shot-gallery-preview.ts",
    ];
    for (const surface of surfaces) {
      const source = read(surface);
      if (!source.includes("/static/app.css")) continue;
      expect(source, `${surface} draws what the bridge reserves`).toContain(
        '<script type="module" src="/static/ink.js"></script>',
      );
    }
  });

  test("every boundary the shell reserves is one the ink system draws", () => {
    for (const { source, selector, body } of shellRules()) {
      const declared = /(^|;|\s)border:\s*([^;}]+)/.exec(body)?.[2]?.trim();
      if (!declared || declared === "0") continue;
      const covered = selector
        .split(",")
        .every((one) =>
          classesIn(subjectOf(one)).some(
            (name) => isDrawnClass(name) || RULED_ON_PURPOSE.has(name),
          ),
        );
      expect(covered, `${source}: \`${selector}\` reserves a line nothing draws`).toBe(true);
    }
  });

  test("nothing paints a border back from a selector heavier than `.is-ink`", () => {
    const drawsOn = (one: string) =>
      classesIn(subjectOf(one)).some((name) => isDrawnClass(name) && !RULED_ON_PURPOSE.has(name));
    const heavy = shellRules()
      .filter(
        ({ body }) => /(^|;|\s)border(-\w+)*-?color?:/.test(body) || /(^|;|\s)border:/.test(body),
      )
      .flatMap(({ source, selector }) =>
        selector
          .split(",")
          // An inline `<style>` always follows the linked sheets, so on a page that
          // loads the bridge it does not even need to outrank the seam to beat it.
          .filter((one) => drawsOn(one) && (outranksTheSeam(one) || source.endsWith(".html")))
          .map((one) => `${source}: ${one.trim()}`),
      );
    // Each of these would paint a true edge back beside the drawn one, because
    // `.is-ink` recolours the border at one class of specificity and loses to more.
    expect(heavy).toEqual([]);
  });

  test("no rule asks a drawn element whether it is empty", () => {
    for (const { source, selector } of shellRules()) {
      expect(
        selector,
        `${source}: a drawn element's children are never \`:only-child\` — the ink ` +
          "system's two layers are its siblings. Ask past them instead.",
      ).not.toContain(":only-child");
      for (const one of selector.split(/[\s>+~,]+/)) {
        if (!one.includes(":empty")) continue;
        const drawn = classesIn(one).some((name) => isDrawnClass(name));
        expect(
          drawn,
          `${source}: \`${one}\` — a drawn element is never \`:empty\`, because the ` +
            "two ink layers are children of it",
        ).toBe(false);
      }
    }
  });

  test("no component asks for a weight, because there is no weight ladder", () => {
    for (const sheet of [...SHELL_SHEETS, "public/app.css"]) {
      expect(read(sheet)).not.toContain("--ink-weight");
    }
  });
});
