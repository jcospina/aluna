#!/usr/bin/env bun
// Comment citations that still resolve. A moved file leaves its old path behind in every comment
// that named it, and a reader who follows one lands nowhere — so the citations are checked.
//
// Two kinds are read: a markdown link, resolved against the citing file or from the repo root,
// and a bare path spelled repo-rooted (`src/server/app.ts`), src-relative (`registry/spec/spec.ts`)
// or root-absolute (`/design/styles/index.css`). A bare relative path is neither, and stays prose
// — `scripts/build.ts` quotes one that only ever exists in the bundle. A path is a citation only
// when its first segment is a directory the repo tracks; a root `.gitignore` names holds build or
// runtime output, so whether the tree has been built cannot change a verdict, and a generated
// artifact's `tests/behavioral.json` stays prose. The cost is that a citation whose whole root is
// gone reads as prose and goes unchecked.
//
// `(absent)` excuses the one citation it follows and nothing else on the line, the way
// `public/css/a11y.css` (absent) is excused: deleted, and pinned deleted by a test that names it.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import {
  type CommentLine,
  commentTextLines,
  GOVERNED,
  REPO_ROOT,
  sourceFilesUnder,
} from "./comment-budget.ts";

/** Written immediately after the one citation whose target is meant to be missing. */
export const ABSENT_MARKER = "(absent)";

const VENDORED = /(^|\/)vendor\//;
const URL_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const LINK_TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`;
const MARKDOWN_LINK = new RegExp(String.raw`\]\(((?:\.{1,2}/|/(?!/))[^)\s]+)${LINK_TITLE}\)`, "g");
const EXTENSION = [
  "ts|tsx|js|jsx|mjs|cjs|css|html|json|md|sql",
  "yml|yaml|toml|sh|snap|txt|svg|png|webp|woff2",
].join("|");
const CITATION = new RegExp(
  `(?<![\\w./#@-])(/?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+\\.(?:${EXTENSION}))(?![A-Za-z0-9])`,
  "gi",
);

/** What may stand between a citation and its marker: a closing quote or bracket, punctuation. */
const MARKER_GAP = /^[\s`'")\]},.;:—–-]*/;

export interface StaleReference {
  readonly file: string;
  readonly line: number;
  readonly cited: string;
  readonly kind: "link" | "path";
}

interface Citation {
  readonly cited: string;
  readonly kind: "link" | "path";
  readonly end: number;
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/** Read from `.gitignore` rather than restated, so the two cannot drift apart. */
function ignoredRoots(): ReadonlySet<string> {
  return new Set(
    readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/") && !line.startsWith("#") && !line.startsWith("!"))
      .map((line) => line.replace(/^\//, "").split("/")[0] ?? ""),
  );
}

const IGNORED_ROOTS = ignoredRoots();

/**
 * Whether a path is spelled as a repo citation at all. An unanchored one — `tests/behavioral.json`,
 * written by a build into a directory the repo has none of — is prose, not a claim about a file.
 * A gitignored root is unanchored too: `dist/` and `.types/` are there after a build and not
 * before one, and a verdict that turned on them would differ between two clones of one commit.
 */
function anchored(cited: string): boolean {
  const segments = cited.replace(/^\//, "").split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) return false;
  const first = segments[0] ?? "";
  if (IGNORED_ROOTS.has(first)) return false;
  return isDirectory(join(REPO_ROOT, first)) || isDirectory(join(REPO_ROOT, "src", first));
}

/** The spellings a bare citation is allowed: from the repo root, from `src/`, or root-absolute. */
function resolvesFromRoot(cited: string): boolean {
  if (cited.startsWith("/")) return existsSync(join(REPO_ROOT, cited));
  return existsSync(join(REPO_ROOT, cited)) || existsSync(join(REPO_ROOT, "src", cited));
}

function linkResolves(file: string, cited: string): boolean {
  const from = cited.startsWith("/") ? REPO_ROOT : dirname(join(REPO_ROOT, file));
  return existsSync(join(from, cited));
}

function matched(text: string, pattern: RegExp, kind: Citation["kind"]): Citation[] {
  return [...text.matchAll(pattern)].map((match) => ({
    cited: match[1] ?? "",
    kind,
    end: (match.index ?? 0) + (match[0] ?? "").length,
  }));
}

/** Whether the marker stands immediately after the citation ending here, and so excuses it. */
function excused(text: string, end: number): boolean {
  const rest = text.slice(end);
  return rest.startsWith(ABSENT_MARKER, (rest.match(MARKER_GAP)?.[0] ?? "").length);
}

/**
 * Every citation one comment line makes. A link is masked to its own length before the bare scan,
 * so its path is counted once and a marker still binds to the citation it was written under.
 */
function citationsIn(text: string): Citation[] {
  const masked = text.replace(MARKDOWN_LINK, (whole) => "#".repeat(whole.length));
  return [...matched(text, MARKDOWN_LINK, "link"), ...matched(masked, CITATION, "path")].filter(
    (one) => !excused(text, one.end),
  );
}

function unresolved(file: string, one: Citation): boolean {
  if (one.kind === "link") return !linkResolves(file, one.cited);
  return anchored(one.cited) && !resolvesFromRoot(one.cited);
}

/** Where the quoted run opening at `index` closes, or the line's end when it never does. */
function endOfQuote(raw: string, index: number): number {
  for (let at = index + 1; at < raw.length; at += 1) {
    if (raw[at] === "\\") at += 1;
    else if (raw[at] === raw[index]) return at;
  }
  return raw.length;
}

/** Where this line's comment opens, or `-1`. The `//` in a string or in `https://` is code. */
function commentStart(raw: string): number {
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === '"' || char === "'" || char === "`") index = endOfQuote(raw, index);
    else if (char !== "/" || raw[index - 1] === ":" || raw[index - 1] === "\\") continue;
    else if (raw[index + 1] === "/" || raw[index + 1] === "*") return index;
  }
  return -1;
}

/** The comment text trailing code on one line, or `null` when the line carries none. */
function afterCode(raw: string): string | null {
  const at = commentStart(raw);
  if (at < 0) return null;
  const rest = raw.slice(at + 2);
  return (raw[at + 1] === "*" ? rest.replace(/\*\/[\s\S]*$/, "") : rest).trim();
}

/**
 * What every comment trailing code says. `commentTextLines` reads whole-line comments only, and
 * `const port = 3030; // see src/server/app.ts` cites a file like any other comment does. A `//`
 * inside a string literal, and the one in a bare `https://` URL, are code rather than a comment.
 */
function trailingComments(source: string): CommentLine[] {
  const found: CommentLine[] = [];
  let insideBlock = false;
  for (const [index, raw] of source.split("\n").entries()) {
    const opens = raw.trim().startsWith("/*");
    if (insideBlock || opens || raw.trim().startsWith("//")) {
      insideBlock = (insideBlock || opens) && !raw.includes("*/");
      continue;
    }
    const text = afterCode(raw);
    if (text !== null && text.length > 0) found.push({ line: index + 1, text });
  }
  return found;
}

/** Every citation in one file's comments that no file answers. */
export function staleReferences(file: string, source: string): StaleReference[] {
  return [...commentTextLines(source), ...trailingComments(source)]
    .sort((one, other) => one.line - other.line)
    .flatMap(({ line, text }) =>
      citationsIn(text.replace(URL_TEXT, " "))
        .filter((one) => unresolved(file, one))
        .map(({ cited, kind }) => ({ file, line, cited, kind })),
    );
}

/** Every stale citation in the governed tree, in file order. */
export function auditRepository(roots: readonly string[] = GOVERNED): StaleReference[] {
  return roots
    .flatMap((root) => sourceFilesUnder(join(REPO_ROOT, root)))
    .map((path) => relative(REPO_ROOT, path))
    .filter((file) => !VENDORED.test(file))
    .flatMap((file) => staleReferences(file, readFileSync(join(REPO_ROOT, file), "utf8")));
}

/** Narrow an audit to the paths a caller named, so one agent can check its own slice. */
function within(stale: readonly StaleReference[], scopes: readonly string[]): StaleReference[] {
  if (scopes.length === 0) return [...stale];
  return stale.filter((one) => scopes.some((scope) => one.file.startsWith(scope)));
}

function report(stale: readonly StaleReference[]): void {
  for (const one of stale) {
    const kind = one.kind === "link" ? "links to" : "cites";
    console.error(`${one.file}:${one.line}  ${kind} ${one.cited}, which no file answers`);
  }
  console.error(`\n${stale.length} comment references resolve to nothing.`);
  console.error(`Write ${ABSENT_MARKER} after the citation when a file is meant to be missing.`);
}

if (import.meta.main) {
  const stale = within(auditRepository(), process.argv.slice(2));
  if (stale.length > 0) {
    report(stale);
    process.exit(1);
  }
  console.log("comment references: clean");
}
