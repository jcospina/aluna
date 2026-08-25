import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The logo layer, checked where it is declared. With no taskbar the logos are the only
// standing list of what exists, so three things have to hold (PLAN decisions 3 and 4,
// design D4): they flow down a column and wrap to the next, so the desk's own height
// decides how many stand rather than a number written into a stylesheet; the phone form
// resets to row flow explicitly rather than inheriting the column flow through the media
// query; and nothing on the page gates an empty desk.

const ROOT = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Every file of one kind under a directory, as repo-relative paths. */
const under = (directory: string, pattern: string): string[] =>
  [...new Bun.Glob(pattern).scanSync({ cwd: join(ROOT, directory) })].map((name) =>
    join(directory, name),
  );

/** A stylesheet with its comments stripped — a rule is what the browser sees. */
const rules = (path: string) => read(path).replace(/\/\*[\s\S]*?\*\//g, "");

/** One rule's body, by exact selector. Flat: nesting is not used in these sheets. */
function body(css: string, selector: string): string {
  return bodies(css, selector)[0] as string;
}

/** One rule's body, by exact selector, in source order. */
function bodies(css: string, selector: string): string[] {
  const pattern = new RegExp(
    `(?:^|[},])\\s*${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  const found = [...css.matchAll(pattern)].map((match) => match[1] as string);
  expect(found.length, `no \`${selector}\` rule`).toBeGreaterThan(0);
  return found;
}

const DESK = rules("design/styles/components/desk.css");
const LAYER = bodies(DESK, ".desk__logos");

describe("the logo layer", () => {
  test("logos fill down a column and wrap to the next", () => {
    const desktop = LAYER[0] as string;
    expect(desktop).toMatch(/grid-auto-flow:\s*column/);
    // The row count is derived from the layer's own bounded height rather than written
    // down. `repeat(2, 96px)` was the mockup shortcut that put a ceiling of about eleven
    // on a product whose premise is "make as many tools as you want".
    expect(desktop).toMatch(/grid-template-rows:\s*repeat\(\s*auto-fill/);
    expect(desktop).toMatch(/grid-auto-columns:\s*var\(--logo-cell-w\)/);
    expect(desktop).not.toMatch(/grid-template-columns:\s*repeat\(\s*\d/);
  });

  test("it is bounded top and bottom, and its floor is the strip the prompt bar reserves", () => {
    // Both edges are what makes `auto-fill` mean anything: an unbounded box fits one
    // column of any length, and the tail of it would sit under the bar.
    const desktop = LAYER[0] as string;
    expect(desktop).toMatch(/position:\s*absolute/);
    const inset = /inset:\s*([^;]+);/.exec(desktop)?.[1] ?? "";
    expect(inset).toContain("var(--prompt-clearance)");
    expect(inset).not.toContain("auto auto");
  });

  test("the phone form resets to row flow explicitly, inside the phone query", () => {
    // Not by omission. A media query that only narrows the box leaves `grid-auto-flow:
    // column` in force, and the phone gets a sideways home screen. Located by the query it
    // must live in rather than by being last in the file, so moving a rule cannot quietly
    // turn this into an assertion about the desktop one.
    const query = /@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*)\}/.exec(DESK)?.[1] ?? "";
    expect(query, "no phone breakpoint").not.toBe("");
    const phone = bodies(query, ".desk__logos")[0] as string;
    expect(phone).toMatch(/grid-auto-flow:\s*row/);
    expect(phone).toMatch(/grid-template-rows:\s*none/);
    expect(phone).toMatch(/grid-template-columns:\s*repeat\(\s*auto-fill/);
    expect(phone).toMatch(/position:\s*static/);
  });

  test("the layer takes no press of its own", () => {
    // It is as tall as the desk holding one logo or twenty, and it is placed over the
    // content region. Without this it is an invisible column-wide dead strip down the
    // left of everything a capability shows.
    expect(LAYER[0] as string).toMatch(/pointer-events:\s*none/);
    expect(bodies(DESK, ".logo")[0] as string).toMatch(/pointer-events:\s*auto/);
  });

  test("the shipped page inherits the layout rather than restating it", () => {
    // The rules above are the design's. This is what makes them the product's: the page
    // loads the manifest they ship in, and the layer is inside the one positioned box on
    // the page — without which `position: absolute` resolves against the viewport and the
    // logos stop keeping to the ground.
    const shell = read("public/index.html");
    expect(shell).toContain('<link rel="stylesheet" href="/design/styles/index.css">');
    expect(read("design/styles/index.css")).toContain("./components/desk.css");
    const column = shell.indexOf('<div class="content-column">');
    const layer = shell.indexOf('<div class="desk__logos" id="capability-logos">');
    expect(column).toBeGreaterThan(-1);
    expect(layer).toBeGreaterThan(column);
    expect(body(rules("public/css/shell.css"), ".content-column")).toMatch(/position:\s*relative/);
  });

  test("the tile's size, corner, shadow and name are declared once, by the contract", () => {
    // The shell adds the corner, the shadow, the size and the name and never anything
    // inside the file (ADR-0007). One copy of those numbers, and the product loads the
    // same file the specimens on `logo.html` stand on.
    const contract = rules("design/styles/components/logo-contract.css");
    const tile = bodies(contract, ".logo-tile")[0] as string;
    expect(tile).toMatch(/width:\s*64px/);
    expect(tile).toMatch(/border-radius:\s*10%/);
    expect(tile).toMatch(/box-shadow:\s*3px 4px 0 /);
    expect(bodies(contract, ".logo-label")[0]).toMatch(/text-shadow:\s*var\(--shadow-desk-label\)/);

    // And the shadow resolves where the tile actually stands. `ink.css` registers three
    // names as non-inheriting `@property`s so a drawn boundary's shadow cannot reach what
    // it encloses; below `:root` those names resolve to nothing, and a `box-shadow` built
    // on one is invalid — which is to say the tile casts nothing at all. The tile is not a
    // drawn boundary and must not read from that channel.
    const nonInheriting = [
      ...rules("design/styles/components/ink.css").matchAll(
        /@property\s+(--[a-z-]+)\s*\{[^}]*inherits:\s*false/g,
      ),
    ].map((match) => match[1] as string);
    expect(nonInheriting).toContain("--ink-shadow");
    for (const name of nonInheriting) {
      expect(tile, `the tile's shadow reads ${name}, which does not reach it`).not.toContain(
        `var(${name})`,
      );
    }

    // And the shipped shell restates none of them.
    for (const sheet of ["public/app.css", ...under("public/css", "*.css")]) {
      expect(rules(sheet), `${sheet} restates the logo contract`).not.toMatch(
        /\.logo-tile|\.logo-label|\.desk__logos/,
      );
    }
  });

  test("a capability with no artwork gets the designed placeholder, not a hole", () => {
    // The placeholder is a first-class state, not a loading failure: it works while a
    // build runs and rests afterwards, and until 5.5 lands it is every tile there is.
    expect(DESK).toMatch(/\.logo-tile--pending\s*\{/);
    expect(bodies(DESK, ".logo-tile--pending")[0]).toMatch(/repeating-linear-gradient/);
    expect(DESK).toMatch(/\.logo-tile--working\s*\{/);
    // The animation is behind the reduced-motion guard, like every other one.
    const working = DESK.indexOf(".logo-tile--working");
    const guard = DESK.lastIndexOf("prefers-reduced-motion", working);
    expect(guard).toBeGreaterThan(-1);
  });
});

describe("an empty desk needs no gate", () => {
  test("nothing on the shipped page hides itself until a capability appears", () => {
    // The rail is gone, and so is the state it hid behind: `hasCapabilities`, the
    // `has-capabilities` class, and the `[data-capability-entry]` marker the shell used
    // to infer "this user is new" from.
    const surfaces = [
      ...under("public", "*.html"),
      ...under("public", "*.js"),
      ...under("public/css", "*.css"),
      "public/app.css",
      "src/web/fragments.ts",
    ];
    for (const page of surfaces) {
      const source = read(page).replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      expect(source, `${page} brings back the capability gate`).not.toMatch(
        /has-?[Cc]apabilities|data-capability-entry/,
      );
    }
  });

  test("the capability toolbar and its stylesheet are gone from the codebase", () => {
    expect(() => read("public/css/toolbar.css")).toThrow();
    const shell = read("public/index.html");
    expect(shell).not.toMatch(/class="toolbar"|id="capability-toolbar"/);
    // The layer that replaced it is always on the page, empty desk included: it is where
    // the first commit's sidecar lands.
    expect(shell).toContain('<div class="desk__logos" id="capability-logos">');
  });
});
