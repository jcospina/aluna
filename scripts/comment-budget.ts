#!/usr/bin/env bun
// The comment budget: fifteen lines of prose above a file, five anywhere else.
//
// CLAUDE.md asks for concision and agents kept writing thirty-line essays anyway, so the rule
// is a check rather than a sentence. It counts prose only — a bare `/**`, a `*/`, a blank `//`
// and a pragma are all free — and everything from a block's first JSDoc tag onward documents
// the API rather than the reasoning, so `@param` and `@typedef` cost nothing.
//
// Before rewriting comments in bulk, know that tests here sweep source *text*, comments
// included: `evolution-faults.test.ts` and `question-loop.test.ts` fail on names appearing
// anywhere under `src`, so a reworded comment can redden a suite about a retired code seam.
//
// Run by `bun run lint`. `comment-budget.test.ts` proves it catches what it claims to.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HEADER_BUDGET = 15;
export const BLOCK_BUDGET = 5;

/** Directories whose comments this rule governs. */
export const GOVERNED = ["src", "public", "scripts"];

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".types", "__snapshots__"]);
const SOURCE = /\.(ts|tsx|js)$/;

/** Tool directives rather than prose: free, and they never end the prose run. */
const PRAGMA = /^(@ts-|biome-ignore|eslint|oxlint|prettier|c8 |v8 |istanbul |<reference)/;

export interface CommentBlock {
  readonly startLine: number;
  readonly prose: number;
  readonly budget: number;
}

export interface Violation extends CommentBlock {
  readonly file: string;
}

/** The text a comment line carries, or `null` when the line is not a comment at all. */
function commentText(raw: string, insideBlock: boolean): string | null {
  const line = raw.trim();
  if (insideBlock)
    return line
      .replace(/\*\/\s*$/, "")
      .replace(/^\*+/, "")
      .trim();
  if (line.startsWith("//")) return line.slice(2).trim();
  if (!line.startsWith("/*")) return null;
  return line
    .replace(/^\/\*+/, "")
    .replace(/\*\/\s*$/, "")
    .trim();
}

/** Whether this line opens a `/* … *​/` that later lines continue. */
function opensBlock(raw: string, insideBlock: boolean): boolean {
  if (insideBlock) return !raw.includes("*/");
  return raw.trim().startsWith("/*") && !raw.includes("*/");
}

interface Scan {
  blocks: CommentBlock[];
  start: number;
  prose: number;
  tagged: boolean;
  insideBlock: boolean;
  headerSpent: boolean;
}

/**
 * Record the block that has just ended, if one was open. A leading block that spends no prose —
 * a lone `// @ts-check` — does not claim the header budget the file doc under it is owed.
 */
function closeBlock(scan: Scan): void {
  if (scan.start >= 0) {
    const budget = scan.headerSpent ? BLOCK_BUDGET : HEADER_BUDGET;
    scan.blocks.push({ startLine: scan.start + 1, prose: scan.prose, budget });
    if (scan.prose > 0) scan.headerSpent = true;
  }
  scan.start = -1;
  scan.prose = 0;
  scan.tagged = false;
}

/** Fold one comment line into the open block. */
function absorb(scan: Scan, raw: string, text: string, index: number): void {
  if (scan.start < 0) scan.start = index;
  const pragma = PRAGMA.test(text);
  if (text.startsWith("@") && !pragma) scan.tagged = true;
  if (!scan.tagged && text.length > 0 && !pragma) scan.prose += 1;
  scan.insideBlock = opensBlock(raw, scan.insideBlock);
}

/**
 * Every comment block in one file with the prose it spends. A block is a run of comment lines
 * broken by anything else, blank lines included; the first one in a file is its header.
 */
export function commentBlocks(source: string): CommentBlock[] {
  const scan: Scan = {
    blocks: [],
    start: -1,
    prose: 0,
    tagged: false,
    insideBlock: false,
    headerSpent: false,
  };
  for (const [index, raw] of source.split("\n").entries()) {
    if (index === 0 && raw.startsWith("#!")) continue;
    const text = commentText(raw, scan.insideBlock);
    if (text === null) {
      closeBlock(scan);
      if (raw.trim().length > 0) scan.headerSpent = true;
      continue;
    }
    absorb(scan, raw, text, index);
  }
  closeBlock(scan);
  return scan.blocks;
}

export interface CommentLine {
  readonly line: number;
  readonly text: string;
}

/**
 * What every whole-line comment in one file says, so a second checker reads comments the way the
 * budget does. A comment trailing code is not one: `commentText` only sees a line that opens one.
 */
export function commentTextLines(source: string): CommentLine[] {
  const found: CommentLine[] = [];
  let insideBlock = false;
  for (const [index, raw] of source.split("\n").entries()) {
    const text = commentText(raw, insideBlock);
    if (text === null) {
      insideBlock = false;
      continue;
    }
    if (text.length > 0) found.push({ line: index + 1, text });
    insideBlock = opensBlock(raw, insideBlock);
  }
  return found;
}

/** Every block in `source` that spends more prose than its budget allows. */
export function overBudget(file: string, source: string): Violation[] {
  return commentBlocks(source)
    .filter((block) => block.prose > block.budget)
    .map((block) => ({ ...block, file }));
}

function collectSources(directory: string, found: string[]): void {
  for (const entry of readdirSync(directory)) {
    if (SKIP_DIRECTORIES.has(entry)) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collectSources(path, found);
    else if (SOURCE.test(entry)) found.push(path);
  }
}

export function sourceFilesUnder(root: string): string[] {
  const found: string[] = [];
  collectSources(root, found);
  return found.sort();
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every violation in the governed tree, in file order. */
export function auditRepository(roots: readonly string[] = GOVERNED): Violation[] {
  return roots
    .flatMap((root) => sourceFilesUnder(join(REPO_ROOT, root)))
    .flatMap((path) => overBudget(relative(REPO_ROOT, path), readFileSync(path, "utf8")));
}

/** Narrow an audit to the paths a caller named, so one agent can check its own slice. */
export function within<T extends { readonly file: string }>(
  found: readonly T[],
  scopes: readonly string[],
): T[] {
  if (scopes.length === 0) return [...found];
  return found.filter((one) => scopes.some((scope) => one.file.startsWith(scope)));
}

function report(violations: readonly Violation[]): void {
  for (const one of violations) {
    const kind = one.budget === HEADER_BUDGET ? "file header" : "comment block";
    console.error(
      `${one.file}:${one.startLine}  ${kind} spends ${one.prose}, budget ${one.budget}`,
    );
  }
  console.error(`\n${violations.length} comment blocks over budget.`);
  console.error(`Budgets: ${HEADER_BUDGET} lines above a file, ${BLOCK_BUDGET} anywhere else.`);
}

if (import.meta.main) {
  const violations = within(auditRepository(), process.argv.slice(2));
  if (violations.length > 0) {
    report(violations);
    process.exit(1);
  }
  console.log("comment budget: clean");
}
