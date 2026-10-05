// The record ids a question's steps returned, and the answer with every one of them taken out
// (ADR-0010: the prose never carries an id). The prompt asks for none; this is what holds when a
// model writes one anyway — in either case, in fullwidth or other lookalike digits, with marks or
// invisible characters between them, or with one id hidden inside another.
//
// One scan reads the text's hex digits as runs, each character folded by its lookalike and by NFKC,
// and looks every 32-digit window of a run up in the set. Removing an id can join the halves of
// another around it, so the scan repeats until it finds none; each pass removes at least 32
// characters, so it ends.

import { RECORD_ID_PATTERN } from "#shell/core/routes.js";
import type { QueryWorkerValue } from "../worker/query-worker.ts";
import { cut } from "./answer-id-cut.ts";

/** A record id inside a cell, hyphenated as `randomUUID()` writes it or as its bare 32 digits. */
const AN_ID_INSIDE = new RegExp(
  `${RECORD_ID_PATTERN}|(?<![0-9a-fA-F])[0-9a-fA-F]{32}(?![0-9a-fA-F])`,
  "g",
);

const HEX_DIGITS = /^[0-9a-f]+$/;
/** Characters with no width of their own, which neither spell a digit nor part two of them. */
const INVISIBLE = /^[\p{Cf}\p{Mn}\p{Me}\p{Default_Ignorable_Code_Point}]$/u;
/**
 * Characters that look like a hex digit and that NFKC leaves alone: the Cyrillic and Greek
 * letters drawn as one, and the letters a reader takes for 0 and 1 (Unicode's confusables, UTS #39).
 */
const LOOKS_LIKE: Readonly<Record<string, string>> = {
  а: "a",
  А: "a",
  Α: "a",
  в: "b",
  В: "b",
  Β: "b",
  с: "c",
  С: "c",
  ϲ: "c",
  ԁ: "d",
  е: "e",
  Е: "e",
  Ε: "e",
  ℮: "e",
  о: "0",
  О: "0",
  ο: "0",
  Ο: "0",
  o: "0",
  O: "0",
  l: "1",
  I: "1",
  ӏ: "1",
  Ι: "1",
  з: "3",
  З: "3",
  б: "6",
};
/** A letter or figure that is no hex digit: it ends a run, where a mark or a space does not. */
const ENDS_A_RUN = /^[\p{L}\p{N}]$/u;

/** The 32 digits of an id, lower case, which is how the scan compares it. */
export function idDigits(id: string): string {
  return id.replaceAll("-", "").toLowerCase();
}

/** An id's 32 digits written the way its record address spells it. */
function hyphenated(digits: string): string {
  const part = (from: number, to: number) => digits.slice(from, to);
  return [part(0, 8), part(8, 12), part(12, 16), part(16, 20), part(20, 32)].join("-");
}

/** Every record id inside `cell`, in the form its record address spells it. */
export function idsInCell(cell: QueryWorkerValue): readonly string[] {
  if (typeof cell !== "string") return [];
  return [...cell.matchAll(AN_ID_INSIDE)].map(([id]) => hyphenated(idDigits(id)));
}

/** A cell that is one id and nothing else, in that form, or undefined. */
export function wholeCellId(cell: QueryWorkerValue): string | undefined {
  const [only] = typeof cell === "string" ? idsInCell(cell.trim()) : [];
  return only !== undefined && idDigits(only) === idDigits(String(cell).trim()) ? only : undefined;
}

interface Digit {
  readonly digit: string;
  readonly from: number;
  readonly to: number;
}

/** The text's hex digits, in runs a letter or figure of any other kind ends. */
function hexRuns(text: string): readonly (readonly Digit[])[] {
  const runs: Digit[][] = [[]];
  let at = 0;
  for (const character of text) {
    const from = at;
    at += character.length;
    const folded = (LOOKS_LIKE[character] ?? character).normalize("NFKC").toLowerCase();
    if (HEX_DIGITS.test(folded)) {
      for (const digit of folded) runs.at(-1)?.push({ digit, from, to: at });
    } else if (!INVISIBLE.test(character) && ENDS_A_RUN.test(character)) runs.push([]);
  }
  return runs.filter((run) => run.length >= 32);
}

/** Where a digit's own combining marks and joiners end, so none is left behind without it. */
function withItsMarks(text: string, to: number): number {
  let end = to;
  while (end < text.length && /^[\p{M}\u200D]$/u.test(text[end] ?? "")) end += 1;
  return end;
}

/** Where each id in `digits` is spelled out in `text`, as character spans, last first. */
function spansOf(
  text: string,
  digits: ReadonlySet<string>,
): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  for (const run of hexRuns(text)) {
    const spelled = run.map(({ digit }) => digit).join("");
    for (let start = 0; start + 32 <= run.length; start += 1) {
      if (!digits.has(spelled.slice(start, start + 32))) continue;
      spans.push([run[start]?.from ?? 0, withItsMarks(text, run[start + 31]?.to ?? 0)]);
      start += 31;
    }
  }
  return spans.sort(([one], [other]) => other - one);
}

/** Whether `text` spells out any id whose 32 digits are in `digits`. One pass decides it. */
export function holdsARecordId(text: string, digits: ReadonlySet<string>): boolean {
  return spansOf(text, digits).length > 0;
}

/** `text` with every id whose 32 digits are in `digits` removed. Text holding none is unchanged. */
export function withoutRecordIds(text: string, digits: ReadonlySet<string>): string {
  if (digits.size === 0) return text;
  // One id a pass: a cut can grow, so the spans found beside it no longer say where anything is.
  let said = text;
  for (let [span] = spansOf(said, digits); span; [span] = spansOf(said, digits)) {
    said = cut(said, span[0], span[1]);
  }
  return said === text ? text : said.trim();
}
