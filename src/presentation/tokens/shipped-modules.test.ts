import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { shellScripts } from "../safety/source.test-support.ts";

// Everything under `public/` is served to a browser **verbatim** — no transpile, no
// bundler, no import map (the no-build rule, `public/app.js`). So a specifier that only
// a package resolver understands is not a style question here: the browser cannot fetch
// it, the module never loads, and every module that imports it dies with it.
//
// This is written down because the repo's own toolchain cannot see it. `tsconfig` maps
// `#design/*` and `#shell/*`, and every test imports through Bun, which honours
// `package.json` `imports` — so `bun run typecheck`, `bun run lint` and the whole suite
// pass green on a desk that is dead on arrival. It cost exactly that once: a module
// lifted out of `desk-window.js` kept the `#design/desk-geometry.js` specifier its test
// neighbours use, which took `desk-window.js` down with it and left a desk where no logo
// opened and no address resolved.

const ROOT = resolve(import.meta.dir, "../../..");
const SHELL = readFileSync(join(ROOT, "public/index.html"), "utf8");

/** Every `from "…"` in one module, import and re-export alike. */
function specifiersIn(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map(([, specifier]) => specifier ?? "");
}

describe("what a shipped module is allowed to import", () => {
  test("every specifier is one a browser can fetch on its own", () => {
    for (const [name, source] of shellScripts()) {
      for (const specifier of specifiersIn(source)) {
        // A relative URL, and nothing else. `#…` is `package.json` `imports`, and a bare
        // name is a node_modules lookup; both resolve in Bun and neither resolves in a
        // browser, which is exactly why this has to be asserted rather than noticed.
        expect(
          specifier.startsWith("./") || specifier.startsWith("../"),
          `${name} → ${specifier}`,
        ).toBe(true);
        // And it names a file. A browser does no extension resolution either.
        expect(specifier.endsWith(".js"), `${name} → ${specifier}`).toBe(true);
      }
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
        const target = resolve(ROOT, "public", specifier);
        expect(() => readFileSync(target, "utf8"), `${name} → ${specifier}`).not.toThrow();
      }
    }
  });
});
