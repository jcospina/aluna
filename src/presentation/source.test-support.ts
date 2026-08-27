import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Reading the repo's own source, for the questions a browser cannot be asked in Bun.
// One helper rather than one per suite: the stripper below is load-bearing for every
// negative assertion built on it, so it is worth having in one place and testing.

const ROOT = resolve(import.meta.dir, "../..");

/** One repo file, exactly as it ships. */
export const readSource = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/**
 * Source with its prose taken out, for questions about what the code does rather than
 * what it says about itself.
 *
 * Block comments go wholesale. Line comments go only where the `//` opens the line,
 * because a stripper that took any `//` would truncate every line holding a `https://`
 * — and since every caller asks a *negative* question, keeping too much text is the
 * direction that fails loudly rather than the direction that passes silently.
 */
export const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");

/** A file read and stripped in one go. */
export const codeOf = (path: string): string => code(readSource(path));

/** Whitespace flattened, so a pin over a statement survives the formatter. */
export const flat = (source: string): string => source.replace(/\s+/g, " ").trim();

/**
 * Every shell script as shipped. The `*-preview.js` developer pages are not the desk,
 * so they are not asked what the desk builds.
 */
export const shellScripts = (): ReadonlyArray<readonly [string, string]> =>
  [...new Bun.Glob("*.js").scanSync({ cwd: join(ROOT, "public") })]
    .filter((name: string) => !name.endsWith("-preview.js"))
    .sort()
    .map((name: string) => [name, codeOf(join("public", name))] as const);

/** Every stylesheet the product or the design system ships. */
export const shippedStylesheets = (): ReadonlyArray<readonly [string, string]> =>
  ["public", "design"]
    .flatMap((root) =>
      [...new Bun.Glob("**/*.css").scanSync({ cwd: join(ROOT, root) })].map((name: string) =>
        join(root, name),
      ),
    )
    .sort()
    .map((path: string) => [path, readSource(path)] as const);
