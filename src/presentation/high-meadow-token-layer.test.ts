import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const TOKENS_PATH = join(ROOT, "design/styles/tokens.css");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function filesUnder(directory: string, extensions: ReadonlySet<string>): string[] {
  const absolute = join(ROOT, directory);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extensions);
    return extensions.has(extname(entry.name)) ? [path] : [];
  });
}

function tokenHex(name: string): string {
  const css = readFileSync(TOKENS_PATH, "utf8");
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(css);
  if (!match?.[1]) throw new Error(`Missing hex token --${name}`);
  return match[1];
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const red = channel((value >> 16) & 0xff);
  const green = channel((value >> 8) & 0xff);
  const blue = channel(value & 0xff);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

describe("High Meadow token-layer cutover", () => {
  test("ships one token file and no Paper & Ink token layer", () => {
    expect(existsSync(TOKENS_PATH)).toBe(true);
    expect(existsSync(join(ROOT, "public/css/tokens.css"))).toBe(false);

    const appCss = read("public/app.css");
    expect(appCss).not.toContain("tokens.css");
    for (const file of filesUnder("public/css", new Set([".css"]))) {
      // A declaration the shell bridge makes, minus the three the ink system reads
      // back off a component (design/styles/components/ink.css registers all three
      // as non-inheriting). Those are a component handing its boundary over, not a
      // token: they name no value the token layer could also be stating.
      expect(read(file).replace(/^\s*--ink-(?:hand|shadow|weight)\s*:.*$/gim, "")).not.toMatch(
        /^\s*--[a-z0-9_-]+\s*:/im,
      );
      expect(read(file)).not.toContain("--color-");
    }
    const deliveredSources = [
      ...filesUnder("public", new Set([".css", ".html", ".js"])),
      ...filesUnder("docs", new Set([".html"])),
      ...filesUnder("modules", new Set([".html"])),
    ];
    for (const file of deliveredSources) {
      expect(read(file), `${file} still consumes a retired Paper & Ink token`).not.toMatch(
        /var\(--(?:color-|border-|radius-|font-sans|space-0_5)/,
      );
      expect(read(file), `${file} still points at the deleted public font copy`).not.toContain(
        "public/fonts",
      );
    }
  });

  test("loads the High Meadow manifest before the temporary shell bridge", () => {
    const html = read("public/index.html");
    const manifest = 'href="/design/styles/index.css"';
    const shell = 'href="/static/app.css"';
    expect(html).toContain(manifest);
    expect(html.indexOf(manifest)).toBeLessThan(html.indexOf(shell));
    expect(read("public/css/shell.css")).toContain(
      'url("/design/assets/wallpaper/high-meadow.webp")',
    );
    expect(read("docs/aluna-architecture.html")).toContain('href="../design/styles/index.css"');
    expect(
      read("modules/04-explicit-loop-ii-full-crud-and-evolution/TECHNICAL-GUIDE.html"),
    ).toContain('href="../../design/styles/index.css"');
    const pagesWorkflow = read(".github/workflows/pages.yml");
    expect(pagesWorkflow).toContain("cp -R design/styles _site/design/styles");
    expect(pagesWorkflow).toContain("cp -R design/assets _site/design/assets");
  });

  test("keeps the empty Desk within one viewport and sizes only its prompt rail", () => {
    const demo = read("public/css/demo.css");
    const prompt = read("public/css/prompt.css");

    // The empty desk is the default and needs no rule at all now: the shell's content
    // area went with the window, and a window holding nothing does not exist.
    expect(demo).not.toContain(".content__active");
    expect(demo).not.toMatch(/:has\([^)]*:has\(/);
    // The bar floats in the strip rather than padding its way clear of the bottom
    // edge: it is anchored by the clearance less its own height, which is the
    // composer's min-height stated from the same two tokens just below.
    expect(prompt).toMatch(
      /\.prompt\s*\{[\s\S]*?bottom:\s*calc\(var\(--prompt-clearance\) - var\(--control-h-lg\) - var\(--space-1\)\)/,
    );
    expect(prompt).toMatch(
      /\.prompt__composer\s*\{[\s\S]*?min-height:\s*calc\(var\(--control-h-lg\) \+ var\(--space-1\)\)/,
    );
  });

  test("pins the C12 green swap and both AA label pairs", () => {
    const controls = read("design/styles/components/form-controls.css");
    const shellControls = read("public/css/components.css");
    expect(controls).toMatch(
      /\.btn--primary[\s\S]*?--btn-fill:\s*var\(--shade\)[\s\S]*?color:\s*var\(--surface\)/,
    );
    expect(controls).toMatch(
      /\.btn--secondary[\s\S]*?--btn-fill:\s*var\(--leaf\)[\s\S]*?color:\s*var\(--ink\)/,
    );
    expect(shellControls).toMatch(
      /\.btn--primary[\s\S]*?color:\s*var\(--surface\)[\s\S]*?background:\s*var\(--shade\)/,
    );
    expect(shellControls).toMatch(
      /\.btn--secondary[\s\S]*?color:\s*var\(--ink\)[\s\S]*?background:\s*var\(--leaf\)/,
    );

    const primary = contrast(tokenHex("surface"), tokenHex("shade"));
    const secondary = contrast(tokenHex("ink"), tokenHex("leaf"));
    expect(primary).toBeGreaterThanOrEqual(4.5);
    expect(secondary).toBeGreaterThanOrEqual(4.5);
    expect(primary).toBeCloseTo(5.18, 1);
    expect(secondary).toBeCloseTo(4.54, 1);
  });

  // A button is small caps, and `design/styles/components/controls.css` is where that
  // is said. The shell bridge loads after the manifest, so any size it states for
  // `.btn` silently wins — which is how the app came to set its buttons at
  // `--type-base` while the controls page specified `--caps-size`, three steps down.
  // The rule is not "no type size in the bridge" (it sets plenty, on its own
  // elements); it is that the bridge does not re-answer a question the design layer
  // has already answered for the same selector.
  test("the shell bridge does not restate the button's type size", () => {
    const design = read("design/styles/components/controls.css");
    expect(design).toMatch(/\.btn\s*\{[^}]*font-size:\s*var\(--caps-size\)/);

    const base = /(^|\n)\.btn\s*\{[^}]*\}/.exec(read("public/css/components.css"));
    expect(base, "public/css/components.css declares no bare `.btn` rule").not.toBeNull();
    expect(base?.[0]).not.toContain("font-size");
  });

  test("has settled focus/control tokens and no literal component colours", () => {
    const productSources = [
      ...filesUnder("design/styles", new Set([".css"])).filter(
        (path) => path !== "design/styles/tokens.css",
      ),
      ...filesUnder("design/scripts", new Set([".js"])).filter(
        (path) => !path.startsWith("design/scripts/data/"),
      ),
      ...filesUnder("public/css", new Set([".css"])),
      ...filesUnder("public", new Set([".js"])).filter(
        (path) => !path.startsWith("public/vendor/"),
      ),
    ];
    const literalColour =
      /#[0-9a-f]{3,8}(?![\w-])|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|device-cmyk)\(/i;

    expect(read("design/styles/tokens.css")).not.toContain("PROPOSED");
    expect(read("design/styles/components/form-controls.css")).not.toContain("PROPOSED");
    for (const file of productSources) {
      expect(read(file), `${file} declares a literal colour below the token layer`).not.toMatch(
        literalColour,
      );
    }
  });
});

test("one row height everywhere, and the prompt rail is the only thing above it", () => {
  // The design gives a field and a button the same height so a control row aligns
  // without a nudge. The shell bridge restated it as a literal — and reached for the
  // large one — so a search field rendered as tall as the prompt rail beside a
  // button twelve pixels shorter. It states no control height of its own now.
  for (const file of filesUnder("public/css", new Set([".css"]))) {
    for (const literal of ["1.75rem", "2.25rem", "2.75rem"]) {
      expect(read(file), `${file} restates a control height as ${literal}`).not.toContain(literal);
    }
  }
  // The prompt bar is deliberately the one taller input on the surface, and the only
  // rule that may reach past `--control-h` for it.
  const larger = filesUnder("public/css", new Set([".css"])).filter((file) =>
    read(file).includes("--control-h-lg"),
  );
  expect(larger).toEqual(["public/css/prompt.css"]);
});

test("keeps prompt feedback legible with the shared desk-label treatment", () => {
  const tokens = read("design/styles/tokens.css");
  const logo = read("design/styles/components/logo-contract.css");
  const prompt = read("public/css/prompt.css");

  expect(tokens).toMatch(
    /--shadow-desk-label:\s*0 1px 1px color-mix\(in srgb, var\(--ink\) 85%, transparent\),\s*0 1px 3px color-mix\(in srgb, var\(--ink\) 85%, transparent\),\s*0 2px 7px color-mix\(in srgb, var\(--ink\) 70%, transparent\);/,
  );
  expect(logo).toMatch(/\.logo-label[\s\S]*?text-shadow:\s*var\(--shadow-desk-label\)/);
  expect(prompt).toMatch(
    /\.prompt__notice[\s\S]*?font-weight:\s*600[\s\S]*?color:\s*var\(--surface\)[\s\S]*?text-shadow:\s*var\(--shadow-desk-label\)/,
  );
});
