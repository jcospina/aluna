import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Reading the repo's own source, for the questions a browser cannot be asked in Bun. One helper
// rather than one per suite: the stripper below is load-bearing for every negative assertion.

const ROOT = resolve(import.meta.dir, "../../..");

/** One repo file, exactly as it ships. */
export const readSource = (path: string): string => readFileSync(join(ROOT, path), "utf8");

/**
 * Source with its prose taken out. A `//` is stripped only where it opens the line, because
 * truncating a `https://` would make a negative assertion pass silently instead of failing.
 */
export const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");

/** A file read and stripped in one go. */
export const codeOf = (path: string): string => code(readSource(path));

/** Whitespace flattened, so a pin over a statement survives the formatter. */
export const flat = (source: string): string => source.replace(/\s+/g, " ").trim();

/** A stylesheet with its comments stripped — a rule is what the browser sees. */
export const rules = (path: string): string => readSource(path).replace(/\/\*[\s\S]*?\*\//g, "");

/** Every file of one kind under a directory, as repo-relative paths. */
export const under = (directory: string, pattern: string): string[] =>
  [...new Bun.Glob(pattern).scanSync({ cwd: join(ROOT, directory) })].map((name: string) =>
    join(directory, name),
  );

/**
 * Every body a selector has, in source order. Flat: nesting is not used in these sheets. The
 * guard is the point — a renamed selector should name itself, not throw a `TypeError` later.
 */
export function ruleBodies(css: string, selector: string): string[] {
  const pattern = new RegExp(
    `(?:^|[},])\\s*${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`,
    "g",
  );
  const found = [...css.matchAll(pattern)].map((match) => match[1] as string);
  expect(found.length, `no \`${selector}\` rule`).toBeGreaterThan(0);
  return found;
}

/** One rule's body, by exact selector. */
export const ruleBody = (css: string, selector: string): string =>
  ruleBodies(css, selector)[0] as string;

/**
 * Every shell script as shipped. All of them: an exclusion that matches nothing is a hole
 * waiting for the next file to fall through it.
 */
export const shellScripts = (): ReadonlyArray<readonly [string, string]> =>
  [...new Bun.Glob("*.js").scanSync({ cwd: join(ROOT, "public") })]
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
