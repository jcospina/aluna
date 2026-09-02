import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The desk ground, checked where it is declared. Three things have to hold for the
// page the Desk ships (PLAN decisions 1 and 5, design D5): the ground fills the
// viewport, the prompt bar floats over it clear of every edge and never full width,
// and the strip it reserves is one number — declared once in the token layer, read
// from there by everything that stands on it, and restated nowhere.

const ROOT = resolve(import.meta.dir, "../../../..");
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
  const match = new RegExp(
    `(?:^|[},])\\s*${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`,
  ).exec(css);
  expect(match?.[1], `no \`${selector}\` rule`).toBeDefined();
  return match?.[1] as string;
}

describe("the desk ground", () => {
  test("the wallpaper fills the viewport", () => {
    const shell = body(rules("public/css/shell.css"), ".shell");

    // 100dvh rather than 100vh: mobile browser chrome must not eat the strip, or the
    // bar floats over the fold on exactly the viewport that can least afford it.
    expect(shell).toMatch(/height:\s*100dvh/);
    expect(shell).toContain('url("/design/assets/wallpaper/high-meadow.webp")');
    expect(shell).toMatch(/background-size:\s*cover/);
  });

  test("the page is a wallpaper and a prompt bar — no header row, no wordmark", () => {
    const surfaces = [
      ...under("public", "*.html"),
      ...under("public/css", "*.css"),
      "public/app.css",
      "src/server/http/fragments.ts",
    ];
    for (const page of surfaces) {
      const source = read(page).replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g, "");
      expect(source, `${page} brings back the retired lockup`).not.toMatch(
        /wordmark|lockup|content-topbar|__brand/i,
      );
    }
  });
});

describe("the prompt bar floats", () => {
  const prompt = rules("public/css/prompt.css");

  test("it is placed against the ground rather than pinned into the flow", () => {
    expect(body(rules("public/css/shell.css"), ".content-column")).toMatch(/position:\s*relative/);
    expect(body(prompt, ".prompt")).toMatch(/position:\s*absolute/);
  });

  test("it is never full width, at any viewport the desk supports", () => {
    // Both widths are bounded and both leave ground either side. A bar welded to the
    // bottom edge is a taskbar, and D4 removed the taskbar.
    const widths = [...prompt.matchAll(/\.prompt\s*\{[^}]*?width:\s*([^;]+);/g)].map((m) =>
      (m[1] as string).trim(),
    );
    expect(widths.length).toBeGreaterThanOrEqual(2);
    for (const width of widths) {
      expect(width).toMatch(/^(?:min\(|calc\()/);
      expect(width).toContain("100% -");
    }
    for (const forbidden of [/width:\s*100%/, /inset-inline:\s*0/, /right:\s*0/]) {
      expect(body(prompt, ".prompt"), "the bar reaches an edge").not.toMatch(forbidden);
    }

    // `left: 50%` without the pull-back puts the bar's left edge at the centre and
    // its right edge off the ground entirely — bounded width and all.
    expect(body(prompt, ".prompt")).toMatch(/left:\s*50%/);
    expect(body(prompt, ".prompt"), "the bar is not pulled back to centre").toMatch(
      /transform:\s*translateX\(-50%\)/,
    );
  });

  test("the bar's whole box is the rail, so it sits inside the strip it reserves", () => {
    // Anything else in the form's flow adds its own height to a box anchored by its
    // bottom edge, which grows the bar upward past the strip and over the content
    // the strip is reserved for. The notice is therefore out of flow, and it is not
    // a hit target: nothing there is clickable.
    const notice = body(prompt, ".prompt__notice");
    expect(notice).toMatch(/position:\s*absolute/);
    expect(notice).toMatch(/bottom:\s*100%/);
    expect(notice).toMatch(/pointer-events:\s*none/);
  });

  test("the bar is placed inside the ground it is centred on", () => {
    // The centring resolves against `.content-column`; a form outside it centres on
    // the viewport instead, which is off-centre the moment a rail is on screen.
    const page = read("public/index.html");
    const column = page.indexOf('<div class="content-column">');
    const form = page.indexOf('class="prompt"');
    const columnEnd = page.indexOf("</div>", page.indexOf('class="prompt"'));
    expect(column).toBeGreaterThan(-1);
    expect(form).toBeGreaterThan(column);
    expect(columnEnd).toBeGreaterThan(form);
  });
});

describe("the clearance is one number", () => {
  const TOKENS = "design/styles/tokens.css";

  // Every shipped stylesheet and script that could hold a second copy of it.
  const SHIPPED = [
    ...under("design/styles", "**/*.css"),
    ...under("public/css", "*.css"),
    ...under("design/scripts", "**/*.js"),
    ...under("public", "*.js"),
    ...under("src/server/http", "*.ts"),
    "public/app.css",
    "public/index.html",
  ];

  test("declared once, in the token layer", () => {
    for (const path of SHIPPED) {
      const declarations = [...read(path).matchAll(/--prompt-clearance\s*:/g)].length;
      expect(declarations, `${path} declares --prompt-clearance`).toBe(path === TOKENS ? 1 : 0);
    }
    expect(read(TOKENS)).toMatch(/--prompt-clearance:\s*4\.875rem;/);
    // Registered as a `<length>`, which is what lets the script read a resolved
    // pixel value back rather than the rem literal written above.
    expect(read(TOKENS)).toMatch(/@property --prompt-clearance \{\s*syntax: "<length>";/);
  });

  test("the number is never restated — every reader reads the token", () => {
    for (const path of SHIPPED) {
      if (path === TOKENS) continue;
      expect(read(path), `${path} restates the clearance`).not.toContain("4.875rem");
    }

    // The logo grid's floor, the bar's own anchor and the window's: three surfaces,
    // one length, no two files agreeing. The shell's content area used to reserve the
    // strip as a block at the end of itself; the window took that duty with the
    // content, and reads the same number through the geometry module.
    expect(rules("design/styles/components/desk.css")).toContain("var(--prompt-clearance)");
    expect(rules("public/css/prompt.css")).toContain("var(--prompt-clearance)");
    expect(read("public/desk-window.js")).toContain("PROMPT_CLEARANCE");
    expect(read("public/css/shell.css")).not.toContain(".content::after");
  });

  // The bar is anchored by the clearance less its own height, so a clearance smaller
  // than the bar would compute a negative `bottom` and slide it off the screen. The
  // three lengths live in two files; this is what keeps the subtraction positive.
  test("the strip is deep enough to hold the bar it reserves", () => {
    const rem = (name: string): number => {
      const match = new RegExp(`--${name}:\\s*([\\d.]+)rem`).exec(
        `${read(TOKENS)}\n${read("design/styles/components/form-controls.css")}`,
      );
      expect(match?.[1], `no --${name}`).toBeDefined();
      return Number.parseFloat(match?.[1] as string);
    };
    const bar = rem("control-h-lg") + rem("space-1");
    expect(rem("prompt-clearance")).toBeGreaterThan(bar);
  });

  test("the desk's geometry script reads the token at load, literal only as fallback", () => {
    const geometry = read("design/scripts/desk-geometry.js");

    expect(geometry).toMatch(
      /PROMPT_CLEARANCE\s*=\s*readLength\(\s*root,\s*"--prompt-clearance",\s*[A-Z_]+\.clearance,?\s*\)/,
    );
    // One `getComputedStyle` per refresh rather than one per length. Every clamp on the
    // surface calls `refreshGeometry`, so four separate reads meant sixteen forced style
    // reads for a single resize tick — and as many again on every frame of a drag.
    expect(geometry.match(/getComputedStyle\(/g), "a length fetches its own style").toHaveLength(1);
    // The one place the pixel literal is allowed to appear: the fallback for a
    // stylesheet that has not applied. Anywhere else it is a second source.
    const fallbacks = [...geometry.matchAll(/\bclearance:\s*78(?![\d.])/g)].length;
    expect(fallbacks).toBe(1);
    // Not `\b78\b`: that matches inside a decimal, so an unrelated `0.78` would fail
    // this test under a message about the clearance.
    expect(geometry.replace(/const FALLBACK =[^;]+;/, "")).not.toMatch(/(?<![\d.])78(?![\d.])/);
  });
});
