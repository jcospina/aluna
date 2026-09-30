// Everything under `public/` is served to a browser verbatim — no transpile, no bundler, no
// import map (the no-build rule, `public/app.js`). So a specifier that only a package resolver
// understands is not a style question here: the browser cannot fetch it, the module never
// loads, and every module that imports it dies with it.
//
// This is written down because the repo's own toolchain cannot see it. `tsconfig` maps
// `#design/*` and `#shell/*`, and every test imports through Bun, which honours `package.json`
// `imports`, so typecheck, lint and the whole suite pass green on a desk that is dead on
// arrival. It cost exactly that once: a module lifted out of `desk-window.js` kept the
// `#design/desk/desk-geometry.js` specifier, and left a desk where no logo opened.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { elementsOf, scriptsOf } from "../../server/http/served-page.test-support.ts";
import { shellScripts } from "../safety/source.test-support.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const SHELL = readFileSync(join(ROOT, "public/index.html"), "utf8");

/**
 * The page's classic scripts, in load order. The vendored builds are bundles that set the
 * `htmx` and `Alpine` globals, and `app.js` is the glue that reads them; none holds an `import` or
 * `export`. Every other shell script imports, and a classic tag makes that a SyntaxError.
 */
const CLASSIC = [
  "/static/vendor/htmx.min.js",
  "/static/vendor/htmx-ext-sse.min.js",
  "/static/app.js",
  "/static/vendor/alpine.min.js",
];

/** Every `from "…"` in one module, import and re-export alike. */
function specifiersIn(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(([, specifier]) => specifier ?? "");
}

describe("what a shipped module is allowed to import", () => {
  test("every specifier is one a browser can fetch on its own", () => {
    for (const [name, source] of shellScripts()) {
      for (const specifier of specifiersIn(source)) {
        // A relative URL, and nothing else. `#…` is `package.json` `imports` and a bare name is
        // a node_modules lookup; both resolve in Bun and neither resolves in a browser.
        expect(
          specifier.startsWith("./") || specifier.startsWith("../"),
          `${name} → ${specifier}`,
        ).toBe(true);
        // And it names a file. A browser does no extension resolution either.
        expect(specifier.endsWith(".js"), `${name} → ${specifier}`).toBe(true);
      }
    }
  });

  test("every shell script the page loads is a module, except the classic four", async () => {
    const scripts = scriptsOf(await elementsOf(SHELL)).filter(({ src }) =>
      src.startsWith("/static/"),
    );
    expect(scripts.filter(({ type }) => type !== "module").map(({ src }) => src)).toEqual(CLASSIC);
    for (const src of CLASSIC) {
      const source = readFileSync(join(ROOT, "public", src.slice("/static/".length)), "utf8");
      expect(source, src).not.toMatch(/^\s*(?:import|export)\b/m);
    }
  });

  test("every module the shell mounts is a file that exists", () => {
    const mounted = [...SHELL.matchAll(/<script type="module" src="\/static\/([^"]+)"><\/script>/g)]
      .map(([, file]) => file ?? "")
      .sort();
    expect(mounted.length).toBeGreaterThan(0);
    for (const file of mounted) {
      expect(() => readFileSync(join(ROOT, "public", file), "utf8")).not.toThrow();
    }
  });

  test("and every module a shipped module reaches for is a file that exists", () => {
    for (const [name, source] of shellScripts()) {
      for (const specifier of specifiersIn(source)) {
        const target = resolve(ROOT, "public", dirname(name), specifier);
        expect(() => readFileSync(target, "utf8"), `${name} → ${specifier}`).not.toThrow();
      }
    }
  });
});
